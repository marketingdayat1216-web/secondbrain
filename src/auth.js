// Login tanpa password: kode 6 digit dikirim ke Telegram pemilik. Sesi = cookie bertanda tangan HMAC.

import { hmac, randomDigits, sha256url, timingSafeEqual, getCookie, b64url, b64urlDecodeToString, json } from './util.js';
import { sendHtml } from './telegram-api.js';

const CODE_TTL = 300; // 5 menit
const RESEND_AFTER = 60_000;
const SESSION_DAYS = 30;
const COOKIE = 'sb_session';

export async function requestLoginCode(env, purpose = 'web') {
  const lastKey = `login:last:${purpose}`;
  const last = Number(await env.KV.get(lastKey)) || 0;
  const wait = RESEND_AFTER - (Date.now() - last);
  if (wait > 0) return { ok: false, error: `Tunggu ${Math.ceil(wait / 1000)} detik sebelum meminta kode lagi.`, wait: Math.ceil(wait / 1000) };
  const code = randomDigits(6);
  await env.KV.put(`login:code:${purpose}`, JSON.stringify({ hash: await sha256url(code + env.SESSION_SECRET), tries: 0 }), { expirationTtl: CODE_TTL });
  await env.KV.put(lastKey, String(Date.now()), { expirationTtl: 120 });
  const label = purpose === 'mcp' ? 'menghubungkan Claude (konektor MCP)' : 'masuk ke website admin';
  const sent = env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID
    ? await sendHtml(env, `🔐 Kode untuk ${label}:\n\n<code>${code}</code>\n\nBerlaku 5 menit. Abaikan kalau bukan kamu yang meminta.`)
    : { ok: false };
  const result = { ok: true, sent: Boolean(sent?.ok) };
  // Mode pengembangan lokal: tampilkan kode di respons supaya bisa dites tanpa Telegram.
  if (env.DEV_MODE === '1') result.devCode = code;
  return result;
}

export async function verifyLoginCode(env, code, purpose = 'web') {
  const key = `login:code:${purpose}`;
  const raw = await env.KV.get(key);
  if (!raw) return { ok: false, error: 'Kode kedaluwarsa. Minta kode baru.' };
  const rec = JSON.parse(raw);
  if (rec.tries >= 5) {
    await env.KV.delete(key);
    return { ok: false, error: 'Terlalu banyak percobaan. Minta kode baru.' };
  }
  const ok = timingSafeEqual(await sha256url(String(code).trim() + env.SESSION_SECRET), rec.hash);
  if (!ok) {
    rec.tries++;
    await env.KV.put(key, JSON.stringify(rec), { expirationTtl: CODE_TTL });
    return { ok: false, error: 'Kode salah.' };
  }
  await env.KV.delete(key);
  return { ok: true };
}

export async function makeSessionCookie(env) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400000, v: 1 })));
  const sig = await hmac(env.SESSION_SECRET, 'session.' + payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function hasSession(request, env) {
  const value = getCookie(request, COOKIE);
  if (!value || !env.SESSION_SECRET) return false;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  const expected = await hmac(env.SESSION_SECRET, 'session.' + payload);
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(b64urlDecodeToString(payload));
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

export async function handleAuth(request, env, path) {
  if (path === '/api/auth/request' && request.method === 'POST') {
    const r = await requestLoginCode(env, 'web');
    return json(r, r.ok ? 200 : 429);
  }
  if (path === '/api/auth/verify' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const r = await verifyLoginCode(env, body.code, 'web');
    if (!r.ok) return json(r, 401);
    return json({ ok: true }, 200, { 'set-cookie': await makeSessionCookie(env) });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if (path === '/api/auth/status') {
    return json({ loggedIn: await hasSession(request, env), owner: env.OWNER_NAME || '', app: env.APP_NAME || 'Second Brain' });
  }
  return json({ error: 'Tidak ditemukan' }, 404);
}
