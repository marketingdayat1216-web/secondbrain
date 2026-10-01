// Gmail & Google Drive (opsional). Butuh secret GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET.

import { getSetting, setSetting, delSetting } from './db.js';
import { hmac, timingSafeEqual } from './util.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ');

export function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export async function isGoogleConnected(env) {
  if (!googleConfigured(env)) return false;
  const g = await getSetting(env, 'google');
  return Boolean(g?.refresh_token);
}

export async function googleStatus(env) {
  const g = await getSetting(env, 'google');
  return { configured: googleConfigured(env), connected: Boolean(g?.refresh_token), email: g?.email || '' };
}

export async function googleConnectUrl(env, origin) {
  const ts = String(Date.now());
  const state = `${ts}.${await hmac(env.SESSION_SECRET, 'google:' + ts)}`;
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/google/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleCallback(env, origin, url) {
  const state = url.searchParams.get('state') || '';
  const [ts, sig] = state.split('.');
  const expected = await hmac(env.SESSION_SECRET, 'google:' + ts);
  if (!sig || !timingSafeEqual(sig, expected) || Date.now() - Number(ts) > 15 * 60000) {
    throw new Error('State Google tidak valid atau kedaluwarsa. Ulangi dari website.');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new Error(url.searchParams.get('error') || 'Kode Google tidak ada');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tok = await res.json();
  if (!tok.refresh_token) throw new Error(tok.error_description || 'Google tidak memberi refresh token. Cabut akses lama di myaccount.google.com/permissions lalu ulangi.');
  let email = '';
  try {
    const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    email = info.email || '';
  } catch {}
  await setSetting(env, 'google', {
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    expires_at: Date.now() + (tok.expires_in - 60) * 1000,
    email,
  });
}

export async function googleDisconnect(env) {
  await delSetting(env, 'google');
}

async function accessToken(env) {
  const g = await getSetting(env, 'google');
  if (!g?.refresh_token) throw new Error('Google belum terhubung');
  if (g.access_token && g.expires_at > Date.now()) return g.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: g.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error('Gagal memperbarui token Google: ' + (tok.error_description || tok.error));
  await setSetting(env, 'google', { ...g, access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000 });
  return tok.access_token;
}

async function gget(env, url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(env)}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}`);
  return res.json();
}

export async function listEmails(env, query = 'is:unread newer_than:1d', max = 10) {
  const list = await gget(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
  const ids = (list.messages || []).map((m) => m.id);
  const msgs = await Promise.all(ids.map((id) =>
    gget(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null),
  ));
  return msgs.filter(Boolean).map((m) => {
    const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    return { id: m.id, from: h.from || '', subject: h.subject || '(tanpa subjek)', date: h.date || '', snippet: m.snippet || '' };
  });
}

export async function searchDrive(env, query, max = 10) {
  const q = String(query).replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `(name contains '${q}' or fullText contains '${q}') and trashed = false`,
    pageSize: String(max),
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  const res = await gget(env, `https://www.googleapis.com/drive/v3/files?${params}`).catch(async () => {
    // fullText + orderBy tidak selalu didukung bersama; coba tanpa orderBy.
    params.delete('orderBy');
    return gget(env, `https://www.googleapis.com/drive/v3/files?${params}`);
  });
  return res.files || [];
}
