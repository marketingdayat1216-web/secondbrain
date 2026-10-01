// Tim agen AI: CEO memecah perintah → manajer & staf mengerjakan berurutan → CEO menyusun laporan.
// Status tiap agen disimpan di D1 supaya Kantor 3D bisa menggerakkan mereka sesuai kerja aslinya.

import { all, first, run } from './db.js';
import { smartJson, smartChat, modelLabel, smartModel, hasSmart } from './ai.js';
import { searchContext } from './memory.js';
import { addTask, addNote, getProfile, listTasks } from './store.js';
import { nowDescription, parseLocal, toLocalInput, daysSince } from './time.js';
import { truncate } from './util.js';
import { sendText } from './telegram-api.js';

export const AGENTS = [
  { id: 'ceo', name: 'Raka', title: 'CEO', team: 'pimpinan', color: '#d9a21b',
    role: 'Memimpin tim, memecah tujuan menjadi tugas, menilai hasil, dan menyusun laporan akhir yang tegas dan bisa langsung dieksekusi.' },
  { id: 'ops', name: 'Dina', title: 'Manajer Operasional', team: 'operasional', color: '#1f8a7a',
    role: 'Mengubah rencana menjadi jadwal, SOP, dan daftar tugas konkret dengan tenggat. Fokus pada prioritas dan kapasitas.' },
  { id: 'ops_admin', name: 'Bayu', title: 'Staf Admin & Jadwal', team: 'operasional', color: '#46b3a3',
    role: 'Merapikan detail: checklist, template pesan, jadwal harian/mingguan, pengingat.' },
  { id: 'ops_analyst', name: 'Sari', title: 'Analis Data', team: 'operasional', color: '#6fc7b8',
    role: 'Menghitung dan menganalisis angka: target, proyeksi, metrik, evaluasi performa. Selalu tunjukkan asumsi.' },
  { id: 'mkt', name: 'Maya', title: 'Manajer Marketing', team: 'marketing', color: '#d2552b',
    role: 'Menyusun strategi marketing: positioning, angle, funnel, kalender konten, anggaran iklan.' },
  { id: 'mkt_research', name: 'Fajar', title: 'Riset Kompetitor', team: 'marketing', color: '#e37b4f',
    role: 'Membedah iklan dan strategi kompetitor dari data Riset Kompetitor: pola hook, penawaran, durasi tayang, celah pasar.' },
  { id: 'mkt_copy', name: 'Lala', title: 'Copywriter', team: 'marketing', color: '#ef9a6e', heavy: true,
    role: 'Menulis copy iklan, caption, script video pendek, dan headline yang menjual dengan hook kuat.' },
  { id: 'mkt_content', name: 'Andi', title: 'Content Planner', team: 'marketing', color: '#f2b38f',
    role: 'Merancang ide dan kalender konten: format, pilar konten, jadwal posting, ide visual.' },
];

const BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const STALE_MS = 20 * 60000;

export async function setAgent(env, id, status, activity = '', model = '', runId = null) {
  await run(
    env,
    `INSERT INTO agents (id, status, activity, model, run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, activity = excluded.activity, model = excluded.model, run_id = excluded.run_id, updated_at = excluded.updated_at`,
    id, status, truncate(activity, 160), model, runId, Date.now(),
  );
}

export async function logEvent(env, runId, agentId, type, content, model = '') {
  await run(
    env,
    'INSERT INTO agent_events (run_id, agent_id, type, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    runId, agentId, type, String(content).slice(0, 20000), model, Date.now(),
  );
}

async function resetAgents(env, runId) {
  await run(env, `UPDATE agents SET status = 'idle', activity = '', run_id = NULL, updated_at = ? WHERE run_id = ? OR run_id IS NULL`, Date.now(), runId);
}

export async function agentState(env, { eventLimit = 40 } = {}) {
  const rows = await all(env, 'SELECT * FROM agents');
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const now = Date.now();
  const agents = AGENTS.map((a) => {
    const r = byId[a.id];
    const stale = !r || now - r.updated_at > STALE_MS;
    return {
      id: a.id, name: a.name, title: a.title, team: a.team, color: a.color,
      status: stale ? 'idle' : r.status,
      activity: stale ? '' : r.activity,
      model: r?.model ? modelLabel(r.model) : '',
      run_id: stale ? null : r.run_id,
      updated_at: r?.updated_at || 0,
    };
  });
  const runs = await all(env, 'SELECT id, command, status, note_id, created_at, finished_at FROM agent_runs ORDER BY id DESC LIMIT 10');
  const events = await all(env, 'SELECT id, run_id, agent_id, type, content, model, created_at FROM agent_events ORDER BY id DESC LIMIT ?', eventLimit);
  return {
    agents,
    runs,
    events: events.map((e) => ({ ...e, content: truncate(e.content, 600), model: e.model ? modelLabel(e.model) : '' })),
  };
}

