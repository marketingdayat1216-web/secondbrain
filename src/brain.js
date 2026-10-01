// Otak asisten: pahami pesan → jalankan aksi (tugas, catatan, memori, tim agen, email) → balas.

import { fastJson, fastChat, hasSmart } from './ai.js';
import { searchContext, remember, forget } from './memory.js';
import {
  addTask, completeTask, updateTask, deleteTask, getTask, listTasks, addNote,
  getProfile, saveMessage, recentMessages,
} from './store.js';
import { nowDescription, parseLocal, toLocalInput, fmtLocal } from './time.js';
import { truncate } from './util.js';
import { isGoogleConnected, listEmails, searchDrive } from './google.js';
import { startRun } from './agents.js';

export async function buildContext(env, text, { taskLimit = 30 } = {}) {
  const [profile, tasks, ctx, google] = await Promise.all([
    getProfile(env),
    listTasks(env, { status: 'todo', limit: taskLimit }),
    searchContext(env, text).catch(() => ({ memories: [], notes: [] })),
    isGoogleConnected(env).catch(() => false),
  ]);
  return { profile, tasks, ctx, google };
}

function taskLine(env, t) {
  return `#${t.id} ${t.title}${t.due_at ? ' — tenggat ' + toLocalInput(env, t.due_at) : ''}${t.priority === 'high' ? ' [penting]' : ''}`;
}

