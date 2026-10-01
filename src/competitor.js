// Riset Kompetitor: iklan dari Meta Ad Library (dikirim lewat bookmarklet), penilaian,
// salin media iklan pemenang ke KV, laporan bedah iklan & "Bikin 5 konten mirip" (Claude Opus).

import { all, first, run, getSetting } from './db.js';
import { fastJson, smartChat, modelLabel, hasSmart } from './ai.js';
import { getProfile, addNote } from './store.js';
import { parseAdDate, daysSince } from './time.js';
import { truncate, sha256url } from './util.js';
import { sendText } from './telegram-api.js';

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export function decorateAd(a) {
  let media = [];
  try {
    media = JSON.parse(a.media || '[]');
  } catch {}
  return {
    ...a,
    media: media.map((m) => ({ ...m, display: m.saved || m.url, poster: m.savedPoster || m.poster || '' })),
    days_running: daysSince(a.start_ts),
    score_model: a.score_model ? modelLabel(a.score_model) : '',
    winner: isWinner(a),
  };
}

function isWinner(a) {
  const days = daysSince(a.start_ts) ?? 0;
  return days >= 30 || (a.rank && a.rank <= 5) || (a.score ?? 0) >= 75;
}

export async function ingestScan(env, payload) {
  const ads = Array.isArray(payload.ads) ? payload.ads.slice(0, 120) : [];
  if (!ads.length) throw new Error('Tidak ada iklan di data scan. Pastikan halaman Ad Library sudah menampilkan hasil.');
  const now = Date.now();
  const scan = await first(
    env,
    'INSERT INTO competitor_scans (keyword, country, url, ad_count, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
    String(payload.keyword || '').slice(0, 200), String(payload.country || '').slice(0, 10), String(payload.url || '').slice(0, 1000), ads.length, now,
  );
  let inserted = 0;
  const stmts = [];
  ads.forEach((ad, i) => {
    const libraryId = String(ad.libraryId || '').replace(/\D/g, '');
    if (!libraryId) return;
    const media = [
      ...(ad.images || []).slice(0, 6).map((url) => ({ type: 'image', url: typeof url === 'string' ? url : url?.url })),
      ...(ad.videos || []).slice(0, 3).map((v) => ({ type: 'video', url: v.src || '', poster: v.poster || '' })),
    ].filter((m) => m.url && /^https:/.test(m.url));
    stmts.push(env.DB.prepare(
      `INSERT INTO competitor_ads (library_id, page_name, page_url, body, cta, start_date, start_ts, variants, rank, keyword, scan_id, media, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(library_id) DO UPDATE SET
         page_name = excluded.page_name, page_url = excluded.page_url,
         body = CASE WHEN length(excluded.body) > 0 THEN excluded.body ELSE competitor_ads.body END,
         cta = CASE WHEN length(excluded.cta) > 0 THEN excluded.cta ELSE competitor_ads.cta END,
         start_date = CASE WHEN length(excluded.start_date) > 0 THEN excluded.start_date ELSE competitor_ads.start_date END,
         start_ts = COALESCE(excluded.start_ts, competitor_ads.start_ts),
         variants = MAX(excluded.variants, competitor_ads.variants), rank = COALESCE(excluded.rank, competitor_ads.rank),
         keyword = excluded.keyword, scan_id = excluded.scan_id,
         media = CASE WHEN competitor_ads.media_saved = 1 THEN competitor_ads.media ELSE excluded.media END,
         last_seen = excluded.last_seen`,
    ).bind(
      libraryId,
      String(ad.pageName || '').slice(0, 200),
      String(ad.pageUrl || '').slice(0, 500),
      String(ad.body || '').slice(0, 5000),
      String(ad.cta || '').slice(0, 100),
      String(ad.startDate || '').slice(0, 100),
      parseAdDate(ad.startDate),
      Math.max(1, parseInt(ad.variants, 10) || 1),
      // Urutan dari bookmarklet = urutan impresi. Hasil Meta MCP diurutkan lain, jadi tidak diberi peringkat.
      payload.ranked === false ? null : i + 1,
      scan.keyword,
      scan.id,
      JSON.stringify(media),
      now,
      now,
    ));
    inserted++;
  });
  if (stmts.length) await env.DB.batch(stmts);
  await env.QUEUE.send({ type: 'ads_score', scanId: scan.id });
  return { scan, inserted };
}