export async function getRun(env, id) {
  const r = await first(env, 'SELECT * FROM agent_runs WHERE id = ?', id);
  if (!r) return null;
  const events = await all(env, 'SELECT * FROM agent_events WHERE run_id = ? ORDER BY id', id);
  return { ...r, plan: JSON.parse(r.plan || '[]'), results: JSON.parse(r.results || '[]'), events };
}

export async function startRun(env, command, { source = 'web' } = {}) {
  command = String(command || '').trim();
  if (!command) throw new Error('Perintah kosong');
  // Tanpa API key: tim dikerjakan Claude langganan lewat konektor (antrean Claude).
  const viaClaude = !hasSmart(env);
  const r = await first(env, 'INSERT INTO agent_runs (command, status, source, created_at) VALUES (?, ?, ?, ?) RETURNING *', command, viaClaude ? 'waiting_claude' : 'queued', source, Date.now());
  await setAgent(env, 'ceo', 'thinking', (viaClaude ? 'Menunggu Claude: ' : 'Membaca perintah: ') + command, '', r.id);
  await logEvent(env, r.id, 'ceo', 'info', viaClaude
    ? `Perintah masuk: ${command}\nMenunggu Claude (langganan). Buka Claude dengan konektor Second Brain dan kirim: "Kerjakan semua antrean analisa di Second Brain".`
    : `Perintah masuk: ${command}`);
  if (!viaClaude) await env.QUEUE.send({ type: 'agent_plan', runId: r.id });
  return { ...r, viaClaude };
}

async function sharedContext(env, command) {
  const [profile, ctx] = await Promise.all([
    getProfile(env),
    searchContext(env, command).catch(() => ({ memories: [], notes: [] })),
  ]);
  let s = `Waktu sekarang: ${nowDescription(env)}.\nPemilik bisnis: ${env.OWNER_NAME || 'Bos'}.\nPROFIL: ${profile.summary || '(belum diisi)'}`;
  if (ctx.memories.length) s += `\nMEMORI: ${ctx.memories.map((m) => m.content).join(' | ')}`;
  if (ctx.notes.length) s += `\nCATATAN TERKAIT:\n${ctx.notes.slice(0, 4).map((n) => `- ${n.title}: ${truncate(n.content.replace(/\s+/g, ' '), 500)}`).join('\n')}`;
  return s;
}

async function teamContext(env, agent) {
  if (agent.team === 'marketing') {
    const ads = await all(env, 'SELECT * FROM competitor_ads ORDER BY COALESCE(score, 0) DESC, rank ASC LIMIT 8');
    if (!ads.length) return 'DATA KOMPETITOR: belum ada scan iklan kompetitor.';
    return 'DATA KOMPETITOR (iklan terkuat):\n' + ads.map((a) =>
      `- ${a.page_name || 'Tanpa nama'} | tayang ${daysSince(a.start_ts) ?? '?'} hari | urutan #${a.rank ?? '?'} | skor ${a.score ?? '-'} | "${truncate(a.body.replace(/\s+/g, ' '), 260)}"`,
    ).join('\n');
  }
  if (agent.team === 'operasional') {
    const tasks = await listTasks(env, { status: 'todo', limit: 25 });
    return 'TUGAS AKTIF:\n' + (tasks.map((t) => `- #${t.id} ${t.title}${t.due_at ? ' (tenggat ' + toLocalInput(env, t.due_at) + ')' : ''}`).join('\n') || '(kosong)');
  }
  return '';
}

