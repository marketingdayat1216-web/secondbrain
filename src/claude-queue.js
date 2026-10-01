// Antrean analisa untuk Claude langganan (tanpa API key).
// Server tidak bisa memakai langganan Claude, jadi pekerjaan analisa dikumpulkan di sini lalu
// dikerjakan Claude (claude.ai / desktop / Claude Code) lewat konektor MCP dan hasilnya disimpan balik.

import { all, first, run } from './db.js';
import { ANGLES, HOOKS, decorateAd } from './competitor.js';
import { AGENTS, logEvent, setAgent } from './agents.js';
import { addNote, getProfile, listTasks } from './store.js';
import { sendText } from './telegram-api.js';
import { truncate } from './util.js';
import { toLocalInput, nowDescription } from './time.js';

export const CLAUDE_MODEL = 'claude-subscription';
export const CLAUDE_PROMPT = 'Kerjakan semua antrean analisa di Second Brain (get_pending_work), simpan semua hasilnya.';

export async function pendingCounts(env) {
  const row = await first(env, `SELECT
    (SELECT COUNT(*) FROM competitor_ads WHERE angle = '') AS scores,
    (SELECT COUNT(*) FROM competitor_ads WHERE analysis_status = 'claude') AS reports,
    (SELECT COUNT(*) FROM competitor_ads WHERE variations_status = 'claude') AS contents,
    (SELECT COUNT(*) FROM agent_runs WHERE status = 'waiting_claude') AS teams,
    (SELECT COUNT(*) FROM claude_tasks WHERE status = 'pending') AS writes`);
  const c = { scores: row?.scores || 0, reports: row?.reports || 0, contents: row?.contents || 0, teams: row?.teams || 0, writes: row?.writes || 0 };
  return { ...c, total: c.scores + c.reports + c.contents + c.teams + c.writes, prompt: CLAUDE_PROMPT };
}

export async function queueWrite(env, brief, channel = 'web') {
  return first(env, "INSERT INTO claude_tasks (kind, payload, created_at) VALUES ('write', ?, ?) RETURNING *", JSON.stringify({ brief, channel }), Date.now());
}

function adBlock(a) {
  const d = decorateAd(a);
  return `[iklan id=${a.id}] ${a.page_name} | Library ID ${a.library_id} | kata kunci "${a.keyword}" | ${d.rank ? 'impresi #' + d.rank : 'urutan impresi tidak diketahui'} | tayang ${d.days_running ?? '?'} hari | ${a.variants} duplikat | CTA ${a.cta || '-'} | ${a.landing || ''}
Teks: """${truncate(a.body || a.headline || '(tanpa teks)', 1500)}"""
Media: ${d.media.slice(0, 3).map((m) => m.display).join(' , ') || '-'}`;
}

