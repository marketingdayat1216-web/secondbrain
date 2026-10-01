// REST API untuk website admin (semua butuh sesi login).

import { json, clampInt } from './util.js';
import { all, first, run, getSetting } from './db.js';
import {
  listTasks, addTask, updateTask, deleteTask, taskStats,
  listNotes, addNote, getNote, updateNote, deleteNote,
  getProfile, saveProfileAnswers, setProfileSummary, recentMessages,
} from './store.js';
import { listMemories, remember, updateMemory, forget } from './memory.js';
import { summarizeProfile } from './profile.js';
import { handleMessage } from './brain.js';
import { agentState, startRun, getRun, AGENTS } from './agents.js';
import { listAds, listScans, ingestScan, deleteAd, decorateAd } from './competitor.js';
import { googleStatus, googleConnectUrl, googleDisconnect } from './google.js';
import { fastModel, smartModel, hasSmart, modelLabel } from './ai.js';
import { tg } from './telegram-api.js';
import { parseLocal, toLocalInput, tzLabel, offsetHours, nowDescription } from './time.js';
import { sendBriefing, sendRecap } from './cron.js';

function taskOut(env, t) {
  return { ...t, due_local: toLocalInput(env, t.due_at), remind_local: toLocalInput(env, t.remind_at) };
}

function taskFields(env, body) {
  const f = {};
  for (const k of ['title', 'notes', 'priority', 'status']) if (body[k] !== undefined) f[k] = body[k];
  if (body.due !== undefined) f.due_at = body.due ? parseLocal(env, body.due) : null;
  if (body.remind !== undefined) f.remind_at = body.remind ? parseLocal(env, body.remind) : null;
  return f;
}