// Penilaian: gabungan heuristik (lama tayang, urutan impresi, jumlah varian) + penilaian AI atas copy.
function heuristicScore(a) {
  const days = daysSince(a.start_ts) ?? 0;
  const longevity = Math.min(45, days * 1.2); // 38 hari ≈ maksimal
  const rank = a.rank ? Math.max(0, 35 - (a.rank - 1) * 1.5) : 10;
  const variants = Math.min(20, (a.variants - 1) * 5);
  return Math.round(longevity + rank + variants);
}

export async function scoreScan(env, scanId) {
  const ads = await all(env, 'SELECT * FROM competitor_ads WHERE scan_id = ? AND score IS NULL ORDER BY rank LIMIT 30', scanId);
  for (let i = 0; i < ads.length; i += 10) {
    const batch = ads.slice(i, i + 10);
    let ai = {};
    let model = '';
    try {
      const r = await fastJson(env, [{
        role: 'user',
        content: `Nilai kekuatan copy iklan berikut (0-100) dari sisi hook, kejelasan penawaran, emosi, dan CTA. Balas HANYA JSON: {"scores":[{"id":"library_id","score":80,"reason":"alasan singkat 1 kalimat"}]}\n\n${batch.map((a) => `id ${a.library_id} | halaman ${a.page_name} | CTA ${a.cta || '-'}\n"${truncate(a.body.replace(/\s+/g, ' '), 500) || '(tanpa teks, iklan visual)'}"`).join('\n\n')}`,
      }], { system: 'Kamu juri iklan direct-response yang berpengalaman di pasar Indonesia.', maxTokens: 1200 });
      model = r.model;
      for (const s of r.data?.scores || []) ai[String(s.id)] = s;
    } catch (e) {
      console.error('scoreScan AI', e?.message);
    }
    const stmts = batch.map((a) => {
      const h = heuristicScore(a);
      const s = ai[a.library_id];
      const aiScore = Number.isFinite(Number(s?.score)) ? Math.max(0, Math.min(100, Number(s.score))) : null;
      const score = aiScore === null ? h : Math.round(h * 0.6 + aiScore * 0.4);
      const days = daysSince(a.start_ts);
      const reason = `${days !== null ? `Tayang ${days} hari` : 'Lama tayang tidak diketahui'}${a.rank ? `, urutan impresi #${a.rank}` : ''}${a.variants > 1 ? `, ${a.variants} varian` : ''}.${s?.reason ? ' ' + s.reason : ''}`;
      return env.DB.prepare('UPDATE competitor_ads SET score = ?, score_reason = ?, score_model = ? WHERE id = ?').bind(Math.min(100, score), reason, aiScore === null ? 'heuristik' : model, a.id);
    });
    await env.DB.batch(stmts);
  }
  // Iklan pemenang: salin gambar/video ke penyimpanan permanen (link Facebook kedaluwarsa dalam beberapa hari).
  const fresh = await all(env, 'SELECT * FROM competitor_ads WHERE scan_id = ? AND media_saved = 0', scanId);
  for (const a of fresh.filter(isWinner).slice(0, 15)) {
    await env.QUEUE.send({ type: 'ads_save_media', adId: a.id });
  }
}

