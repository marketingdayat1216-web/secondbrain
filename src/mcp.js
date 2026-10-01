// Server MCP (Streamable HTTP, balasan JSON) supaya Claude di claude.ai / desktop bisa memakai Second Brain.

import { json } from './util.js';
import { corsHeaders, verifyBearer } from './oauth.js';
import {
  listTasks, addTask, completeTask, updateTask, listNotes, addNote, getNote, getProfile,
} from './store.js';
import { searchContext, remember, listMemories } from './memory.js';
import { listAds } from './competitor.js';
import { first } from './db.js';
import { startRun, agentState, getRun } from './agents.js';
import { parseLocal, toLocalInput, nowDescription } from './time.js';
import { truncate } from './util.js';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'list_tasks',
    description: 'Daftar tugas pemilik. status: todo (default), done, atau all.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['todo', 'done', 'all'] }, query: { type: 'string' } } },
  },
  {
    name: 'add_task',
    description: 'Tambah tugas. Waktu memakai zona lokal pemilik dengan format "YYYY-MM-DD HH:mm". Pengingat Telegram dikirim di waktu remind (default = due).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, due: { type: 'string' }, remind: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] }, notes: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Ubah tugas (judul, tenggat, pengingat, prioritas, atau status todo/done).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' }, title: { type: 'string' }, due: { type: 'string' }, remind: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] }, status: { type: 'string', enum: ['todo', 'done'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_task',
    description: 'Tandai tugas selesai.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'search',
    description: 'Cari berdasarkan makna di memori jangka panjang dan catatan pemilik.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'list_notes',
    description: 'Daftar catatan terbaru, atau cari dengan kata kunci.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } } },
  },
  {
    name: 'get_note',
    description: 'Ambil isi lengkap satu catatan.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'add_note',
    description: 'Simpan catatan baru (otomatis bisa dicari berdasarkan makna).',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'list_memories',
    description: 'Daftar fakta yang diingat tentang pemilik.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'add_memory',
    description: 'Simpan fakta jangka panjang tentang pemilik (preferensi, bisnis, orang penting, target).',
    inputSchema: { type: 'object', properties: { fact: { type: 'string' }, category: { type: 'string' } }, required: ['fact'] },
  },
  {
    name: 'get_profile',
    description: 'Profil pemilik: ringkasan dan jawaban wawancara.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_competitor_ads',
    description: 'Iklan kompetitor dari Meta Ad Library hasil scan. sort: rank (urutan impresi), days (paling lama tayang), score, new.',
    inputSchema: {
      type: 'object',
      properties: { keyword: { type: 'string' }, sort: { type: 'string', enum: ['rank', 'days', 'score', 'new'] }, limit: { type: 'integer' }, winners_only: { type: 'boolean' } },
    },
  },
  {
    name: 'get_competitor_ad',
    description: 'Detail satu iklan kompetitor termasuk laporan bedah iklan dan 5 konten mirip bila sudah dibuat.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'run_team',
    description: 'Beri perintah ke tim agen AI (CEO, Manajer Operasional, Manajer Marketing, dan staf). Berjalan di latar; cek dengan get_team_run.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'get_team_run',
    description: 'Status dan hasil kerja tim. Tanpa id: status tim & daftar run terbaru.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } } },
  },
];

const fmtTask = (env, t) => `#${t.id} [${t.status === 'done' ? 'x' : ' '}] ${t.title}${t.due_at ? ` (tenggat ${toLocalInput(env, t.due_at)})` : ''}${t.priority === 'high' ? ' !penting' : ''}`;

