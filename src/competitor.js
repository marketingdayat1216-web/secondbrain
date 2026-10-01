// Riset Kompetitor: iklan dari Meta Ad Library (dikirim lewat bookmarklet), penilaian,
// salin media iklan pemenang ke KV, laporan bedah iklan & "Bikin 5 konten mirip" (Claude Opus).

import { all, first, run, getSetting } from './db.js';
import { smartJson, smartChat, modelLabel, hasSmart } from './ai.js';
import { getProfile, addNote } from './store.js';
import { parseAdDate, daysSince } from './time.js';
import { truncate, sha256url } from './util.js';
import { sendText } from './telegram-api.js';

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export const ANGLES = ['Edukasi', 'Promo / harga', 'Masalah → solusi', 'Testimoni', 'Ahli / otoritas', 'Gaya hidup', 'Lainnya'];
export const HOOKS = ['Sangat kuat', 'Kuat', 'Biasa', 'Lemah'];
const EVERGREEN_DAYS = 90;

// pageActive = jumlah iklan aktif halaman ini (untuk label SCALING).
export function decorateAd(a, pageActive = 0) {
  let media = [];
  try {
    media = JSON.parse(a.media || '[]');
  } catch {}
  const days = daysSince(a.start_ts);
  return {
    ...a,
    media: media.map((m) => ({ ...m, display: m.saved || m.url, poster: m.savedPoster || m.poster || '' })),
    days_running: days,
    score_model: a.score_model ? modelLabel(a.score_model) : '',
    winner: isWinner(a),
    evergreen: (days ?? 0) >= EVERGREEN_DAYS,
    // Scaling: banyak duplikat, atau halaman ini menjalankan banyak iklan aktif dan iklan ini di 5 impresi teratas.
    scaling: a.variants >= 3 || (pageActive >= 3 && a.rank && a.rank <= 5),
  };
}

function isWinner(a) {
  const days = daysSince(a.start_ts) ?? 0;
  return days >= 30 || (a.rank && a.rank <= 5) || (a.score ?? 0) >= 75;
}

function firstLine(text = '') {
  const line = String(text).split('\n').map((l) => l.trim()).find((l) => l.length > 3) || '';
  return line.slice(0, 220);
}

function domainOf(v = '') {
  const s = String(v).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) && !/facebook\.com|fb\.me|instagram\.com/.test(s) ? s : '';
}

