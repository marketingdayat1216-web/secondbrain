// Bot Telegram: webhook cepat (langsung masuk antrean) + pemrosesan di consumer antrean.

import { tg, sendText, sendHtml, typing, downloadFile, taskButtons, esc } from './telegram-api.js';
import { handleMessage } from './brain.js';
import { transcribe, describeImage } from './ai.js';
import { getSetting, setSetting, delSetting } from './db.js';
import { listTasks, completeTask, updateTask, getTask, listNotes, PROFILE_QUESTIONS, saveProfileAnswers } from './store.js';
import { searchContext, remember, listMemories } from './memory.js';
import { summarizeProfile, rememberAnswer } from './profile.js';
import { startRun } from './agents.js';
import { sendBriefing, sendRecap } from './cron.js';
import { fmtLocal, DAY } from './time.js';
import { truncate, timingSafeEqual } from './util.js';
import { webhookSecret, claimOwner, ownerUsername } from './owner.js';

export const BOT_COMMANDS = [
  { command: 'start', description: 'Mulai & bantuan' },
  { command: 'profil', description: 'Wawancara singkat supaya aku kenal kamu' },
  { command: 'tugas', description: 'Daftar tugas aktif' },
  { command: 'selesai', description: 'Tandai tugas selesai: /selesai 12' },
  { command: 'catatan', description: 'Catatan terbaru' },
  { command: 'cari', description: 'Cari di memori & catatan: /cari kata' },
  { command: 'ingat', description: 'Simpan fakta: /ingat ...' },
  { command: 'memori', description: 'Apa saja yang kuingat' },
  { command: 'kantor', description: 'Perintah ke tim AI: /kantor ...' },
  { command: 'briefing', description: 'Briefing pagi sekarang' },
  { command: 'rekap', description: 'Rekap malam sekarang' },
  { command: 'web', description: 'Link website admin' },
  { command: 'batal', description: 'Batalkan wawancara profil' },
];

export async function handleWebhook(request, env, ctx) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  const expected = await webhookSecret(env);
  if (!expected || !timingSafeEqual(secret, expected)) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => null);
  if (!update) return new Response('ok');
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return new Response('ok');

  if (!env.OWNER_CHAT_ID) {
    if (!msg || msg.chat?.type !== 'private') return new Response('ok');
    const want = ownerUsername(env);
    if (want && String(msg.from?.username || '').toLowerCase() === want) {
      env = await claimOwner(env, chatId);
      await sendText(env, '✅ Kamu tercatat sebagai pemilik bot ini. Bot hanya akan melayani akunmu.');
    } else {
      const hint = want
        ? 'Username Telegram-mu tidak cocok dengan OWNER_USERNAME.'
        : 'Isi variabel OWNER_USERNAME (username Telegram-mu tanpa @) atau OWNER_CHAT_ID di GitHub, lalu jalankan ulang workflow Deploy.';
      ctx.waitUntil(sendText(env, `Bot ini belum punya pemilik.\nChat ID kamu: ${chatId}\n${hint}`, {}, chatId));
      return new Response('ok');
    }
  }
  if (String(chatId) !== String(env.OWNER_CHAT_ID)) return new Response('ok'); // hanya melayani pemilik

  if (msg) ctx.waitUntil(typing(env, chatId));
  await env.QUEUE.send({ type: 'tg', update });
  return new Response('ok');
}

export async function processUpdate(env, update, origin) {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  const msg = update.message || update.edited_message;
  if (!msg) return;
  try {
    await processMessage(env, msg, origin);
  } catch (e) {
    console.error('processMessage', e?.stack || e);
    await sendText(env, `⚠️ ${e?.message || 'Otak AI sedang bermasalah. Coba lagi sebentar lagi.'}`);
  }
}

async function handleCallback(env, cb) {
  const [action, rawId] = String(cb.data || '').split(':');
  const id = Number(rawId);
  const task = await getTask(env, id);
  let note = 'Tugas tidak ditemukan';
  if (task) {
    if (action === 'done') {
      await completeTask(env, id);
      note = '✅ Selesai!';
    } else if (action === 'snooze1h') {
      await updateTask(env, id, { remind_at: Date.now() + 3600000 });
      note = '⏰ Diingatkan lagi 1 jam lagi';
    } else if (action === 'snooze1d') {
      const base = task.due_at && task.due_at > Date.now() ? task.due_at : Date.now();
      await updateTask(env, id, { due_at: base + DAY, remind_at: (task.remind_at || base) + DAY });
      note = '📅 Dipindah ke besok';
    }
  }
  await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: note });
  if (task && cb.message) {
    await tg(env, 'editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tg(env, 'sendMessage', { chat_id: cb.message.chat.id, text: `${note}: #${task.id} ${task.title}`, reply_parameters: { message_id: cb.message.message_id } });
  }
}