export function contextBlock(env, { profile, tasks, ctx }) {
  const parts = [];
  parts.push(`PROFIL PEMILIK:\n${profile.summary || '(belum diisi — sarankan pengguna mengetik /profil)'}`);
  parts.push(`TUGAS AKTIF:\n${tasks.length ? tasks.map((t) => taskLine(env, t)).join('\n') : '(tidak ada)'}`);
  if (ctx.memories.length) parts.push(`MEMORI RELEVAN:\n${ctx.memories.map((m) => `- (memori #${m.id}) ${m.content}`).join('\n')}`);
  if (ctx.notes.length) parts.push(`CATATAN RELEVAN:\n${ctx.notes.map((n) => `- (catatan #${n.id}) ${n.title}: ${truncate(n.content.replace(/\s+/g, ' '), 400)}`).join('\n')}`);
  return parts.join('\n\n');
}

function systemPrompt(env, context, { google, hint }) {
  const owner = env.OWNER_NAME || 'Bos';
  return `Kamu adalah ${env.APP_NAME || 'Second Brain'}, asisten pribadi dan "otak kedua" milik ${owner}. Selalu berbahasa Indonesia, hangat, ringkas, dan praktis. Panggil pengguna "${owner}".
Waktu sekarang: ${nowDescription(env)}.

${context}

INTEGRASI: Gmail/Drive ${google ? 'terhubung' : 'belum terhubung'}. Penulis konten Claude Opus ${hasSmart(env) ? 'aktif' : 'tidak aktif (pakai model gratis)'}.

Tugasmu: pahami pesan terakhir pengguna, tentukan aksi, lalu balas. Keluarkan HANYA JSON dengan bentuk:
{"actions": [ ... ], "reply": "teks balasan untuk pengguna"}

Aksi yang tersedia:
- {"type":"add_task","title":"...","due":"YYYY-MM-DD HH:mm atau null","remind":"YYYY-MM-DD HH:mm atau null","priority":"low|normal|high","notes":"..."}
- {"type":"complete_task","id":123}
- {"type":"update_task","id":123,"title":"...","due":"...","remind":"...","priority":"..."}  (isi hanya yang berubah)
- {"type":"delete_task","id":123}
- {"type":"add_note","title":"...","content":"...","tags":"tag1, tag2"}
- {"type":"remember","fact":"...","category":"pribadi|bisnis|preferensi|orang|target|lainnya"}
- {"type":"forget","id":12}  (hapus memori)
- {"type":"run_agents","command":"instruksi lengkap untuk tim"}
- {"type":"write_content","brief":"brief lengkap: jenis konten, topik, jumlah, gaya"}
- {"type":"check_email","query":"sintaks pencarian Gmail, mis. is:unread newer_than:2d"}
- {"type":"search_drive","query":"kata kunci"}

Aturan:
1. Hal yang perlu dikerjakan ("besok jam 9 telpon Pak Budi", "jangan lupa bayar listrik") → add_task. Hitung tanggal relatif dari waktu sekarang. Waktu memakai zona lokal pengguna. Tanpa jam → pakai 09:00. "ingatkan aku 30 menit lagi" → isi remind.
2. Informasi, ide, link, atau pesan terusan yang layak disimpan → add_note dengan judul yang jelas.
3. Fakta jangka panjang yang penting (bisnis, preferensi, orang penting, target, kebiasaan) → remember, ditulis singkat sebagai orang ketiga ("${owner} ..."). Jangan simpan hal sepele atau yang sudah ada di memori.
4. Pengguna bilang sudah menyelesaikan sesuatu yang ada di TUGAS AKTIF → complete_task dengan id yang cocok.
5. Pertanyaan → jawab di "reply" berdasarkan profil, memori, catatan, dan tugas di atas. Kalau tidak tahu, bilang jujur. Jangan mengarang.
6. Permintaan riset, strategi, perencanaan, atau analisis besar untuk tim → run_agents.
7. Permintaan tulisan panjang (caption, artikel, script video, copy iklan, email penawaran) → write_content.
8. Obrolan biasa → "actions": [].
9. "reply" singkat (1-4 kalimat). Jangan mengulang detail tugas/catatan yang dibuat; sistem akan menambahkan ringkasannya.${hint ? '\n\nCATATAN KHUSUS: ' + hint : ''}`;
}

// Jalankan satu pesan pengguna. channel: 'telegram' | 'web'.
export async function handleMessage(env, { text, channel = 'telegram', hint = '' }) {
  text = String(text || '').trim();
  if (!text) return { reply: 'Pesannya kosong 🙂', lines: [], created: [] };

  const context = await buildContext(env, text);
  const history = await recentMessages(env, channel, 6);
  const messages = [
    ...history.map((m) => ({ role: m.role, content: truncate(m.content, 1500) })),
    { role: 'user', content: text },
  ];

  const system = systemPrompt(env, contextBlock(env, context), { google: context.google, hint });
  let plan;
  try {
    const r = await fastJson(env, messages, { system, maxTokens: 1800 });
    plan = r.data;
  } catch (e) {
    console.error('brain fastJson', e?.message);
    throw new Error('Otak AI sedang bermasalah. Coba lagi sebentar lagi.');
  }

  if (!plan || typeof plan !== 'object') {
    const fallback = await fastChat(env, messages, { system: `Kamu asisten pribadi ${env.OWNER_NAME || ''}. Jawab singkat dalam Bahasa Indonesia.\n\n${contextBlock(env, context)}` });
    await saveMessage(env, channel, 'user', text);
    await saveMessage(env, channel, 'assistant', fallback.text);
    return { reply: fallback.text, lines: [], created: [] };
  }

  const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, 10) : [];
  let reply = String(plan.reply || '').trim();
  const result = await executeActions(env, actions, { channel, userText: text });

  // Aksi yang butuh data luar → minta AI menyusun ulang jawaban dengan data itu.
  if (result.lookups.length) {
    const r = await fastChat(env, [{ role: 'user', content: text }], {
      system: `Kamu asisten pribadi ${env.OWNER_NAME || ''}. Waktu sekarang: ${nowDescription(env)}. Jawab pertanyaan pengguna secara ringkas dan berguna dalam Bahasa Indonesia berdasarkan data berikut. Sebutkan hal penting dulu.\n\n${result.lookups.join('\n\n')}`,
      maxTokens: 1200,
    });
    reply = r.text;
  }

  if (!reply) reply = result.lines.length ? 'Siap, sudah kucatat.' : 'Oke!';
  await saveMessage(env, channel, 'user', text);
  await saveMessage(env, channel, 'assistant', [reply, ...result.lines].join('\n'));
  return { reply, lines: result.lines, created: result.created };
}

export async function executeActions(env, actions, { channel = 'telegram', userText = '' } = {}) {
  const lines = [];
  const created = [];
  const lookups = [];
  const source = channel;

  for (const a of actions) {
    try {
      switch (a?.type) {
        case 'add_task': {
          const due = parseLocal(env, a.due);
          const remind = a.remind ? parseLocal(env, a.remind) : null;
          const t = await addTask(env, { title: a.title, notes: a.notes || '', due_at: due, remind_at: remind, priority: a.priority, source });
          created.push({ kind: 'task', item: t });
          const when = t.remind_at && t.remind_at !== t.due_at
            ? ` · ⏰ ${fmtLocal(env, t.remind_at)}`
            : t.due_at ? ` · ${fmtLocal(env, t.due_at)}` : '';
          lines.push(`📌 Tugas #${t.id}: ${t.title}${when}${t.priority === 'high' ? ' · penting' : ''}`);
          break;
        }
        case 'complete_task': {
          const t = await completeTask(env, Number(a.id));
          if (t) lines.push(`✅ Selesai: #${t.id} ${t.title}`);
          break;
        }
        case 'update_task': {
          const fields = {};
          if (a.title) fields.title = a.title;
          if (a.priority) fields.priority = a.priority;
          if (a.due) fields.due_at = parseLocal(env, a.due);
          if (a.remind) fields.remind_at = parseLocal(env, a.remind);
          const t = await updateTask(env, Number(a.id), fields);
          if (t) lines.push(`✏️ Diubah: #${t.id} ${t.title}${t.due_at ? ' · ' + fmtLocal(env, t.due_at) : ''}`);
          break;
        }
        case 'delete_task': {
          const t = await getTask(env, Number(a.id));
          if (t) {
            await deleteTask(env, t.id);
            lines.push(`🗑️ Dihapus: #${t.id} ${t.title}`);
          }
          break;
        }
        case 'add_note': {
          const n = await addNote(env, { title: a.title, content: a.content || userText, tags: a.tags, source });
          created.push({ kind: 'note', item: n });
          lines.push(`📝 Catatan #${n.id}: ${n.title}`);
          break;
        }
        case 'remember': {
          const m = await remember(env, a.fact, { category: a.category || 'lainnya', source });
          if (m) lines.push(`🧠 Diingat: ${m.content}`);
          break;
        }
        case 'forget': {
          await forget(env, Number(a.id));
          lines.push(`🧠 Memori #${a.id} dihapus`);
          break;
        }
        case 'run_agents': {
          const run = await startRun(env, String(a.command || userText), { source });
          lines.push(`🏢 Tim sedang mengerjakan (run #${run.id}). Pantau di Kantor 3D; laporannya akan dikirim ke sini.`);
          break;
        }
        case 'write_content': {
          await env.QUEUE.send({ type: 'write_content', brief: String(a.brief || userText), channel });
          lines.push(`✍️ Konten sedang ditulis${hasSmart(env) ? ' oleh Claude Opus' : ''}. Hasilnya dikirim ke Telegram & disimpan di Catatan.`);
          break;
        }
        case 'check_email': {
          if (!(await isGoogleConnected(env))) {
            lines.push('📭 Gmail belum terhubung. Hubungkan di website: Sistem → Hubungkan Google.');
            break;
          }
          const mails = await listEmails(env, a.query || 'is:unread newer_than:2d', 10);
          lookups.push(`EMAIL (${mails.length}):\n${mails.map((m) => `- Dari ${m.from} | ${m.subject} | ${m.date}\n  ${m.snippet}`).join('\n') || '(tidak ada email yang cocok)'}`);
          break;
        }
        case 'search_drive': {
          if (!(await isGoogleConnected(env))) {
            lines.push('📁 Google Drive belum terhubung. Hubungkan di website: Sistem → Hubungkan Google.');
            break;
          }
          const files = await searchDrive(env, a.query || userText, 8);
          lookups.push(`FILE GOOGLE DRIVE:\n${files.map((f) => `- ${f.name} (${f.modifiedTime?.slice(0, 10)}) ${f.webViewLink}`).join('\n') || '(tidak ada file yang cocok)'}`);
          break;
        }
        default:
          break;
      }
    } catch (e) {
      console.error('aksi gagal', a?.type, e?.message);
      lines.push(`⚠️ Gagal menjalankan ${a?.type}: ${e?.message || e}`);
    }
  }
  return { lines, created, lookups };
}
