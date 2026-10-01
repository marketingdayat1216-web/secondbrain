// Tugas, catatan, profil: operasi data yang dipakai bot, website, agen, dan MCP.

import { all, first, run, getSetting, setSetting } from './db.js';
import { upsertVector, deleteVectors, searchContext } from './memory.js';
import { startOfLocalDay, DAY } from './time.js';

const PRIORITIES = ['low', 'normal', 'high'];

function normPriority(p) {
  p = String(p || 'normal').toLowerCase();
  if (['tinggi', 'penting', 'urgent', 'high'].includes(p)) return 'high';
  if (['rendah', 'low'].includes(p)) return 'low';
  return PRIORITIES.includes(p) ? p : 'normal';
}

// ---------- Tugas ----------

export async function addTask(env, { title, notes = '', due_at = null, remind_at = null, priority = 'normal', source = 'web' }) {
  title = String(title || '').trim();
  if (!title) throw new Error('Judul tugas kosong');
  // Kalau ada tenggat tapi tidak ada pengingat, ingatkan tepat di tenggat.
  if (remind_at === null && due_at) remind_at = due_at;
  return first(
    env,
    `INSERT INTO tasks (title, notes, status, priority, due_at, remind_at, reminded, source, created_at)
     VALUES (?, ?, 'todo', ?, ?, ?, 0, ?, ?) RETURNING *`,
    title.slice(0, 300), String(notes || ''), normPriority(priority), due_at, remind_at, source, Date.now(),
  );
}

export function getTask(env, id) {
  return first(env, 'SELECT * FROM tasks WHERE id = ?', id);
}

export function listTasks(env, { status = 'todo', q = '', limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    where.push('status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(notes) LIKE ?)');
    params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  const order = status === 'done'
    ? 'done_at DESC'
    : `due_at IS NULL, due_at ASC, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC`;
  return all(env, `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`, ...params, limit);
}

export async function updateTask(env, id, fields) {
  const task = await getTask(env, id);
  if (!task) return null;
  const next = { ...task };
  if (fields.title !== undefined) next.title = String(fields.title).slice(0, 300);
  if (fields.notes !== undefined) next.notes = String(fields.notes);
  if (fields.priority !== undefined) next.priority = normPriority(fields.priority);
  if (fields.due_at !== undefined) next.due_at = fields.due_at;
  if (fields.remind_at !== undefined) next.remind_at = fields.remind_at;
  else if (fields.due_at !== undefined && (task.remind_at === task.due_at || task.remind_at === null)) next.remind_at = fields.due_at;
  if (next.remind_at !== task.remind_at) next.reminded = 0;
  if (fields.status !== undefined && fields.status !== task.status) {
    next.status = fields.status === 'done' ? 'done' : 'todo';
    next.done_at = next.status === 'done' ? Date.now() : null;
  }
  await run(
    env,
    'UPDATE tasks SET title = ?, notes = ?, priority = ?, due_at = ?, remind_at = ?, reminded = ?, status = ?, done_at = ? WHERE id = ?',
    next.title, next.notes, next.priority, next.due_at, next.remind_at, next.reminded, next.status, next.done_at, id,
  );
  return next;
}

export function completeTask(env, id) {
  return updateTask(env, id, { status: 'done' });
}

export async function deleteTask(env, id) {
  await run(env, 'DELETE FROM tasks WHERE id = ?', id);
}

export async function taskStats(env) {
  const now = Date.now();
  const dayStart = startOfLocalDay(env, now);
  const dayEnd = dayStart + DAY;
  const row = await first(
    env,
    `SELECT
       SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN status = 'todo' AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN status = 'todo' AND due_at >= ? AND due_at < ? THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN status = 'done' AND done_at >= ? THEN 1 ELSE 0 END) AS done_today
     FROM tasks`,
    now, dayStart, dayEnd, dayStart,
  );
  return {
    open: row?.open || 0,
    overdue: row?.overdue || 0,
    today: row?.today || 0,
    done_today: row?.done_today || 0,
  };
}

// ---------- Catatan ----------

function noteText(n) {
  return `${n.title}\n${n.tags ? 'Tag: ' + n.tags + '\n' : ''}${n.content}`;
}

export async function addNote(env, { title, content = '', tags = '', source = 'web' }) {
  const now = Date.now();
  title = String(title || '').trim() || String(content).trim().split('\n')[0].slice(0, 80) || 'Catatan';
  const note = await first(
    env,
    'INSERT INTO notes (title, content, tags, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    title.slice(0, 200), String(content), normTags(tags), source, now, now,
  );
  await upsertVector(env, 'n:' + note.id, noteText(note), { type: 'note' });
  return note;
}

function normTags(tags) {
  if (Array.isArray(tags)) tags = tags.join(',');
  return String(tags || '')
    .split(',')
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
    .join(', ');
}

export function getNote(env, id) {
  return first(env, 'SELECT * FROM notes WHERE id = ?', id);
}

export async function updateNote(env, id, fields) {
  const note = await getNote(env, id);
  if (!note) return null;
  const next = {
    ...note,
    title: fields.title !== undefined ? String(fields.title).slice(0, 200) : note.title,
    content: fields.content !== undefined ? String(fields.content) : note.content,
    tags: fields.tags !== undefined ? normTags(fields.tags) : note.tags,
    updated_at: Date.now(),
  };
  await run(env, 'UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?', next.title, next.content, next.tags, next.updated_at, id);
  await upsertVector(env, 'n:' + id, noteText(next), { type: 'note' });
  return next;
}

export async function deleteNote(env, id) {
  await run(env, 'DELETE FROM notes WHERE id = ?', id);
  await deleteVectors(env, ['n:' + id]);
}

export async function listNotes(env, { q = '', semantic = false, limit = 100 } = {}) {
  if (q && semantic) {
    const ctx = await searchContext(env, q, { topK: 12, minScore: 0.35 });
    return ctx.notes;
  }
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    return all(
      env,
      'SELECT * FROM notes WHERE LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ? ORDER BY updated_at DESC LIMIT ?',
      like, like, like, limit,
    );
  }
  return all(env, 'SELECT * FROM notes ORDER BY updated_at DESC LIMIT ?', limit);
}