function forwardInfo(msg) {
  const o = msg.forward_origin;
  if (o) {
    const who = o.sender_user ? [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(' ')
      : o.sender_user_name || o.chat?.title || o.sender_chat?.title || 'seseorang';
    return who;
  }
  if (msg.forward_from) return [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(' ');
  if (msg.forward_sender_name) return msg.forward_sender_name;
  if (msg.forward_from_chat) return msg.forward_from_chat.title;
  return null;
}

async function processMessage(env, msg, origin) {
  let text = (msg.text || msg.caption || '').trim();
  let hint = '';

  // Perintah
  if (msg.text && text.startsWith('/')) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.slice(1).split('@')[0].toLowerCase();
    const arg = rest.join(' ').trim();
    const handled = await handleCommand(env, cmd, arg, origin);
    if (handled) return;
  }

  // Wawancara profil sedang berjalan?
  const interview = await getSetting(env, 'interview');
  if (interview && msg.text) return continueInterview(env, interview, text);

  // Voice note / audio
  const voice = msg.voice || msg.audio || msg.video_note;
  if (voice) {
    if (voice.file_size && voice.file_size > 20 * 1024 * 1024) return sendText(env, 'File suaranya terlalu besar (maks 20 MB).');
    const { bytes } = await downloadFile(env, voice.file_id);
    const transcript = await transcribe(env, bytes);
    if (!transcript) return sendText(env, 'Maaf, suaranya tidak terdengar jelas. Coba kirim ulang ya.');
    await sendHtml(env, `🎙️ <i>${esc(truncate(transcript, 1500))}</i>`);
    text = [transcript, text].filter(Boolean).join('\n');
    hint = 'Pesan ini hasil transkrip voice note; abaikan salah ketik kecil.';
  }

  // Foto (atau gambar sebagai dokumen)
  const photo = msg.photo ? msg.photo[msg.photo.length - 1] : (msg.document?.mime_type?.startsWith('image/') ? msg.document : null);
  if (photo) {
    const { bytes } = await downloadFile(env, photo.file_id);
    const mime = msg.document?.mime_type || 'image/jpeg';
    const desc = await describeImage(env, bytes, mime, msg.caption || '');
    text = `[Pengguna mengirim foto]${msg.caption ? '\nKeterangan dari pengguna: ' + msg.caption : ''}\nIsi foto: ${desc.text}`;
    hint = 'Pengguna mengirim foto. Kalau keterangannya berisi perintah, ikuti. Kalau tidak, simpan isi foto sebagai catatan (add_note) dan buat tugas bila ada tenggat/janji/tagihan di dalamnya.';
  }

  // Pesan terusan
  const from = forwardInfo(msg);
  if (from) {
    text = `[Pesan terusan dari ${from}]\n${text}`;
    hint = (hint ? hint + ' ' : '') + 'Ini pesan terusan: simpan sebagai catatan (add_note) dengan judul yang menjelaskan isinya, dan buat tugas bila ada hal yang perlu dikerjakan.';
  }

  if (!text) {
    if (msg.document) return sendText(env, 'Aku baru bisa membaca teks, voice note, dan gambar. Kirim isinya sebagai teks atau foto ya.');
    return;
  }

  const result = await handleMessage(env, { text, channel: 'telegram', hint });
  const body = [result.reply, result.lines.length ? '\n' + result.lines.join('\n') : ''].join('').trim();
  // Satu tugas baru → beri tombol cepat.
  const tasks = result.created.filter((c) => c.kind === 'task');
  await sendText(env, body, tasks.length === 1 ? taskButtons(tasks[0].item.id) : {});
}

async function handleCommand(env, cmd, arg, origin) {
  switch (cmd) {
    case 'start':
    case 'help':
    case 'bantuan': {
      await sendHtml(env, `Halo ${esc(env.OWNER_NAME || '')}! 👋 Aku ${esc(env.APP_NAME || 'Second Brain')}, otak keduamu.

Kirim apa saja:
• <b>Tugas</b>: "besok jam 10 meeting dengan klien"
• <b>Pengingat</b>: "ingatkan aku 30 menit lagi angkat jemuran"
• <b>Catatan</b>: ide, link, atau pesan terusan
• <b>Voice note</b> & <b>foto</b> (struk, screenshot, whiteboard)
• <b>Pertanyaan</b>: "apa target bulan ini?"

Setiap hari: briefing 07:00 &amp; rekap 21:00.
Mulai dengan /profil supaya aku kenal kamu. Website admin: /web`);
      return true;
    }
    case 'profil': {
      await setSetting(env, 'interview', { step: 0 });
      await sendText(env, `Aku akan tanya ${PROFILE_QUESTIONS.length} hal singkat. Ketik /batal kapan saja.\n\n1/${PROFILE_QUESTIONS.length}. ${PROFILE_QUESTIONS[0].q}`);
      return true;
    }
    case 'batal': {
      await delSetting(env, 'interview');
      await sendText(env, 'Oke, dibatalkan.');
      return true;
    }
    case 'tugas': {
      const tasks = await listTasks(env, { status: 'todo', limit: 40 });
      if (!tasks.length) {
        await sendText(env, 'Tidak ada tugas aktif. 🎉');
        return true;
      }
      const now = Date.now();
      await sendText(env, '📋 Tugas aktif:\n\n' + tasks.map((t) => `#${t.id} ${t.title}${t.due_at ? ` — ${fmtLocal(env, t.due_at)}${t.due_at < now ? ' ⚠️ lewat' : ''}` : ''}${t.priority === 'high' ? ' 🔥' : ''}`).join('\n') + '\n\nSelesai? Ketik /selesai <nomor> atau bilang saja "sudah kirim invoice".');
      return true;
    }
    case 'selesai': {
      const ids = arg.match(/\d+/g) || [];
      if (!ids.length) {
        await sendText(env, 'Contoh: /selesai 12');
        return true;
      }
      const done = [];
      for (const id of ids) {
        const t = await completeTask(env, Number(id));
        if (t) done.push(`#${t.id} ${t.title}`);
      }
      await sendText(env, done.length ? `✅ Selesai:\n${done.join('\n')}` : 'Tugas tidak ditemukan.');
      return true;
    }
    case 'catatan': {
      const notes = await listNotes(env, { q: arg, limit: 10 });
      await sendText(env, notes.length ? '📝 Catatan:\n\n' + notes.map((n) => `#${n.id} ${n.title}\n${truncate(n.content.replace(/\s+/g, ' '), 140)}`).join('\n\n') : 'Belum ada catatan.');
      return true;
    }
    case 'cari': {
      if (!arg) {
        await sendText(env, 'Contoh: /cari harga supplier kain');
        return true;
      }
      const r = await searchContext(env, arg, { topK: 10, minScore: 0.35 });
      const parts = [];
      if (r.memories.length) parts.push('🧠 Memori:\n' + r.memories.map((m) => `• ${m.content}`).join('\n'));
      if (r.notes.length) parts.push('📝 Catatan:\n' + r.notes.map((n) => `#${n.id} ${n.title}\n${truncate(n.content.replace(/\s+/g, ' '), 200)}`).join('\n\n'));
      await sendText(env, parts.join('\n\n') || 'Tidak ketemu yang cocok.');
      return true;
    }
    case 'ingat': {
      if (!arg) {
        await sendText(env, 'Contoh: /ingat supplier kain terbaik adalah Toko Makmur, Bandung');
        return true;
      }
      const m = await remember(env, arg, { source: 'telegram' });
      await sendText(env, `🧠 Diingat: ${m.content}`);
      return true;
    }
    case 'memori': {
      const mems = await listMemories(env, { limit: 30 });
      await sendText(env, mems.length ? '🧠 Yang kuingat:\n\n' + mems.map((m) => `#${m.id} ${m.content}`).join('\n') : 'Belum ada memori. Ceritakan tentang dirimu atau ketik /profil.');
      return true;
    }
    case 'kantor':
    case 'tim': {
      if (!arg) {
        await sendText(env, 'Contoh: /kantor buat strategi promo 11.11 untuk produk utama');
        return true;
      }
      const r = await startRun(env, arg, { source: 'telegram' });
      await sendText(env, r.viaClaude
        ? `🏢 Perintah masuk antrean Claude (run #${r.id}). Buka Claude dengan konektor Second Brain dan kirim:\n"Kerjakan semua antrean analisa di Second Brain"\nLaporan akan dikirim ke sini.`
        : `🏢 Tim mulai bekerja (run #${r.id}). Tonton mereka di Kantor 3D: ${origin}/#/kantor\nLaporan akan dikirim ke sini.`);
      return true;
    }
    case 'briefing':
      await sendBriefing(env);
      return true;
    case 'rekap':
      await sendRecap(env);
      return true;
    case 'web':
      await sendText(env, `🌐 Website admin: ${origin}\nKlik "Kirim kode ke Telegram", lalu masukkan kodenya.\n\n🔌 Konektor Claude: ${origin}/mcp`);
      return true;
    default:
      return false;
  }
}

async function continueInterview(env, interview, answer) {
  const q = PROFILE_QUESTIONS[interview.step];
  if (!q) {
    await delSetting(env, 'interview');
    return;
  }
  await saveProfileAnswers(env, { [q.key]: answer });
  await rememberAnswer(env, q.key, answer).catch(() => {});
  const next = interview.step + 1;
  if (next < PROFILE_QUESTIONS.length) {
    await setSetting(env, 'interview', { step: next });
    await sendText(env, `${next + 1}/${PROFILE_QUESTIONS.length}. ${PROFILE_QUESTIONS[next].q}`);
    return;
  }
  await delSetting(env, 'interview');
  await typing(env);
  const summary = await summarizeProfile(env);
  await sendText(env, `Terima kasih! Sekarang aku lebih kenal kamu. 🙌\n\nProfilmu:\n${summary}\n\nBisa diubah kapan saja di website (Profil & Memori) atau ulangi /profil.`);
}
