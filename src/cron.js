// Jalan tiap menit: pengingat tepat waktu, briefing pagi 07:00, rekap malam 21:00.

import { all, run, getSetting, setSetting } from './db.js';
import { fastChat } from './ai.js';
import { sendText, taskButtons } from './telegram-api.js';
import { getProfile, taskStats } from './store.js';
import { isGoogleConnected, listEmails } from './google.js';
import { localParts, startOfLocalDay, fmtLocal, longDate, DAY } from './time.js';
import { truncate } from './util.js';
import { dailyAutoScan } from './browser-scan.js';

const BRIEFING_HOUR = 7;
const RECAP_HOUR = 21;

export async function runCron(env) {
  await dailyAutoScan(env).catch((e) => console.error('auto scan', e?.message));
  if (!env.TELEGRAM_BOT_TOKEN || !env.OWNER_CHAT_ID) return;
  await sendDueReminders(env);
  const p = localParts(env);
  // Toleran terhadap cron yang terlewat: kirim sekali per hari dalam jendela 3 jam.
  if (p.hh >= BRIEFING_HOUR && p.hh < BRIEFING_HOUR + 3 && (await getSetting(env, 'last_briefing')) !== p.date) {
    await setSetting(env, 'last_briefing', p.date);
    await sendBriefing(env);
  }
  if (p.hh >= RECAP_HOUR && p.hh < RECAP_HOUR + 3 && (await getSetting(env, 'last_recap')) !== p.date) {
    await setSetting(env, 'last_recap', p.date);
    await sendRecap(env);
  }
}

async function sendDueReminders(env) {
  const due = await all(
    env,
    "SELECT * FROM tasks WHERE status = 'todo' AND reminded = 0 AND remind_at IS NOT NULL AND remind_at <= ? ORDER BY remind_at LIMIT 20",
    Date.now(),
  );
  for (const t of due) {
    // Tandai dulu supaya tidak terkirim dobel kalau pengiriman lambat.
    await run(env, 'UPDATE tasks SET reminded = 1 WHERE id = ?', t.id);
    const late = Date.now() - t.remind_at > 15 * 60000 ? ' (terlambat)' : '';
    await sendText(env, `⏰ Pengingat${late}: ${t.title}${t.due_at && t.due_at !== t.remind_at ? `\nTenggat: ${fmtLocal(env, t.due_at)}` : ''}${t.notes ? '\n' + truncate(t.notes, 300) : ''}`, taskButtons(t.id));
  }
}

async function gatherDay(env) {
  const now = Date.now();
  const dayStart = startOfLocalDay(env, now);
  const dayEnd = dayStart + DAY;
  const [overdue, today, tomorrow, high, doneToday, notesToday, stats, profile] = await Promise.all([
    all(env, "SELECT * FROM tasks WHERE status = 'todo' AND due_at < ? ORDER BY due_at LIMIT 15", dayStart),
    all(env, "SELECT * FROM tasks WHERE status = 'todo' AND due_at >= ? AND due_at < ? ORDER BY due_at LIMIT 20", dayStart, dayEnd),
    all(env, "SELECT * FROM tasks WHERE status = 'todo' AND due_at >= ? AND due_at < ? ORDER BY due_at LIMIT 15", dayEnd, dayEnd + DAY),
    all(env, "SELECT * FROM tasks WHERE status = 'todo' AND priority = 'high' AND (due_at IS NULL OR due_at >= ?) ORDER BY created_at DESC LIMIT 8", dayEnd),
    all(env, "SELECT * FROM tasks WHERE status = 'done' AND done_at >= ? ORDER BY done_at LIMIT 30", dayStart),
    all(env, 'SELECT id, title FROM notes WHERE created_at >= ? ORDER BY id LIMIT 15', dayStart),
    taskStats(env),
    getProfile(env),
  ]);
  return { overdue, today, tomorrow, high, doneToday, notesToday, stats, profile };
}

const list = (env, tasks, withTime = true) => tasks.map((t) => `• #${t.id} ${t.title}${withTime && t.due_at ? ` (${fmtLocal(env, t.due_at)})` : ''}`).join('\n');

export async function sendBriefing(env) {
  const d = await gatherDay(env);
  let emails = '';
  if (await isGoogleConnected(env).catch(() => false)) {
    try {
      const mails = await listEmails(env, 'is:unread newer_than:1d', 8);
      if (mails.length) emails = mails.map((m) => `• ${truncate(m.from.replace(/<.*>/, '').trim(), 30)}: ${truncate(m.subject, 70)}`).join('\n');
    } catch (e) {
      console.error('briefing email', e?.message);
    }
  }
  const sections = [`☀️ Selamat pagi, ${env.OWNER_NAME || ''}! ${longDate(env)}`];
  if (d.overdue.length) sections.push(`⚠️ Terlewat (${d.overdue.length}):\n${list(env, d.overdue)}`);
  sections.push(d.today.length ? `📅 Hari ini (${d.today.length}):\n${list(env, d.today)}` : '📅 Tidak ada tugas bertenggat hari ini.');
  if (d.high.length) sections.push(`🔥 Prioritas lain:\n${list(env, d.high, false)}`);
  if (emails) sections.push(`📧 Email belum dibaca:\n${emails}`);

  let focus = '';
  try {
    const r = await fastChat(env, [{
      role: 'user',
      content: `Profil: ${d.profile.summary || '-'}\n\n${sections.slice(1).join('\n\n')}\n\nTulis 2-3 kalimat penutup briefing pagi: sarankan 1-3 fokus utama hari ini (sebut nomor tugas) dan satu kalimat penyemangat yang tidak klise. Bahasa Indonesia, tanpa salam pembuka.`,
    }], { maxTokens: 300, temperature: 0.7 });
    focus = r.text;
  } catch {}
  if (focus) sections.push(`🎯 ${focus}`);
  await sendText(env, sections.join('\n\n'));
}

export async function sendRecap(env) {
  const d = await gatherDay(env);
  const sections = [`🌙 Rekap hari ini, ${longDate(env)}`];
  sections.push(d.doneToday.length ? `✅ Selesai (${d.doneToday.length}):\n${list(env, d.doneToday, false)}` : '✅ Belum ada tugas yang ditandai selesai hari ini.');
  const open = [...d.overdue, ...d.today];
  if (open.length) sections.push(`⏳ Masih terbuka (${open.length}):\n${list(env, open)}`);
  if (d.tomorrow.length) sections.push(`📅 Besok:\n${list(env, d.tomorrow)}`);
  if (d.notesToday.length) sections.push(`📝 Catatan baru: ${d.notesToday.map((n) => n.title).join(', ')}`);

  let reflection = '';
  try {
    const r = await fastChat(env, [{
      role: 'user',
      content: `Profil: ${d.profile.summary || '-'}\n\n${sections.slice(1).join('\n\n')}\n\nTulis 2 kalimat penutup rekap malam: apresiasi singkat yang spesifik + saran untuk tugas yang masih terbuka (pindah ke besok/dihapus/didelegasikan). Lalu ajukan satu pertanyaan refleksi singkat. Bahasa Indonesia.`,
    }], { maxTokens: 300, temperature: 0.7 });
    reflection = r.text;
  } catch {}
  if (reflection) sections.push(`💭 ${reflection}`);
  await sendText(env, sections.join('\n\n'));
}