export async function planRun(env, runId) {
  const r = await first(env, 'SELECT * FROM agent_runs WHERE id = ?', runId);
  if (!r) return;
  await run(env, "UPDATE agent_runs SET status = 'planning' WHERE id = ?", runId);
  await setAgent(env, 'ceo', 'thinking', 'Menyusun rencana kerja', '', runId);
  const ctx = await sharedContext(env, r.command);
  const team = AGENTS.filter((a) => a.id !== 'ceo').map((a) => `- ${a.id}: ${a.name}, ${a.title}. ${a.role}`).join('\n');
  const { data, model } = await smartJson(env, { maxTokens: 2000, effort: 'medium', system: `Kamu ${BY_ID.ceo.name}, CEO tim AI. ${BY_ID.ceo.role}`, messages: [{
    role: 'user',
    content: `${ctx}\n\nPERINTAH DARI PEMILIK: ${r.command}\n\nANGGOTA TIM:\n${team}\n\nSebagai CEO, pecah perintah ini menjadi 1-4 tugas berurutan untuk anggota tim yang paling cocok (tugas berikutnya bisa memakai hasil sebelumnya). Tandai "heavy": true untuk penulisan konten panjang atau analisis mendalam (dikerjakan dengan usaha berpikir lebih tinggi).\nBalas HANYA JSON: {"summary":"ringkasan rencana 1 kalimat","assignments":[{"agent":"id_agen","task":"instruksi jelas & spesifik","heavy":false}]}`,
  }] });

  let assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  assignments = assignments
    .filter((a) => a && BY_ID[a.agent] && a.agent !== 'ceo' && a.task)
    .slice(0, 4)
    .map((a) => ({ agent: a.agent, task: String(a.task), heavy: Boolean(a.heavy || BY_ID[a.agent].heavy) }));
  if (!assignments.length) {
    const fallbackAgent = /iklan|konten|caption|marketing|promosi|kompetitor/i.test(r.command) ? 'mkt' : 'ops';
    assignments = [{ agent: fallbackAgent, task: r.command, heavy: false }];
  }
  await run(env, "UPDATE agent_runs SET status = 'running', plan = ? WHERE id = ?", JSON.stringify(assignments), runId);
  await logEvent(env, runId, 'ceo', 'plan',
    `${data?.summary || 'Rencana kerja'}\n${assignments.map((a, i) => `${i + 1}. ${BY_ID[a.agent].name} (${BY_ID[a.agent].title}): ${a.task}`).join('\n')}`, model);
  // Semua yang ditugaskan berkumpul di meja rapat sebentar.
  await setAgent(env, 'ceo', 'meeting', 'Briefing tim: ' + (data?.summary || r.command), model, runId);
  for (const a of assignments) await setAgent(env, a.agent, 'meeting', 'Ikut briefing', '', runId);
  await env.QUEUE.send({ type: 'agent_step', runId, idx: 0 }, { delaySeconds: 3 });
}

function parseNewTasks(text) {
  const idx = text.search(/^\s*TUGAS\s*:/im);
  if (idx < 0) return { body: text.trim(), tasks: [] };
  const body = text.slice(0, idx).trim();
  const tasks = text.slice(idx).split('\n').slice(1)
    .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const [title, when] = l.split('|').map((s) => s.trim());
      return { title, when };
    })
    .filter((t) => t.title && t.title.length > 3)
    .slice(0, 5);
  return { body, tasks };
}

export async function runStep(env, runId, idx) {
  const r = await first(env, 'SELECT * FROM agent_runs WHERE id = ?', runId);
  if (!r || r.status === 'failed') return;
  const plan = JSON.parse(r.plan || '[]');
  const results = JSON.parse(r.results || '[]');
  const step = plan[idx];
  if (!step) {
    await env.QUEUE.send({ type: 'agent_finalize', runId });
    return;
  }
  const agent = BY_ID[step.agent];
  if (idx === 0) {
    // Yang belum bertugas kembali ke meja masing-masing setelah briefing.
    for (const a of plan) if (a.agent !== step.agent) await setAgent(env, a.agent, 'idle', 'Menunggu giliran', '', runId);
    await setAgent(env, 'ceo', 'thinking', 'Memantau kerja tim', '', runId);
  }
  await setAgent(env, agent.id, 'working', step.task, smartModel(env), runId);
  await logEvent(env, runId, agent.id, 'start', step.task);

  const [ctx, tctx] = await Promise.all([sharedContext(env, r.command + ' ' + step.task), teamContext(env, agent)]);
  const previous = results.length
    ? 'HASIL REKAN SEBELUMNYA:\n' + results.map((x) => `[${BY_ID[x.agent]?.name}] ${truncate(x.output, 2500)}`).join('\n\n')
    : '';
  const system = `Kamu ${agent.name}, ${agent.title} di tim AI milik ${env.OWNER_NAME || 'pemilik'}. ${agent.role}
Bekerja dalam Bahasa Indonesia. Hasilmu harus konkret, spesifik untuk bisnis pemilik, dan langsung bisa dipakai. Pakai Markdown sederhana (judul, poin). Jangan basa-basi.
Kalau ada pekerjaan lanjutan yang perlu dijadwalkan untuk pemilik, tambahkan di bagian paling akhir:
TUGAS:
- judul tugas | YYYY-MM-DD HH:mm
(Lewati bagian TUGAS kalau tidak perlu.)`;
  const prompt = `${ctx}\n\n${tctx}\n\n${previous}\n\nPERINTAH AWAL PEMILIK: ${r.command}\nTUGASMU DARI CEO: ${step.task}`;

  let out;
  try {
    out = await smartChat(env, { system, messages: [{ role: 'user', content: prompt }], maxTokens: step.heavy ? 8000 : 5000, effort: step.heavy ? 'high' : 'medium', fallback: false });
  } catch (e) {
    await logEvent(env, runId, agent.id, 'error', `Gagal: ${e?.message || e}`);
    out = { text: `(${agent.name} gagal menyelesaikan tugas: ${e?.message || e})`, model: '' };
  }
  const { body, tasks } = parseNewTasks(out.text);
  const createdTasks = [];
  for (const t of tasks) {
    try {
      const task = await addTask(env, { title: t.title, due_at: parseLocal(env, t.when), source: 'agen' });
      createdTasks.push(task);
    } catch {}
  }
  results.push({ agent: agent.id, task: step.task, output: body, model: out.model, tasks: createdTasks.map((t) => t.id) });
  await run(env, 'UPDATE agent_runs SET results = ? WHERE id = ?', JSON.stringify(results), runId);
  await logEvent(env, runId, agent.id, 'result', body + (createdTasks.length ? `\n\n📌 ${createdTasks.length} tugas dibuat.` : ''), out.model);
  await setAgent(env, agent.id, 'delivering', 'Menyerahkan hasil ke CEO', out.model, runId);
  await env.QUEUE.send({ type: 'agent_step', runId, idx: idx + 1 }, { delaySeconds: 2 });
}

