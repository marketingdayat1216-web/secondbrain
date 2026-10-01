// Memori jangka panjang + pencarian berdasarkan makna (Workers AI embeddings + Vectorize).
// Kalau Vectorize/AI tidak tersedia (mis. dev lokal), jatuh ke pencarian kata kunci di D1.

import { all, first, run } from './db.js';

const EMBED_MODEL = '@cf/baai/bge-m3'; // multibahasa, 1024 dimensi

export async function embed(env, texts) {
  const arr = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || ' ').slice(0, 6000));
  const res = await env.AI.run(EMBED_MODEL, { text: arr });
  const vectors = res?.data || res?.response;
  if (!Array.isArray(vectors) || !Array.isArray(vectors[0])) throw new Error('Embedding tidak valid');
  return vectors;
}

export async function upsertVector(env, id, text, metadata = {}) {
  if (!env.VECTORIZE) return false;
  try {
    const [values] = await embed(env, text);
    await env.VECTORIZE.upsert([{ id, values, metadata }]);
    return true;
  } catch (e) {
    console.error('upsertVector', id, e?.message);
    return false;
  }
}

export async function deleteVectors(env, ids) {
  if (!env.VECTORIZE || !ids.length) return;
  try {
    await env.VECTORIZE.deleteByIds(ids);
  } catch (e) {
    console.error('deleteVectors', e?.message);
  }
}

async function vectorQuery(env, query, topK) {
  if (!env.VECTORIZE) return null;
  try {
    const [v] = await embed(env, query);
    const res = await env.VECTORIZE.query(v, { topK, returnMetadata: 'all' });
    return res.matches || [];
  } catch (e) {
    console.error('vectorQuery', e?.message);
    return null;
  }
}

function keywordsOf(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/i)
    .filter((w) => w.length > 2)
    .slice(0, 6);
}

async function keywordSearch(env, table, cols, query, limit) {
  const words = keywordsOf(query);
  if (!words.length) return [];
  const conds = words.map(() => `(${cols.map((c) => `LOWER(${c}) LIKE ?`).join(' OR ')})`).join(' OR ');
  const params = words.flatMap((w) => cols.map(() => `%${w}%`));
  return all(env, `SELECT * FROM ${table} WHERE ${conds} ORDER BY updated_at DESC LIMIT ?`, ...params, limit);
}

// Cari memori & catatan yang relevan dengan sebuah teks.
export async function searchContext(env, query, { topK = 8, minScore = 0.42 } = {}) {
  const out = { memories: [], notes: [] };
  if (!query || !String(query).trim()) return out;
  const matches = await vectorQuery(env, query, topK);
  if (matches) {
    const memIds = [];
    const noteIds = [];
    const scores = {};
    for (const m of matches) {
      if (m.score < minScore) continue;
      const [kind, rawId] = String(m.id).split(':');
      const id = Number(rawId);
      scores[m.id] = m.score;
      if (kind === 'm') memIds.push(id);
      else if (kind === 'n') noteIds.push(id);
    }
    if (memIds.length) {
      const rows = await all(env, `SELECT * FROM memories WHERE id IN (${memIds.map(() => '?').join(',')})`, ...memIds);
      out.memories = rows.map((r) => ({ ...r, score: scores['m:' + r.id] })).sort((a, b) => b.score - a.score);
    }
    if (noteIds.length) {
      const rows = await all(env, `SELECT * FROM notes WHERE id IN (${noteIds.map(() => '?').join(',')})`, ...noteIds);
      out.notes = rows.map((r) => ({ ...r, score: scores['n:' + r.id] })).sort((a, b) => b.score - a.score);
    }
    if (out.memories.length || out.notes.length) return out;
  }
  out.memories = await keywordSearch(env, 'memories', ['content'], query, 5);
  out.notes = await keywordSearch(env, 'notes', ['title', 'content', 'tags'], query, 5);
  return out;
}

export async function remember(env, content, { category = 'lainnya', source = 'chat' } = {}) {
  content = String(content || '').trim();
  if (!content) return null;
  const now = Date.now();
  // Hindari duplikat: fakta yang sangat mirip diperbarui, bukan ditambah.
  const matches = await vectorQuery(env, content, 3);
  const dup = matches?.find((m) => String(m.id).startsWith('m:') && m.score >= 0.9);
  if (dup) {
    const id = Number(String(dup.id).slice(2));
    const existing = await first(env, 'SELECT * FROM memories WHERE id = ?', id);
    if (existing) {
      await run(env, 'UPDATE memories SET content = ?, category = ?, updated_at = ? WHERE id = ?', content, category, now, id);
      await upsertVector(env, 'm:' + id, content, { type: 'memory' });
      return { ...existing, content, category, updated: true };
    }
  }
  const row = await first(
    env,
    'INSERT INTO memories (content, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
    content, category, source, now, now,
  );
  await upsertVector(env, 'm:' + row.id, content, { type: 'memory' });
  return row;
}

export async function updateMemory(env, id, { content, category }) {
  const row = await first(env, 'SELECT * FROM memories WHERE id = ?', id);
  if (!row) return null;
  const next = { content: content ?? row.content, category: category ?? row.category };
  await run(env, 'UPDATE memories SET content = ?, category = ?, updated_at = ? WHERE id = ?', next.content, next.category, Date.now(), id);
  if (content !== undefined) await upsertVector(env, 'm:' + id, next.content, { type: 'memory' });
  return { ...row, ...next };
}

export async function forget(env, id) {
  await run(env, 'DELETE FROM memories WHERE id = ?', id);
  await deleteVectors(env, ['m:' + id]);
}

export function listMemories(env, { q = '', limit = 200 } = {}) {
  if (q) return keywordSearch(env, 'memories', ['content', 'category'], q, limit);
  return all(env, 'SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?', limit);
}
