// Siapa pemilik bot, dan rahasia webhook.
// Pemilik = variabel OWNER_CHAT_ID, atau diklaim otomatis oleh akun Telegram yang username-nya
// sama dengan OWNER_USERNAME saat pertama kali mengirim pesan (lalu disimpan di D1).

import { getSetting, setSetting } from './db.js';
import { sha256url } from './util.js';

let cachedOwner = '';
let cachedOrigin = '';

export async function withOwner(env) {
  if (env.OWNER_CHAT_ID) return env;
  if (!cachedOwner) cachedOwner = String((await getSetting(env, 'owner_chat_id', '').catch(() => '')) || '');
  return cachedOwner ? { ...env, OWNER_CHAT_ID: cachedOwner } : env;
}

export async function claimOwner(env, chatId) {
  await setSetting(env, 'owner_chat_id', String(chatId));
  cachedOwner = String(chatId);
  return { ...env, OWNER_CHAT_ID: cachedOwner };
}

export function ownerUsername(env) {
  return String(env.OWNER_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
}

// Diturunkan dari token bot supaya GitHub Actions dan Worker sama-sama tahu nilainya
// tanpa menyimpan secret tambahan. Harus sama dengan scripts/deploy.mjs.
export async function webhookSecret(env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.TELEGRAM_BOT_TOKEN) return '';
  return (await sha256url(`${env.TELEGRAM_BOT_TOKEN}:webhook`)).slice(0, 40);
}

// Simpan alamat publik Worker (dipakai pesan bot dari antrean/cron yang tidak punya request).
export async function rememberOrigin(env, origin) {
  if (env.PUBLIC_URL || origin === cachedOrigin || /localhost|127\.0\.0\.1/.test(origin)) return;
  cachedOrigin = origin;
  const saved = await getSetting(env, 'public_url', '').catch(() => '');
  if (saved !== origin) await setSetting(env, 'public_url', origin).catch(() => {});
}
