// Consumer antrean: semua pekerjaan lambat (AI, unduh media, tim agen) dijalankan di sini.

import { processUpdate } from './telegram.js';
import { planRun, runStep, finalizeRun, failRun } from './agents.js';
import { scoreScan, saveAdMedia, analyzeAd, makeVariations } from './competitor.js';
import { smartChat, modelLabel } from './ai.js';
import { addNote, getProfile } from './store.js';
import { sendText } from './telegram-api.js';
import { getSetting } from './db.js';
import { truncate } from './util.js';

export async function publicUrl(env) {
  return env.PUBLIC_URL || (await getSetting(env, 'public_url', '')) || '';
}

export async function handleJob(env, job) {
  switch (job.type) {
    case 'tg':
      return processUpdate(env, job.update, await publicUrl(env));
    case 'agent_plan':
      try {
        return await planRun(env, job.runId);
      } catch (e) {
        return failRun(env, job.runId, e?.message || e);
      }
    case 'agent_step':
      try {
        return await runStep(env, job.runId, job.idx);
      } catch (e) {
        return failRun(env, job.runId, e?.message || e);
      }
    case 'agent_finalize':
      try {
        return await finalizeRun(env, job.runId);
      } catch (e) {
        return failRun(env, job.runId, e?.message || e);
      }
    case 'ads_score':
      return scoreScan(env, job.scanId);
    case 'ads_save_media':
      return saveAdMedia(env, job.adId);
    case 'ads_analyze':
      return analyzeAd(env, job.adId);
    case 'ads_variations':
      return makeVariations(env, job.adId);
    case 'write_content':
      return writeContent(env, job.brief);
    default:
      console.warn('Job tidak dikenal', job.type);
  }
}

async function writeContent(env, brief) {
  const profile = await getProfile(env);
  const out = await smartChat(env, {
    system: `Kamu copywriter & content strategist senior untuk ${env.OWNER_NAME || 'pemilik bisnis'} di Indonesia. Tulis dalam Bahasa Indonesia, Markdown, siap pakai. Gaya mengikuti profil pemilik.`,
    messages: [{ role: 'user', content: `PROFIL: ${profile.summary || '(belum diisi)'}\n\nBRIEF: ${brief}` }],
    maxTokens: 6000,
  });
  const text = `${out.text}\n\n_Ditulis oleh ${modelLabel(out.model)}_`;
  const note = await addNote(env, { title: `Konten: ${truncate(brief, 80)}`, content: text, tags: 'konten', source: 'ai' });
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) await sendText(env, `✍️ Konten selesai (Catatan #${note.id}):\n\n${text}`);
}
