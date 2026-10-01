// Titik masuk Worker: router HTTP, consumer antrean, dan cron.

import { json, timingSafeEqual } from './util.js';
import { handleWebhook, BOT_COMMANDS } from './telegram.js';
import { tg } from './telegram-api.js';
import { handleAuth, hasSession, requestLoginCode } from './auth.js';
import { handleApi } from './api.js';
import { handleMcp } from './mcp.js';
import {
  protectedResourceMetadata, authServerMetadata, register, authorizePage, authorizeSubmit, token, corsHeaders,
} from './oauth.js';
import { googleCallback } from './google.js';
import { serveMedia } from './competitor.js';
import { handleJob } from './jobs.js';
import { runCron } from './cron.js';
import { setSetting } from './db.js';
import { withOwner, rememberOrigin, webhookSecret } from './owner.js';

async function setupWebhook(env, origin, url) {
  const secret = url.searchParams.get('secret') || '';
  const expected = await webhookSecret(env);
  if (!expected || !timingSafeEqual(secret, expected)) {
    return json({ ok: false, error: 'secret salah' }, 403);
  }
  const hook = await tg(env, 'setWebhook', {
    url: `${origin}/telegram`,
    secret_token: expected,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
  });
  const cmds = await tg(env, 'setMyCommands', { commands: BOT_COMMANDS });
  await setSetting(env, 'public_url', origin);
  return json({
    ok: Boolean(hook.ok),
    webhook: hook.description || hook.ok,
    commands: cmds.ok,
    url: `${origin}/telegram`,
    owner: env.OWNER_CHAT_ID ? 'terisi' : (env.OWNER_USERNAME ? `menunggu pesan dari @${String(env.OWNER_USERNAME).replace(/^@/, '')}` : 'kosong'),
  });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const origin = env.PUBLIC_URL || url.origin;
  const path = url.pathname;
  env = await withOwner(env);
  ctx.waitUntil(rememberOrigin(env, origin));

  // Telegram
  if (path === '/telegram' && request.method === 'POST') return handleWebhook(request, env, ctx);
  if (path === '/setup') return setupWebhook(env, origin, url);

  // OAuth + MCP untuk konektor Claude
  if (request.method === 'OPTIONS' && (path.startsWith('/.well-known/') || ['/register', '/token', '/mcp'].includes(path))) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (path.startsWith('/.well-known/oauth-protected-resource')) return protectedResourceMetadata(origin);
  if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) return authServerMetadata(origin);
  if (path === '/register' && request.method === 'POST') return register(request, env);
  if (path === '/authorize' && request.method === 'GET') return authorizePage(request, env, url);
  if (path === '/authorize' && request.method === 'POST') return authorizeSubmit(request, env, url);
  if (path === '/oauth/send-code' && request.method === 'POST') {
    const r = await requestLoginCode(env, 'mcp');
    return json(r, r.ok ? 200 : 429);
  }
  if (path === '/token' && request.method === 'POST') return token(request, env);
  if (path === '/mcp' || path.startsWith('/mcp/')) return handleMcp(request, env, origin);

  // Media iklan kompetitor yang sudah disalin permanen
  if (path.startsWith('/media/')) return serveMedia(env, decodeURIComponent(path.slice(7)));

  // Website admin
  if (path.startsWith('/api/auth/')) return handleAuth(request, env, path);
  if (path === '/api/google/callback') {
    try {
      await googleCallback(env, origin, url);
      return Response.redirect(`${origin}/#/sistem?google=ok`, 302);
    } catch (e) {
      return Response.redirect(`${origin}/#/sistem?google_error=${encodeURIComponent(e.message)}`, 302);
    }
  }
  if (path.startsWith('/api/')) {
    if (!(await hasSession(request, env))) return json({ error: 'Belum login' }, 401);
    return handleApi(request, env, url, origin);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      console.error('fetch error', e?.stack || e);
      return json({ error: e?.message || 'Kesalahan server' }, 500);
    }
  },

  async queue(batch, env) {
    env = await withOwner(env);
    for (const msg of batch.messages) {
      try {
        await handleJob(env, msg.body);
        msg.ack();
      } catch (e) {
        console.error('job gagal', msg.body?.type, e?.stack || e);
        // Pesan Telegram tidak diulang supaya balasan tidak dobel; pekerjaan lain dicoba ulang.
        if (msg.body?.type === 'tg') msg.ack();
        else msg.retry({ delaySeconds: 10 });
      }
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(withOwner(env).then(runCron).catch((e) => console.error('cron', e?.stack || e)));
  },
};