export async function saveAdMedia(env, adId) {
  const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', adId);
  if (!a || a.media_saved) return;
  const media = JSON.parse(a.media || '[]');
  let saved = 0;
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    for (const [field, outField] of [['url', 'saved'], ['poster', 'savedPoster']]) {
      const src = m[field];
      if (!src || m[outField]) continue;
      try {
        const res = await fetch(src, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.facebook.com/' } });
        if (!res.ok) continue;
        const len = Number(res.headers.get('content-length') || 0);
        if (len > MAX_MEDIA_BYTES) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_MEDIA_BYTES) continue;
        const key = `media:${a.library_id}:${await sha256url(src).then((h) => h.slice(0, 12))}`;
        const type = res.headers.get('content-type') || (m.type === 'video' && field === 'url' ? 'video/mp4' : 'image/jpeg');
        await env.KV.put(key, buf, { metadata: { type } });
        m[outField] = `/media/${encodeURIComponent(key)}`;
        saved++;
      } catch (e) {
        console.error('saveAdMedia', e?.message);
      }
    }
  }
  await run(env, 'UPDATE competitor_ads SET media = ?, media_saved = ? WHERE id = ?', JSON.stringify(media), saved ? 1 : 0, adId);
}

// Gambar iklan untuk Claude dikirim sebagai URL media yang sudah disalin ke KV (diambil Anthropic),
// bukan base64, supaya Worker tidak melewati batas CPU paket gratis.
async function adImagesForClaude(env, ad) {
  if (!ad.media_saved) {
    await saveAdMedia(env, ad.id);
    ad = (await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', ad.id)) || ad;
  }
  const origin = env.PUBLIC_URL || (await getSetting(env, 'public_url', ''));
  if (!origin) return [];
  const blocks = [];
  for (const m of JSON.parse(ad.media || '[]')) {
    if (blocks.length >= 3) break;
    const src = m.type === 'image' ? m.saved : m.savedPoster;
    if (src?.startsWith('/media/')) blocks.push({ type: 'image', source: { type: 'url', url: origin + src } });
  }
  return blocks;
}

function adSummary(a) {
  return `Halaman: ${a.page_name}\nLibrary ID: ${a.library_id}\nMulai tayang: ${a.start_date || '?'} (${daysSince(a.start_ts) ?? '?'} hari)\nUrutan impresi di pencarian "${a.keyword}": ${a.rank ? '#' + a.rank : 'tidak diketahui'}\nJumlah varian: ${a.variants}\nCTA: ${a.cta || '-'}\nSkor: ${a.score ?? '-'} (${a.score_reason})\nTeks iklan:\n"""${a.body || '(tanpa teks)'}"""`;
}

export async function analyzeAd(env, adId) {
  const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', adId);
  if (!a) return;
  const profile = await getProfile(env);
  try {
    const images = hasSmart(env) ? await adImagesForClaude(env, a) : [];
    const ask = (imgs) => smartChat(env, {
      system: 'Kamu ahli strategi iklan direct-response dan creative strategist untuk pasar Indonesia. Tulis dalam Bahasa Indonesia, Markdown, tajam dan praktis.',
      messages: [{
        role: 'user',
        content: [
          ...imgs,
          { type: 'text', text: `Bedah iklan kompetitor ini.\n\n${adSummary(a)}\n\nBISNIS PEMILIK: ${profile.summary || '(belum diisi)'}\n\nStruktur laporan:\n1. Ringkasan (kenapa iklan ini kemungkinan menang)\n2. Hook (3 detik / kalimat pertama)\n3. Angle & emosi yang dimainkan\n4. Penawaran & bukti (offer, harga, garansi, testimoni)\n5. Struktur copy & CTA\n6. Visual${imgs.length ? ' (berdasarkan gambar terlampir)' : ' (perkiraan dari teks)'}\n7. Kelemahan / celah yang bisa diserang\n8. Cara mengadaptasi untuk bisnis pemilik (bukan menjiplak)` },
        ],
      }],
      maxTokens: 5000,
    });
    let out = await ask(images);
    // Kalau Claude gagal mengambil gambar, ulangi dengan teks saja sebelum menyerah ke Workers AI.
    if (!out.smart && images.length) out = await ask([]);
    await run(env, "UPDATE competitor_ads SET analysis = ?, analysis_status = 'done' WHERE id = ?", out.text + `\n\n_Dianalisis oleh ${modelLabel(out.model)}_`, adId);
  } catch (e) {
    await run(env, "UPDATE competitor_ads SET analysis = ?, analysis_status = 'error' WHERE id = ?", `Gagal: ${e?.message || e}`, adId);
  }
}

export async function makeVariations(env, adId) {
  const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', adId);
  if (!a) return;
  const profile = await getProfile(env);
  try {
    const out = await smartChat(env, {
      system: 'Kamu copywriter & content creator senior untuk pasar Indonesia. Tulis dalam Bahasa Indonesia, Markdown.',
      messages: [{
        role: 'user',
        content: `Iklan kompetitor yang terbukti bekerja:\n${adSummary(a)}\n${a.analysis ? '\nBedah iklan sebelumnya:\n' + truncate(a.analysis, 4000) : ''}\n\nBISNIS PEMILIK: ${profile.summary || '(belum diisi — buat versi umum yang mudah disesuaikan)'}\n\nBuat 5 konten yang meniru POLA (hook, angle, struktur) iklan ini tetapi untuk bisnis pemilik, orisinal, tanpa menjiplak kalimat. Untuk setiap konten tulis:\n### Konten N — [format: feed/reels/story/carousel]\n- Hook\n- Copy lengkap / script\n- Ide visual\n- CTA\n- Kenapa ini akan bekerja (1 kalimat)`,
      }],
      maxTokens: 7000,
    });
    const text = out.text + `\n\n_Ditulis oleh ${modelLabel(out.model)}_`;
    await run(env, "UPDATE competitor_ads SET variations = ?, variations_status = 'done' WHERE id = ?", text, adId);
    const note = await addNote(env, { title: `5 konten mirip iklan ${a.page_name || a.library_id}`, content: text, tags: 'konten, riset-kompetitor', source: 'riset' });
    if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) {
      await sendText(env, `✍️ 5 konten mirip iklan ${a.page_name} sudah jadi.\nTersimpan di Catatan #${note.id}.\n\n${truncate(text, 3000)}`);
    }
  } catch (e) {
    await run(env, "UPDATE competitor_ads SET variations = ?, variations_status = 'error' WHERE id = ?", `Gagal: ${e?.message || e}`, adId);
  }
}