// Teks lengkap untuk Claude: apa yang harus dikerjakan + tool penyimpannya.
export async function pendingWork(env) {
  const [profile, scores, reports, contents, teams, writes] = await Promise.all([
    getProfile(env),
    all(env, "SELECT * FROM competitor_ads WHERE angle = '' ORDER BY rank IS NULL, rank LIMIT 25"),
    all(env, "SELECT * FROM competitor_ads WHERE analysis_status = 'claude' LIMIT 5"),
    all(env, "SELECT * FROM competitor_ads WHERE variations_status = 'claude' LIMIT 5"),
    all(env, "SELECT * FROM agent_runs WHERE status = 'waiting_claude' ORDER BY id LIMIT 3"),
    all(env, "SELECT * FROM claude_tasks WHERE status = 'pending' ORDER BY id LIMIT 5"),
  ]);
  const parts = [`Waktu: ${nowDescription(env)}\nPROFIL PEMILIK (${env.OWNER_NAME || 'pemilik'}): ${profile.summary || '(belum diisi)'}`];
  if (scores.length) {
    parts.push(`## A. Nilai iklan (${scores.length}) → simpan dengan save_ad_scores
Untuk setiap iklan: score 0-100 (kekuatan copy), angle (${ANGLES.join(' / ')}), hook (${HOOKS.join(' / ')}), promo (ada diskon/harga/gratis ongkir/COD), risky (klaim berlebihan/berisiko melanggar kebijakan iklan), worth_copy (polanya layak ditiru), reason (1 kalimat).

${scores.map(adBlock).join('\n\n')}`);
  }
  if (reports.length) {
    parts.push(`## B. Laporan bedah iklan (${reports.length}) → simpan masing-masing dengan save_ad_report
Bahasa Indonesia, Markdown: 1) Ringkasan kenapa menang 2) Hook 3) Angle & emosi 4) Penawaran & bukti 5) Struktur copy & CTA 6) Visual (buka URL media bila bisa) 7) Kelemahan/celah 8) Cara mengadaptasi untuk bisnis pemilik.

${reports.map(adBlock).join('\n\n')}`);
  }
  if (contents.length) {
    parts.push(`## C. Bikin 5 konten mirip (${contents.length}) → simpan masing-masing dengan save_ad_content
Tiru POLA (hook, angle, struktur), bukan kalimatnya, untuk bisnis pemilik. Tiap konten: "### Konten N — [format]" lalu Hook, Copy/script lengkap, Ide visual, CTA, Kenapa akan bekerja.

${contents.map(adBlock).join('\n\n')}`);
  }
  if (teams.length) {
    const tasks = await listTasks(env, { status: 'todo', limit: 20 });
    const ads = await all(env, 'SELECT * FROM competitor_ads ORDER BY COALESCE(score, 0) DESC LIMIT 6');
    parts.push(`## D. Perintah untuk tim AI (${teams.length}) → simpan masing-masing dengan save_team_result
Kerjakan sebagai tim: CEO memecah perintah jadi 1-4 tugas untuk anggota yang cocok, tiap anggota menghasilkan output konkret (Markdown), lalu CEO menulis laporan akhir (Ringkasan 3-5 poin + Rekomendasi berurutan).
Anggota (pakai id ini di field agent): ${AGENTS.filter((x) => x.id !== 'ceo').map((x) => `${x.id} = ${x.name}, ${x.title}`).join('; ')}.
Tugas aktif pemilik: ${tasks.map((t) => `#${t.id} ${t.title}${t.due_at ? ' (' + toLocalInput(env, t.due_at) + ')' : ''}`).join('; ') || '-'}
Iklan kompetitor terkuat: ${ads.map((a) => `${a.page_name}: "${truncate((a.headline || a.body).replace(/\s+/g, ' '), 120)}"`).join(' | ') || '-'}

${teams.map((r) => `[run id=${r.id}] ${r.command}`).join('\n')}`);
  }
  if (writes.length) {
    parts.push(`## E. Tulis konten (${writes.length}) → simpan masing-masing dengan save_writing
${writes.map((w) => `[tugas id=${w.id}] ${JSON.parse(w.payload).brief}`).join('\n')}`);
  }
  if (parts.length === 1) return 'Antrean kosong. Tidak ada yang perlu dikerjakan.';
  return parts.join('\n\n---\n\n') + '\n\nSetelah semua disimpan, panggil get_pending_work lagi untuk memastikan antrean kosong.';
}

const pick = (v, list, def) => list.find((x) => x.toLowerCase() === String(v || '').toLowerCase().trim()) || def;

export async function saveScores(env, items = []) {
  let n = 0;
  for (const s of items) {
    const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ? OR library_id = ?', Number(s.id) || -1, String(s.id));
    if (!a) continue;
    const hook = pick(s.hook, HOOKS, 'Biasa');
    await run(
      env,
      'UPDATE competitor_ads SET score = ?, score_reason = ?, score_model = ?, angle = ?, hook = ?, is_promo = ?, risky_claim = ?, worth_copy = ? WHERE id = ?',
      Math.max(0, Math.min(100, Math.round(Number(s.score) || a.score || 50))),
      String(s.reason || a.score_reason || '').slice(0, 500),
      CLAUDE_MODEL,
      pick(s.angle, ANGLES, 'Lainnya'),
      hook,
      s.promo ? 1 : 0,
      s.risky ? 1 : 0,
      s.worth_copy && hook !== 'Lemah' ? 1 : 0,
      a.id,
    );
    n++;
  }
  return n;
}

export async function saveContent(env, idOrLibrary, text) {
  const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ? OR library_id = ?', Number(idOrLibrary) || -1, String(idOrLibrary));
  if (!a) return null;
  const body = `${text}\n\n_Ditulis oleh Claude (langganan)_`;
  await run(env, "UPDATE competitor_ads SET variations = ?, variations_status = 'done' WHERE id = ?", body, a.id);
  const note = await addNote(env, { title: `5 konten mirip iklan ${a.page_name || a.library_id}`, content: body, tags: 'konten, riset-kompetitor', source: 'claude' });
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) await sendText(env, `✍️ 5 konten mirip iklan ${a.page_name} sudah jadi (Catatan #${note.id}).`);
  return a.id;
}

export async function saveTeamResult(env, runId, assignments = [], report = '') {
  const r = await first(env, 'SELECT * FROM agent_runs WHERE id = ?', runId);
  if (!r) return null;
  const byId = Object.fromEntries(AGENTS.map((x) => [x.id, x]));
  const results = assignments
    .filter((x) => x && x.output)
    .map((x) => ({ agent: byId[x.agent] ? x.agent : 'ops', task: String(x.task || ''), output: String(x.output), model: CLAUDE_MODEL, tasks: [] }));
  await logEvent(env, runId, 'ceo', 'plan', results.map((x, i) => `${i + 1}. ${byId[x.agent].name} (${byId[x.agent].title}): ${x.task}`).join('\n'), CLAUDE_MODEL);
  for (const x of results) {
    await logEvent(env, runId, x.agent, 'result', x.output, CLAUDE_MODEL);
    await setAgent(env, x.agent, 'delivering', 'Menyerahkan hasil ke CEO', CLAUDE_MODEL, runId);
  }
  await logEvent(env, runId, 'ceo', 'report', report || '(tanpa laporan akhir)', CLAUDE_MODEL);
  const material = results.map((x) => `### ${byId[x.agent].name} — ${byId[x.agent].title}\nTugas: ${x.task}\n\n${x.output}`).join('\n\n');
  const note = await addNote(env, {
    title: `Laporan Tim #${runId}: ${truncate(r.command, 80)}`,
    content: `# Laporan Tim\n\n**Perintah:** ${r.command}\n\n${report}\n\n---\n\n## Detail hasil tim\n\n${material}`,
    tags: 'laporan-tim',
    source: 'claude',
  });
  await run(env, "UPDATE agent_runs SET status = 'done', plan = ?, results = ?, report = ?, note_id = ?, finished_at = ? WHERE id = ?",
    JSON.stringify(results.map(({ agent, task }) => ({ agent, task }))), JSON.stringify(results), report, note.id, Date.now(), runId);
  await run(env, "UPDATE agents SET status = 'idle', activity = '', run_id = NULL, updated_at = ? WHERE run_id = ? OR id = 'ceo'", Date.now(), runId);
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) {
    await sendText(env, `🏢 Laporan Tim #${runId}\n${truncate(r.command, 120)}\n\n${truncate(report, 3300)}\n\nDetail lengkap: Catatan #${note.id}`);
  }
  return note.id;
}

export async function saveWriting(env, taskId, text) {
  const t = await first(env, "SELECT * FROM claude_tasks WHERE id = ? AND kind = 'write'", taskId);
  if (!t) return null;
  const { brief } = JSON.parse(t.payload);
  const note = await addNote(env, { title: `Konten: ${truncate(brief, 80)}`, content: `${text}\n\n_Ditulis oleh Claude (langganan)_`, tags: 'konten', source: 'claude' });
  await run(env, "UPDATE claude_tasks SET status = 'done', result = ?, done_at = ? WHERE id = ?", String(note.id), Date.now(), taskId);
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) await sendText(env, `✍️ Konten selesai (Catatan #${note.id}):\n\n${truncate(text, 3500)}`);
  return note.id;
}
