// OAuth 2.1 minimal untuk konektor Claude (MCP): dynamic client registration + PKCE.
// Persetujuan memakai kode Telegram (atau sesi website yang sudah login).
// Token akses & refresh bersifat stateless (ditandatangani HMAC) supaya hemat tulis KV.

import { json, html, escapeHtml, randomToken, hmac, sha256url, timingSafeEqual, b64url, b64urlDecodeToString, readBody } from './util.js';
import { hasSession, verifyLoginCode } from './auth.js';

const ACCESS_TTL = 7 * 86400; // detik
const REFRESH_TTL = 90 * 86400;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
};
export const corsHeaders = CORS;

export function protectedResourceMetadata(origin) {
  return json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  }, 200, CORS);
}

export function authServerMetadata(origin) {
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  }, 200, CORS);
}

export async function register(request, env) {
  const body = await request.json().catch(() => ({}));
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(u)) : [];
  if (!redirectUris.length) return json({ error: 'invalid_redirect_uri' }, 400, CORS);
  const clientId = 'c_' + randomToken(16);
  const client = { client_id: clientId, redirect_uris: redirectUris, client_name: String(body.client_name || 'Klien MCP').slice(0, 100) };
  await env.KV.put(`oauth:client:${clientId}`, JSON.stringify(client));
  return json({
    ...client,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }, 201, CORS);
}

async function getClient(env, id) {
  const raw = id && (await env.KV.get(`oauth:client:${id}`));
  return raw ? JSON.parse(raw) : null;
}

function page(title, body) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#f4f6f7;--card:#fff;--ink:#15212a;--muted:#5b6b76;--line:#dde4e8;--accent:#0b6e74;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0d1418;--card:#131d23;--ink:#e3ecef;--muted:#93a5ae;--line:#24333b;--accent:#5cc7c9;--err:#ff8a7a}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;max-width:420px;width:100%}
h1{font-size:1.35rem;margin:0 0 8px}p{color:var(--muted);margin:0 0 16px}
button,input{font:inherit}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink);font-size:1.3rem;letter-spacing:.3em;text-align:center}
button{width:100%;padding:12px;border:0;border-radius:10px;background:var(--accent);color:var(--card);font-weight:600;cursor:pointer;margin-top:12px}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}
.err{color:var(--err);font-size:.92rem;margin-top:10px}.ok{color:var(--accent);font-size:.92rem;margin-top:10px}
</style></head><body><div class="card">${body}</div></body></html>`;
}

export async function authorizePage(request, env, url, error = '') {
  const q = url.searchParams;
  const client = await getClient(env, q.get('client_id'));
  if (!client) return html(page('Klien tidak dikenal', '<h1>Klien tidak dikenal</h1><p>Hapus konektor di Claude lalu tambahkan lagi.</p>'), 400);
  const redirectUri = q.get('redirect_uri');
  if (!client.redirect_uris.includes(redirectUri)) return html(page('Redirect tidak valid', '<h1>Redirect URI tidak valid</h1>'), 400);
  if (q.get('response_type') !== 'code' || !q.get('code_challenge') || (q.get('code_challenge_method') || 'S256') !== 'S256') {
    return html(page('Permintaan tidak valid', '<h1>Permintaan tidak valid</h1><p>Butuh response_type=code dan PKCE S256.</p>'), 400);
  }
  const loggedIn = await hasSession(request, env);
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(q.get(k) || '')}">`).join('');
  const body = `
<h1>Hubungkan ${escapeHtml(client.client_name)}</h1>
<p><b>${escapeHtml(client.client_name)}</b> ingin membaca &amp; menulis tugas, catatan, memori, dan riset kompetitor di ${escapeHtml(env.APP_NAME || 'Second Brain')} milik ${escapeHtml(env.OWNER_NAME || 'kamu')}.</p>
<form method="post" action="/authorize">
${hidden}
${loggedIn ? '<input type="hidden" name="use_session" value="1"><p>Kamu sudah login di website ini.</p>' : `
<button type="button" class="secondary" id="send">Kirim kode ke Telegram</button>
<div id="msg"></div>
<label for="code" style="display:block;margin-top:16px;color:var(--muted);font-size:.9rem">Kode 6 digit</label>
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>`}
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<button type="submit">Izinkan</button>
</form>
<script>
const b=document.getElementById('send');
if(b)b.onclick=async()=>{b.disabled=true;const m=document.getElementById('msg');
const r=await fetch('/oauth/send-code',{method:'POST'}).then(r=>r.json()).catch(()=>({ok:false,error:'Gagal terhubung'}));
m.className=r.ok?'ok':'err';m.textContent=r.ok?('Kode dikirim ke Telegram.'+(r.devCode?' (dev: '+r.devCode+')':'')):r.error;
setTimeout(()=>b.disabled=false,r.wait?r.wait*1000:60000)};
</script>`;
  return html(page('Hubungkan Claude', body));
}