export async function listAds(env, { keyword = '', scanId = null, sort = 'rank', limit = 120, winners = false } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('keyword = ?');
    params.push(keyword);
  }
  if (scanId) {
    where.push('scan_id = ?');
    params.push(scanId);
  }
  const order = {
    rank: 'rank IS NULL, rank ASC, start_ts IS NULL, start_ts ASC',
    days: 'start_ts IS NULL, start_ts ASC',
    score: 'score IS NULL, score DESC',
    new: 'first_seen DESC',
  }[sort] || 'rank ASC';
  const rows = await all(env, `SELECT * FROM competitor_ads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`, ...params, limit);
  const out = rows.map(decorateAd);
  return winners ? out.filter((a) => a.winner) : out;
}

export async function listScans(env) {
  const scans = await all(env, 'SELECT * FROM competitor_scans ORDER BY id DESC LIMIT 50');
  const keywords = await all(env, "SELECT keyword, COUNT(*) AS n, MAX(last_seen) AS last FROM competitor_ads GROUP BY keyword ORDER BY last DESC");
  return { scans, keywords };
}

export async function deleteAd(env, id) {
  const a = await first(env, 'SELECT * FROM competitor_ads WHERE id = ?', id);
  if (!a) return;
  for (const m of JSON.parse(a.media || '[]')) {
    for (const k of [m.saved, m.savedPoster]) {
      if (k?.startsWith('/media/')) await env.KV.delete(decodeURIComponent(k.slice(7))).catch(() => {});
    }
  }
  await run(env, 'DELETE FROM competitor_ads WHERE id = ?', id);
}

export async function serveMedia(env, key) {
  if (!key.startsWith('media:')) return new Response('Not found', { status: 404 });
  const { value, metadata } = await env.KV.getWithMetadata(key, 'stream');
  if (!value) return new Response('Not found', { status: 404 });
  return new Response(value, {
    headers: { 'content-type': metadata?.type || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