export async function ingestScan(env, payload) {
  const ads = Array.isArray(payload.ads) ? payload.ads.slice(0, 120) : [];
  if (!ads.length) throw new Error('Tidak ada iklan di data scan. Pastikan halaman Ad Library sudah menampilkan hasil.');
  const now = Date.now();
  const ids = ads.map((ad) => String(ad.libraryId || '').replace(/\D/g, '')).filter(Boolean);
  // Hitung yang baru (D1 membatasi 100 parameter per query).
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await all(env, `SELECT library_id FROM competitor_ads WHERE library_id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
    rows.forEach((r) => existing.add(r.library_id));
  }
  const fresh = [...new Set(ids)].filter((id) => !existing.has(id)).length;
  const scan = await first(
    env,
    'INSERT INTO competitor_scans (keyword, country, url, ad_count, new_count, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    String(payload.keyword || '').slice(0, 200), String(payload.country || '').slice(0, 10), String(payload.url || '').slice(0, 1000),
    ids.length, fresh, String(payload.source || (payload.ranked === false ? 'meta-mcp' : 'bookmarklet')).slice(0, 30), now,
  );
  let inserted = 0;
  const stmts = [];
  ads.forEach((ad, i) => {
    const libraryId = String(ad.libraryId || '').replace(/\D/g, '');
    if (!libraryId) return;
    const media = [
      ...(ad.images || []).slice(0, 6).map((url) => ({ type: 'image', url: typeof url === 'string' ? url : url?.url })),
      ...(ad.videos || []).slice(0, 3).map((v) => ({ type: 'video', url: typeof v === 'string' ? v : v.src || v.url || '', poster: v.poster || '' })),
    ].filter((m) => m.url && /^https:/.test(m.url));
    const body = String(ad.body || '').slice(0, 5000);
    const mediaType = media.some((m) => m.type === 'video') ? 'video' : media.length ? 'image' : '';
    const seconds = Number(ad.videoSeconds);
    stmts.push(env.DB.prepare(
      `INSERT INTO competitor_ads (library_id, page_name, page_url, body, headline, landing, cta, start_date, start_ts, variants, rank, keyword, scan_id, media, media_type, video_seconds, active, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(library_id) DO UPDATE SET
         page_name = CASE WHEN length(excluded.page_name) > 0 THEN excluded.page_name ELSE competitor_ads.page_name END,
         page_url = CASE WHEN length(excluded.page_url) > 0 THEN excluded.page_url ELSE competitor_ads.page_url END,
         body = CASE WHEN length(excluded.body) > 0 THEN excluded.body ELSE competitor_ads.body END,
         headline = CASE WHEN length(excluded.headline) > 0 THEN excluded.headline ELSE competitor_ads.headline END,
         landing = CASE WHEN length(excluded.landing) > 0 THEN excluded.landing ELSE competitor_ads.landing END,
         cta = CASE WHEN length(excluded.cta) > 0 THEN excluded.cta ELSE competitor_ads.cta END,
         start_date = CASE WHEN length(excluded.start_date) > 0 THEN excluded.start_date ELSE competitor_ads.start_date END,
         start_ts = COALESCE(excluded.start_ts, competitor_ads.start_ts),
         variants = MAX(excluded.variants, competitor_ads.variants), rank = COALESCE(excluded.rank, competitor_ads.rank),
         keyword = excluded.keyword, scan_id = excluded.scan_id,
         media = CASE WHEN competitor_ads.media_saved = 1 OR excluded.media = '[]' THEN competitor_ads.media ELSE excluded.media END,
         media_type = CASE WHEN length(excluded.media_type) > 0 THEN excluded.media_type ELSE competitor_ads.media_type END,
         video_seconds = COALESCE(excluded.video_seconds, competitor_ads.video_seconds),
         active = excluded.active,
         last_seen = excluded.last_seen`,
    ).bind(
      libraryId,
      String(ad.pageName || '').slice(0, 200),
      String(ad.pageUrl || '').slice(0, 500),
      body,
      String(ad.headline || firstLine(body)).slice(0, 300),
      domainOf(ad.landing),
      String(ad.cta || '').slice(0, 100),
      String(ad.startDate || '').slice(0, 100),
      parseAdDate(ad.startDate),
      Math.max(1, parseInt(ad.variants, 10) || 1),
      // Urutan dari bookmarklet = urutan impresi. Hasil Meta MCP diurutkan lain, jadi tidak diberi peringkat.
      payload.ranked === false ? null : i + 1,
      scan.keyword,
      scan.id,
      JSON.stringify(media),
      mediaType,
      Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
      ad.active === false ? 0 : 1,
      now,
      now,
    ));
    inserted++;
  });
  if (stmts.length) await env.DB.batch(stmts);
  await env.QUEUE.send({ type: 'ads_score', scanId: scan.id });
  return { scan, inserted, fresh };
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
  const ads = await all(env, "SELECT * FROM competitor_ads WHERE scan_id = ? AND (score IS NULL OR angle = '') ORDER BY rank LIMIT 40", scanId);
  for (let i = 0; i < ads.length; i += 8) {
    const batch = ads.slice(i, i + 8);
    let ai = {};
    let model = '';
    try {
      const r = await smartJson(env, { effort: 'low', maxTokens: 3000, system: 'Kamu juri iklan direct-response yang berpengalaman di pasar Indonesia.', messages: [{
        role: 'user',
        content: `Nilai setiap iklan berikut. Balas HANYA JSON:
{"scores":[{"id":"library_id","score":0-100,"reason":"alasan 1 kalimat","angle":"${ANGLES.join('|')}","hook":"${HOOKS.join('|')}","promo":true/false,"risky":true/false,"worth_copy":true/false}]}
- score: kekuatan copy (hook, kejelasan penawaran, emosi, CTA).
- angle: pilih SATU yang paling dominan dari daftar.
- hook: kekuatan kalimat pembuka.
- promo: ada diskon/harga/gratis ongkir/COD/bonus.
- risky: ada klaim kesehatan/hasil yang berlebihan atau berisiko melanggar kebijakan iklan.
- worth_copy: polanya layak ditiru pengiklan lain (bukan kalimatnya).

${batch.map((a) => `id ${a.library_id} | halaman ${a.page_name} | CTA ${a.cta || '-'}\n"${truncate(a.body.replace(/\s+/g, ' '), 500) || a.headline || '(tanpa teks, iklan visual)'}"`).join('\n\n')}`,
      }] });
      model = r.model;
      for (const s of r.data?.scores || []) ai[String(s.id)] = s;
    } catch (e) {
      // Opus tidak bisa dipakai: simpan skor heuristik dulu; angle/hook dinilai ulang pada scan berikutnya.
      console.error('scoreScan Opus', e?.message);
      model = '';
    }
    const pick = (v, list, def) => list.find((x) => x.toLowerCase() === String(v || '').toLowerCase().trim()) || def;
    const stmts = batch.map((a) => {
      const h = heuristicScore(a);
      const s = ai[a.library_id];
      const aiScore = Number.isFinite(Number(s?.score)) ? Math.max(0, Math.min(100, Number(s.score))) : null;
      const score = a.score ?? (aiScore === null ? h : Math.round(h * 0.6 + aiScore * 0.4));
      const days = daysSince(a.start_ts);
      const reason = `${days !== null ? `Tayang ${days} hari` : 'Lama tayang tidak diketahui'}${a.rank ? `, urutan impresi #${a.rank}` : ''}${a.variants > 1 ? `, ${a.variants} varian` : ''}.${s?.reason ? ' ' + s.reason : ''}`;
      const hook = s ? pick(s.hook, HOOKS, 'Biasa') : '';
      return env.DB.prepare(
        'UPDATE competitor_ads SET score = ?, score_reason = ?, score_model = ?, angle = ?, hook = ?, is_promo = ?, risky_claim = ?, worth_copy = ? WHERE id = ?',
      ).bind(
        Math.min(100, score),
        a.score_reason || reason,
        aiScore === null ? (a.score_model || 'heuristik (Opus belum menilai)') : model,
        s ? pick(s.angle, ANGLES, 'Lainnya') : '',
        hook,
        s?.promo ? 1 : 0,
        s?.risky ? 1 : 0,
        s?.worth_copy && hook !== 'Lemah' ? 1 : 0,
        a.id,
      );
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
  return `Halaman: ${a.page_name}\nLibrary ID: ${a.library_id}\nMulai tayang: ${a.start_date || '?'} (${daysSince(a.start_ts) ?? '?'} hari)\nAngle: ${a.angle || '-'} · Hook: ${a.hook || '-'}\nUrutan impresi di pencarian "${a.keyword}": ${a.rank ? '#' + a.rank : 'tidak diketahui'}\nJumlah varian: ${a.variants}\nCTA: ${a.cta || '-'}\nSkor: ${a.score ?? '-'} (${a.score_reason})\nTeks iklan:\n"""${a.body || '(tanpa teks)'}"""`;
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
      fallback: false,
    });
    let out;
    try {
      out = await ask(images);
    } catch (e) {
      // Kalau Claude gagal mengambil gambar, ulangi dengan teks saja (tetap Opus).
      if (!images.length) throw e;
      out = await ask([]);
    }
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
      fallback: false,
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

export async function listAds(env, { keyword = '', scanId = null, sort = 'impressions', limit = 200, winners = false, q = '', page = '', angle = '', active = false } = {}) {
  const where = [];
  const params = [];
  if (keyword) { where.push('keyword = ?'); params.push(keyword); }
  if (scanId) { where.push('scan_id = ?'); params.push(scanId); }
  if (page) { where.push('page_name = ?'); params.push(page); }
  if (angle) { where.push('angle = ?'); params.push(angle); }
  if (active) where.push('active = 1');
  if (q) {
    const like = `%${String(q).toLowerCase()}%`;
    where.push('(LOWER(body) LIKE ? OR LOWER(page_name) LIKE ? OR LOWER(headline) LIKE ? OR LOWER(landing) LIKE ?)');
    params.push(like, like, like, like);
  }
  const order = {
    impressions: 'rank IS NULL, rank ASC, start_ts IS NULL, start_ts ASC',
    rank: 'rank IS NULL, rank ASC, start_ts IS NULL, start_ts ASC',
    days: 'start_ts IS NULL, start_ts ASC',
    score: 'score IS NULL, score DESC',
    new: 'first_seen DESC, start_ts DESC',
  }[sort] || 'rank IS NULL, rank ASC';
  const [rows, pages] = await Promise.all([
    all(env, `SELECT * FROM competitor_ads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`, ...params, limit),
    all(env, 'SELECT page_name, SUM(active) AS n FROM competitor_ads GROUP BY page_name'),
  ]);
  const activeByPage = Object.fromEntries(pages.map((p) => [p.page_name, p.n || 0]));
  const out = rows.map((a) => decorateAd(a, activeByPage[a.page_name] || 0));
  return winners ? out.filter((a) => a.winner) : out;
}

export async function researchStats(env) {
  const weekAgo = Date.now() - 7 * 86400000;
  const [totals, competitors, angles, lastScan] = await Promise.all([
    first(env, `SELECT COUNT(*) AS total, COALESCE(SUM(active), 0) AS active, COUNT(DISTINCT page_name) AS pages,
      COALESCE(SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END), 0) AS new7 FROM competitor_ads`, weekAgo),
    all(env, `SELECT page_name, COUNT(*) AS total, COALESCE(SUM(active), 0) AS active, MIN(start_ts) AS oldest
      FROM competitor_ads WHERE page_name != '' GROUP BY page_name ORDER BY active DESC, total DESC LIMIT 40`),
    all(env, "SELECT angle, COUNT(*) AS n FROM competitor_ads WHERE angle != '' GROUP BY angle ORDER BY n DESC"),
    first(env, 'SELECT * FROM competitor_scans ORDER BY id DESC LIMIT 1'),
  ]);
  return {
    totals,
    competitors: competitors.map((c) => ({ ...c, oldest_days: daysSince(c.oldest) ?? 0 })),
    angles,
    lastScan,
    anglesList: ANGLES,
  };
}

export function listWatchlist(env) {
  return all(env, 'SELECT * FROM competitor_watchlist ORDER BY id');
}

export async function addWatch(env, { kind = 'keyword', value, country = 'ID' }) {
  value = String(value || '').trim();
  if (!value) throw new Error('Isi kata kunci atau nama halaman');
  kind = kind === 'page' ? 'page' : 'keyword';
  country = String(country || 'ID').trim().toUpperCase().slice(0, 2) || 'ID';
  await run(env, 'INSERT OR IGNORE INTO competitor_watchlist (kind, value, country, created_at) VALUES (?, ?, ?, ?)', kind, value.slice(0, 120), country, Date.now());
  return listWatchlist(env);
}

export async function removeWatch(env, id) {
  await run(env, 'DELETE FROM competitor_watchlist WHERE id = ?', id);
}

// Iklan yang punya laporan bedah / konten tim.
export async function listWork(env, kind) {
  const col = kind === 'variations' ? 'variations_status' : 'analysis_status';
  const rows = await all(env, `SELECT * FROM competitor_ads WHERE ${col} != '' ORDER BY ${col} = 'pending' DESC, score DESC LIMIT 100`);
  return rows.map((a) => decorateAd(a));
}

// Laporan dari luar (mis. Claude lewat konektor MCP).
export async function saveReport(env, idOrLibrary, report) {
  const a = await first(env, 'SELECT id FROM competitor_ads WHERE id = ? OR library_id = ?', Number(idOrLibrary) || -1, String(idOrLibrary));
  if (!a) return null;
  await run(env, "UPDATE competitor_ads SET analysis = ?, analysis_status = 'done' WHERE id = ?", String(report).slice(0, 30000), a.id);
  return a.id;
}

// Antrikan bedah iklan untuk n iklan terkuat yang belum dibedah.
export async function analyzeTop(env, n = 5) {
  const rows = await all(env, "SELECT id FROM competitor_ads WHERE analysis_status IN ('', 'error') ORDER BY COALESCE(score, 0) DESC, rank ASC LIMIT ?", Math.min(10, n));
  for (const r of rows) {
    await run(env, "UPDATE competitor_ads SET analysis_status = 'pending' WHERE id = ?", r.id);
    await env.QUEUE.send({ type: 'ads_analyze', adId: r.id });
  }
  return rows.length;
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