// ---------- Profil ----------

export const PROFILE_QUESTIONS = [
  { key: 'diri', q: 'Kenalan dulu ya. Siapa nama panggilanmu dan apa peranmu sehari-hari (mis. pemilik bisnis, marketer, freelancer)?' },
  { key: 'bisnis', q: 'Ceritakan bisnis atau pekerjaanmu: produk/jasa apa yang kamu jual, dan kisaran harganya?' },
  { key: 'pelanggan', q: 'Siapa pelanggan idealmu? (umur, profesi, masalah yang mereka alami, di mana mereka berada)' },
  { key: 'target', q: 'Apa target terbesarmu 3 bulan ke depan? Kalau bisa dengan angka.' },
  { key: 'kompetitor', q: 'Siapa saja kompetitor atau brand yang kamu pantau? (boleh nama halaman Facebook/IG)' },
  { key: 'ritme', q: 'Bagaimana ritme kerjamu? Jam produktif, kebiasaan, dan hal yang sering bikin kamu lupa/keteteran.' },
  { key: 'gaya', q: 'Terakhir: kamu mau aku berkomunikasi seperti apa? (santai/formal, singkat/detail, pakai emoji atau tidak)' },
];

export async function getProfile(env) {
  return {
    answers: (await getSetting(env, 'profile_answers', {})) || {},
    summary: (await getSetting(env, 'profile_summary', '')) || '',
    questions: PROFILE_QUESTIONS,
  };
}

export async function saveProfileAnswers(env, answers) {
  const current = (await getSetting(env, 'profile_answers', {})) || {};
  const next = { ...current, ...answers };
  await setSetting(env, 'profile_answers', next);
  return next;
}

export async function setProfileSummary(env, summary) {
  await setSetting(env, 'profile_summary', summary);
}

// ---------- Riwayat chat ----------

export async function saveMessage(env, channel, role, content) {
  await run(env, 'INSERT INTO messages (channel, role, content, created_at) VALUES (?, ?, ?, ?)', channel, role, String(content).slice(0, 8000), Date.now());
}

export async function recentMessages(env, channel, limit = 10) {
  const rows = await all(env, 'SELECT role, content, created_at FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?', channel, limit);
  return rows.reverse();
}