export async function handleApi(request, env, url, origin) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const seg = path.split('/').slice(2); // ['tasks', '12']
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await request.json().catch(() => ({})) : {};
  const id = seg[1] ? Number(seg[1]) : null;
  const q = url.searchParams;

  // ----- Info umum -----
  if (path === '/api/me') {
    return json({
      owner: env.OWNER_NAME || '',
      app: env.APP_NAME || 'Second Brain',
      tz: tzLabel(env),
      tzOffset: offsetHours(env),
      now: nowDescription(env),
      origin,
      models: { fast: modelLabel(fastModel(env)), smart: hasSmart(env) ? modelLabel(smartModel(env)) : null },
    });
  }

  if (path === '/api/dashboard') {
    const [stats, upcoming, notes, memCount, noteCount, adCount, runs] = await Promise.all([
      taskStats(env),
      listTasks(env, { status: 'todo', limit: 8 }),
      all(env, 'SELECT id, title, tags, updated_at FROM notes ORDER BY updated_at DESC LIMIT 6'),
      first(env, 'SELECT COUNT(*) AS n FROM memories'),
      first(env, 'SELECT COUNT(*) AS n FROM notes'),
      first(env, 'SELECT COUNT(*) AS n FROM competitor_ads'),
      all(env, 'SELECT id, command, status, created_at FROM agent_runs ORDER BY id DESC LIMIT 4'),
    ]);
    return json({
      now: nowDescription(env),
      stats: { ...stats, memories: memCount?.n || 0, notes: noteCount?.n || 0, ads: adCount?.n || 0 },
      upcoming: upcoming.map((t) => taskOut(env, t)),
      notes,
      runs,
    });
  }

  // ----- Tugas -----
  if (seg[0] === 'tasks') {
    if (method === 'GET' && !id) {
      const tasks = await listTasks(env, { status: q.get('status') || 'todo', q: q.get('q') || '', limit: clampInt(q.get('limit'), 1, 500, 200) });
      return json({ tasks: tasks.map((t) => taskOut(env, t)) });
    }
    if (method === 'POST' && !id) {
      const f = taskFields(env, body);
      const t = await addTask(env, { title: f.title, notes: f.notes, due_at: f.due_at ?? null, remind_at: f.remind_at ?? null, priority: f.priority, source: 'web' });
      return json({ task: taskOut(env, t) }, 201);
    }
    if (method === 'PATCH' && id) {
      const t = await updateTask(env, id, taskFields(env, body));
      return t ? json({ task: taskOut(env, t) }) : json({ error: 'Tidak ditemukan' }, 404);
    }
    if (method === 'DELETE' && id) {
      await deleteTask(env, id);
      return json({ ok: true });
    }
  }

  // ----- Catatan -----
  if (seg[0] === 'notes') {
    if (method === 'GET' && !id) {
      const notes = await listNotes(env, { q: q.get('q') || '', semantic: q.get('semantic') === '1', limit: 200 });
      return json({ notes });
    }
    if (method === 'GET' && id) {
      const n = await getNote(env, id);
      return n ? json({ note: n }) : json({ error: 'Tidak ditemukan' }, 404);
    }
    if (method === 'POST' && !id) return json({ note: await addNote(env, { ...body, source: 'web' }) }, 201);
    if (method === 'PATCH' && id) {
      const n = await updateNote(env, id, body);
      return n ? json({ note: n }) : json({ error: 'Tidak ditemukan' }, 404);
    }
    if (method === 'DELETE' && id) {
      await deleteNote(env, id);
      return json({ ok: true });
    }
  }

  // ----- Chat AI -----
  if (path === '/api/chat' && method === 'GET') {
    return json({ messages: await recentMessages(env, 'web', 60) });
  }
  if (path === '/api/chat' && method === 'POST') {
    try {
      const r = await handleMessage(env, { text: body.message, channel: 'web' });
      return json({ reply: r.reply, lines: r.lines });
    } catch (e) {
      return json({ error: e?.message || 'Otak AI sedang bermasalah' }, 500);
    }
  }
  if (path === '/api/chat' && method === 'DELETE') {
    await run(env, "DELETE FROM messages WHERE channel = 'web'");
    return json({ ok: true });
  }

  // ----- Profil & memori -----
  if (path === '/api/profile' && method === 'GET') return json(await getProfile(env));
  if (path === '/api/profile' && method === 'PUT') {
    if (body.answers) await saveProfileAnswers(env, body.answers);
    let summary;
    if (typeof body.summary === 'string' && !body.regenerate) {
      await setProfileSummary(env, body.summary);
      summary = body.summary;
    } else {
      summary = await summarizeProfile(env);
    }
    return json({ ok: true, summary });
  }
  if (seg[0] === 'memories') {
    if (method === 'GET') return json({ memories: await listMemories(env, { q: q.get('q') || '', limit: 500 }) });
    if (method === 'POST') return json({ memory: await remember(env, body.content, { category: body.category || 'lainnya', source: 'web' }) }, 201);
    if (method === 'PATCH' && id) return json({ memory: await updateMemory(env, id, body) });
    if (method === 'DELETE' && id) {
      await forget(env, id);
      return json({ ok: true });
    }
  }

  // ----- Tim agen / Kantor 3D -----
  if (path === '/api/agents/state') return json({ ...(await agentState(env)), roster: AGENTS.map(({ id: aid, name, title, team, color }) => ({ id: aid, name, title, team, color })) });
  if (path === '/api/agents/command' && method === 'POST') {
    try {
      return json({ run: await startRun(env, body.command, { source: 'web' }) }, 201);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }
  if (seg[0] === 'agents' && seg[1] === 'runs' && seg[2]) {
    const r = await getRun(env, Number(seg[2]));
    return r ? json({ run: r }) : json({ error: 'Tidak ditemukan' }, 404);
  }

  // ----- Riset kompetitor -----
  if (path === '/api/competitor/ingest' && method === 'POST') {
    try {
      const r = await ingestScan(env, body);
      return json({ ok: true, scanId: r.scan.id, inserted: r.inserted });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }
  if (path === '/api/competitor/scans') return json(await listScans(env));
  if (path === '/api/competitor/ads' && method === 'GET') {
    return json({
      ads: await listAds(env, {
        keyword: q.get('keyword') || '',
        scanId: q.get('scan') ? Number(q.get('scan')) : null,
        sort: q.get('sort') || 'rank',
        winners: q.get('winners') === '1',
        limit: clampInt(q.get('limit'), 1, 300, 120),
      }),
    });
  }
  if (seg[0] === 'competitor' && seg[1] === 'ads' && seg[2]) {
    const adId = Number(seg[2]);
    const action = seg[3];
    if (method === 'GET' && !action) {
      const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', adId);
      return a ? json({ ad: decorateAd(a) }) : json({ error: 'Tidak ditemukan' }, 404);
    }
    if (method === 'DELETE' && !action) {
      await deleteAd(env, adId);
      return json({ ok: true });
    }
    if (method === 'POST' && action === 'analyze') {
      await run(env, "UPDATE competitor_ads SET analysis_status = 'pending' WHERE id = ?", adId);
      await env.QUEUE.send({ type: 'ads_analyze', adId });
      return json({ ok: true });
    }
    if (method === 'POST' && action === 'variations') {
      await run(env, "UPDATE competitor_ads SET variations_status = 'pending' WHERE id = ?", adId);
      await env.QUEUE.send({ type: 'ads_variations', adId });
      return json({ ok: true });
    }
    if (method === 'POST' && action === 'save-media') {
      await run(env, 'UPDATE competitor_ads SET media_saved = 0 WHERE id = ?', adId);
      await env.QUEUE.send({ type: 'ads_save_media', adId });
      return json({ ok: true });
    }
  }

  // ----- Sistem -----
  if (path === '/api/system') {
    const [webhook, google, smartStatus, counts] = await Promise.all([
      env.TELEGRAM_BOT_TOKEN ? tg(env, 'getWebhookInfo').catch(() => null) : null,
      googleStatus(env),
      getSetting(env, 'ai_smart_status'),
      first(env, `SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM notes) AS notes,
        (SELECT COUNT(*) FROM memories) AS memories, (SELECT COUNT(*) FROM competitor_ads) AS ads,
        (SELECT COUNT(*) FROM agent_runs) AS runs, (SELECT COUNT(*) FROM messages) AS messages`),
    ]);
    return json({
      owner: env.OWNER_NAME,
      chatIdSet: Boolean(env.OWNER_CHAT_ID),
      tz: tzLabel(env),
      webhook: webhook?.result ? { url: webhook.result.url, pending: webhook.result.pending_update_count, lastError: webhook.result.last_error_message || '' } : null,
      models: {
        fast: fastModel(env),
        smart: smartModel(env),
        smartEnabled: hasSmart(env),
        smartStatus,
      },
      google,
      bindings: { vectorize: Boolean(env.VECTORIZE), queue: Boolean(env.QUEUE), kv: Boolean(env.KV), ai: Boolean(env.AI) },
      counts,
      mcpUrl: `${origin}/mcp`,
    });
  }
  if (path === '/api/system/briefing' && method === 'POST') {
    await sendBriefing(env);
    return json({ ok: true });
  }
  if (path === '/api/system/recap' && method === 'POST') {
    await sendRecap(env);
    return json({ ok: true });
  }
  if (path === '/api/google/connect') {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'GOOGLE_CLIENT_ID belum diisi' }, 400);
    return Response.redirect(await googleConnectUrl(env, origin), 302);
  }
  if (path === '/api/google/disconnect' && method === 'POST') {
    await googleDisconnect(env);
    return json({ ok: true });
  }

  return json({ error: 'Tidak ditemukan' }, 404);
}