export async function finalizeRun(env, runId) {
  const r = await first(env, 'SELECT * FROM agent_runs WHERE id = ?', runId);
  if (!r || r.status === 'done') return;
  const results = JSON.parse(r.results || '[]');
  for (const x of results) await setAgent(env, x.agent, 'idle', '', '', runId);
  await setAgent(env, 'ceo', 'thinking', 'Menyusun laporan akhir', '', runId);
  const material = results.map((x) => `### ${BY_ID[x.agent]?.name} — ${BY_ID[x.agent]?.title}\nTugas: ${x.task}\n\n${x.output}`).join('\n\n');
  let report;
  try {
    const out = await smartChat(env, { fallback: false, maxTokens: 4000, system: `Kamu ${BY_ID.ceo.name}, CEO. ${BY_ID.ceo.role} Bahasa Indonesia, tegas, ringkas.`, messages: [{
      role: 'user',
      content: `PERINTAH PEMILIK: ${r.command}\n\nHASIL KERJA TIM:\n${truncate(material, 14000)}\n\nSusun laporan akhir untuk pemilik: mulai dengan "Ringkasan" (3-5 poin), lalu "Rekomendasi & langkah berikutnya" (urut prioritas). Jangan mengulang seluruh isi hasil tim.`,
    }] });
    report = out.text;
    await logEvent(env, runId, 'ceo', 'report', report, out.model);
  } catch (e) {
    report = `(CEO gagal menyusun ringkasan: ${e?.message || e}. Lihat hasil tim di bawah.)`;
  }
  const full = `# Laporan Tim\n\n**Perintah:** ${r.command}\n\n${report}\n\n---\n\n## Detail hasil tim\n\n${material}`;
  const note = await addNote(env, { title: `Laporan Tim #${runId}: ${truncate(r.command, 80)}`, content: full, tags: 'laporan-tim', source: 'agen' });
  await run(env, "UPDATE agent_runs SET status = 'done', report = ?, note_id = ?, finished_at = ? WHERE id = ?", report, note.id, Date.now(), runId);
  await setAgent(env, 'ceo', 'idle', '', '', runId);
  await resetAgents(env, runId);
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) {
    await sendText(env, `🏢 Laporan Tim #${runId}\n${truncate(r.command, 120)}\n\n${truncate(report, 3300)}\n\nDetail lengkap: Catatan #${note.id}`);
  }
}

export async function failRun(env, runId, error) {
  await run(env, "UPDATE agent_runs SET status = 'failed', report = ?, finished_at = ? WHERE id = ?", String(error).slice(0, 500), Date.now(), runId);
  await logEvent(env, runId, 'ceo', 'error', `Run gagal: ${error}`);
  await resetAgents(env, runId);
}
