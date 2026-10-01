// Pembungkus tipis D1 + penyimpanan pengaturan key/value.

export async function all(env, sql, ...params) {
  const res = await env.DB.prepare(sql).bind(...params).all();
  return res.results || [];
}

export function first(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}

export function run(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

export async function getSetting(env, key, def = null) {
  const row = await first(env, 'SELECT value FROM settings WHERE key = ?', key);
  if (!row) return def;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export async function setSetting(env, key, value) {
  await run(
    env,
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

export async function delSetting(env, key) {
  await run(env, 'DELETE FROM settings WHERE key = ?', key);
}