export async function authorizeSubmit(request, env, url) {
  const form = await readBody(request);
  const client = await getClient(env, form.client_id);
  if (!client || !client.redirect_uris.includes(form.redirect_uri)) return html(page('Tidak valid', '<h1>Permintaan tidak valid</h1>'), 400);
  let ok = false;
  if (form.use_session === '1') ok = await hasSession(request, env);
  if (!ok) {
    const r = await verifyLoginCode(env, form.code || '', 'mcp');
    if (!r.ok) {
      const retry = new URL(url.origin + '/authorize');
      for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']) if (form[k]) retry.searchParams.set(k, form[k]);
      retry.searchParams.set('response_type', 'code');
      return authorizePage(request, env, retry, r.error);
    }
  }
  const code = randomToken(24);
  await env.KV.put(`oauth:code:${code}`, JSON.stringify({
    client_id: client.client_id,
    redirect_uri: form.redirect_uri,
    code_challenge: form.code_challenge,
  }), { expirationTtl: 300 });
  const dest = new URL(form.redirect_uri);
  dest.searchParams.set('code', code);
  if (form.state) dest.searchParams.set('state', form.state);
  return Response.redirect(dest.toString(), 302);
}

async function signToken(env, kind, data, ttl) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ ...data, k: kind, exp: Math.floor(Date.now() / 1000) + ttl })));
  return `${kind}.${payload}.${await hmac(env.SESSION_SECRET, kind + '.' + payload)}`;
}

async function readToken(env, kind, token) {
  const [k, payload, sig] = String(token || '').split('.');
  if (k !== kind || !payload || !sig) return null;
  if (!timingSafeEqual(sig, await hmac(env.SESSION_SECRET, kind + '.' + payload))) return null;
  try {
    const data = JSON.parse(b64urlDecodeToString(payload));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

async function issueTokens(env, clientId) {
  return {
    access_token: await signToken(env, 'at', { cid: clientId }, ACCESS_TTL),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: await signToken(env, 'rt', { cid: clientId }, REFRESH_TTL),
    scope: 'mcp',
  };
}

export async function token(request, env) {
  const body = await readBody(request);
  const err = (e, d) => json({ error: e, error_description: d }, 400, CORS);
  if (body.grant_type === 'authorization_code') {
    const raw = await env.KV.get(`oauth:code:${body.code}`);
    if (!raw) return err('invalid_grant', 'Kode tidak valid atau kedaluwarsa');
    await env.KV.delete(`oauth:code:${body.code}`);
    const rec = JSON.parse(raw);
    if (body.client_id && body.client_id !== rec.client_id) return err('invalid_grant', 'client_id tidak cocok');
    if (body.redirect_uri && body.redirect_uri !== rec.redirect_uri) return err('invalid_grant', 'redirect_uri tidak cocok');
    if (!body.code_verifier || (await sha256url(body.code_verifier)) !== rec.code_challenge) return err('invalid_grant', 'PKCE gagal');
    return json(await issueTokens(env, rec.client_id), 200, { ...CORS, 'cache-control': 'no-store' });
  }
  if (body.grant_type === 'refresh_token') {
    const data = await readToken(env, 'rt', body.refresh_token);
    if (!data) return err('invalid_grant', 'Refresh token tidak valid');
    if (!(await getClient(env, data.cid))) return err('invalid_grant', 'Klien sudah dihapus');
    return json(await issueTokens(env, data.cid), 200, { ...CORS, 'cache-control': 'no-store' });
  }
  return err('unsupported_grant_type', '');
}

export async function verifyBearer(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return readToken(env, 'at', m[1].trim());
}
