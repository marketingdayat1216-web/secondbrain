// Panggilan Bot API Telegram.

import { escapeHtml } from './util.js';

export async function tg(env, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data.ok) console.error('Telegram', method, data.description);
  return data;
}

function chunks(text, size = 3900) {
  const out = [];
  let rest = String(text);
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

// Kirim teks biasa (tanpa format) ke pemilik. Pesan panjang dipecah.
export async function sendText(env, text, extra = {}, chatId = env.OWNER_CHAT_ID) {
  const parts = chunks(text);
  let last;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    last = await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: parts[i],
      link_preview_options: { is_disabled: true },
      ...(isLast ? extra : {}),
    });
  }
  return last;
}

// Kirim teks berformat HTML Telegram (pemanggil bertanggung jawab meng-escape isi dinamis).
export async function sendHtml(env, htmlText, extra = {}, chatId = env.OWNER_CHAT_ID) {
  const res = await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
  if (!res.ok) {
    // Kalau HTML ditolak, kirim versi polos supaya pesan tetap sampai.
    return sendText(env, htmlText.replace(/<[^>]+>/g, ''), extra, chatId);
  }
  return res;
}

export function typing(env, chatId = env.OWNER_CHAT_ID) {
  return tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
}

export async function downloadFile(env, fileId) {
  const info = await tg(env, 'getFile', { file_id: fileId });
  if (!info.ok) throw new Error('Gagal mengambil file Telegram');
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`);
  if (!res.ok) throw new Error('Gagal mengunduh file Telegram');
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: info.result.file_path };
}

export function taskButtons(taskId) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Selesai', callback_data: `done:${taskId}` },
        { text: '⏰ +1 jam', callback_data: `snooze1h:${taskId}` },
        { text: '📅 Besok', callback_data: `snooze1d:${taskId}` },
      ]],
    },
  };
}

export const esc = escapeHtml;