async function callTool(env, name, args = {}) {
  switch (name) {
    case 'list_tasks': {
      const tasks = await listTasks(env, { status: args.status || 'todo', q: args.query || '', limit: 100 });
      return `Waktu sekarang: ${nowDescription(env)}\n` + (tasks.map((t) => fmtTask(env, t)).join('\n') || 'Tidak ada tugas.');
    }
    case 'add_task': {
      const t = await addTask(env, { title: args.title, notes: args.notes || '', due_at: parseLocal(env, args.due), remind_at: args.remind ? parseLocal(env, args.remind) : null, priority: args.priority, source: 'claude' });
      return `Tugas dibuat: ${fmtTask(env, t)}`;
    }
    case 'update_task': {
      const fields = {};
      for (const k of ['title', 'priority', 'status']) if (args[k] !== undefined) fields[k] = args[k];
      if (args.due !== undefined) fields.due_at = parseLocal(env, args.due);
      if (args.remind !== undefined) fields.remind_at = parseLocal(env, args.remind);
      const t = await updateTask(env, Number(args.id), fields);
      return t ? `Diubah: ${fmtTask(env, t)}` : 'Tugas tidak ditemukan.';
    }
    case 'complete_task': {
      const t = await completeTask(env, Number(args.id));
      return t ? `Selesai: ${fmtTask(env, t)}` : 'Tugas tidak ditemukan.';
    }
    case 'search': {
      const r = await searchContext(env, args.query, { topK: 10, minScore: 0.35 });
      const parts = [];
      if (r.memories.length) parts.push('MEMORI:\n' + r.memories.map((m) => `- #${m.id} ${m.content}`).join('\n'));
      if (r.notes.length) parts.push('CATATAN:\n' + r.notes.map((n) => `- #${n.id} ${n.title}: ${truncate(n.content, 500)}`).join('\n'));
      return parts.join('\n\n') || 'Tidak ada yang cocok.';
    }
    case 'list_notes': {
      const notes = await listNotes(env, { q: args.query || '', limit: Math.min(50, args.limit || 20) });
      return notes.map((n) => `#${n.id} ${n.title}${n.tags ? ' [' + n.tags + ']' : ''} — ${truncate(n.content.replace(/\s+/g, ' '), 160)}`).join('\n') || 'Belum ada catatan.';
    }
    case 'get_note': {
      const n = await getNote(env, Number(args.id));
      return n ? `# ${n.title}\nTag: ${n.tags || '-'}\n\n${n.content}` : 'Catatan tidak ditemukan.';
    }
    case 'add_note': {
      const n = await addNote(env, { title: args.title, content: args.content, tags: args.tags, source: 'claude' });
      return `Catatan #${n.id} disimpan: ${n.title}`;
    }
    case 'list_memories': {
      const mems = await listMemories(env, { q: args.query || '', limit: 100 });
      return mems.map((m) => `#${m.id} (${m.category}) ${m.content}`).join('\n') || 'Belum ada memori.';
    }
    case 'add_memory': {
      const m = await remember(env, args.fact, { category: args.category || 'lainnya', source: 'claude' });
      return m ? `Diingat (#${m.id}): ${m.content}` : 'Fakta kosong.';
    }
    case 'get_profile': {
      const p = await getProfile(env);
      return `RINGKASAN:\n${p.summary || '(belum ada)'}\n\nJAWABAN WAWANCARA:\n${p.questions.map((q) => `- ${q.q}\n  ${p.answers[q.key] || '(belum dijawab)'}`).join('\n')}`;
    }
    case 'list_competitor_ads': {
      const ads = await listAds(env, { keyword: args.keyword || '', sort: args.sort || 'rank', limit: Math.min(60, args.limit || 20), winners: Boolean(args.winners_only) });
      return ads.map((a) => `#${a.id} ${a.page_name} | "${a.keyword}" urutan #${a.rank} | tayang ${a.days_running ?? '?'} hari | skor ${a.score ?? '-'}${a.winner ? ' | PEMENANG' : ''}\n  ${truncate(a.body.replace(/\s+/g, ' '), 220)}`).join('\n') || 'Belum ada data. Scan dulu dari Meta Ad Library.';
    }
    case 'get_competitor_ad': {
      const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', Number(args.id));
      if (!a) return 'Iklan tidak ditemukan.';
      return `Halaman: ${a.page_name}\nLibrary ID: ${a.library_id} (https://www.facebook.com/ads/library/?id=${a.library_id})\nMulai tayang: ${a.start_date}\nUrutan: #${a.rank} untuk "${a.keyword}"\nSkor: ${a.score ?? '-'} — ${a.score_reason}\nCTA: ${a.cta}\n\nTEKS:\n${a.body}\n\nBEDAH IKLAN:\n${a.analysis || '(belum)'}\n\n5 KONTEN MIRIP:\n${a.variations || '(belum)'}`;
    }
    case 'run_team': {
      const r = await startRun(env, args.command, { source: 'claude' });
      return `Tim mulai bekerja (run #${r.id}). Cek hasil dengan get_team_run id=${r.id} dalam 1-3 menit.`;
    }
    case 'get_team_run': {
      if (args.id) {
        const r = await getRun(env, Number(args.id));
        if (!r) return 'Run tidak ditemukan.';
        return `Run #${r.id} — ${r.status}\nPerintah: ${r.command}\n\n${r.report ? 'LAPORAN CEO:\n' + r.report + '\n\n' : ''}${r.results.map((x) => `## ${x.agent}\n${x.output}`).join('\n\n')}`;
      }
      const s = await agentState(env, { eventLimit: 5 });
      return `TIM:\n${s.agents.map((a) => `- ${a.name} (${a.title}): ${a.status}${a.activity ? ' — ' + a.activity : ''}`).join('\n')}\n\nRUN TERBARU:\n${s.runs.map((r) => `#${r.id} ${r.status}: ${r.command}`).join('\n') || '-'}`;
    }
    default:
      throw Object.assign(new Error(`Tool tidak dikenal: ${name}`), { code: -32602 });
  }
}

async function handleRpc(env, msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return null; // notifikasi
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: env.APP_NAME || 'second-brain', version: '1.0.0' },
        instructions: `Second Brain milik ${env.OWNER_NAME || 'pemilik'}: tugas, catatan, memori jangka panjang, profil, riset iklan kompetitor, dan tim agen AI. Waktu memakai zona lokal pemilik (format "YYYY-MM-DD HH:mm").`,
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      try {
        const text = await callTool(env, params.name, params.arguments || {});
        return ok({ content: [{ type: 'text', text }] });
      } catch (e) {
        if (e.code === -32602) return fail(-32602, e.message);
        return ok({ content: [{ type: 'text', text: `Gagal: ${e?.message || e}` }], isError: true });
      }
    }
    case 'resources/list':
      return ok({ resources: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return fail(-32601, `Metode tidak didukung: ${method}`);
  }
}

export async function handleMcp(request, env, origin) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const auth = await verifyBearer(request, env);
  if (!auth) {
    return json({ error: 'unauthorized' }, 401, {
      ...corsHeaders,
      'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    });
  }
  if (request.method === 'GET') return new Response('Method Not Allowed', { status: 405, headers: { ...corsHeaders, allow: 'POST' } });
  if (request.method === 'DELETE') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400, corsHeaders);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(Boolean);
    return out.length ? json(out, 200, corsHeaders) : new Response(null, { status: 202, headers: corsHeaders });
  }
  const res = await handleRpc(env, body);
  return res ? json(res, 200, corsHeaders) : new Response(null, { status: 202, headers: corsHeaders });
}
