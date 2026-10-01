// Scan otomatis Meta Ad Library dengan Cloudflare Browser Rendering (Chrome di server Cloudflare).
// Membuka hasil pencarian yang diurutkan dari impresi terbanyak, scroll, membaca iklan dengan
// pembaca yang sama dengan bookmarklet, lalu menyimpan ke Riset Kompetitor.

import puppeteer from '@cloudflare/puppeteer';
import { scrapeAdLibrary } from '../public/scanner-core.js';
import { first, all, getSetting, setSetting } from './db.js';
import { ingestScan } from './competitor.js';
import { localParts } from './time.js';

const MAX_ADS = 60;
const SCROLLS = 8;

export function adLibraryUrl(w) {
  const p = new URLSearchParams({
    active_status: 'active', ad_type: 'all', country: w.country || 'ID', q: w.value,
    search_type: 'keyword_unordered', media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${p}&sort_data[direction]=desc&sort_data[mode]=total_impressions`;
}

export async function scanStatus(env) {
  return (await getSetting(env, 'browser_scans', {})) || {};
}

async function setStatus(env, watchId, patch) {
  const all = await scanStatus(env);
  all[watchId] = { ...(all[watchId] || {}), ...patch, at: Date.now() };
  await setSetting(env, 'browser_scans', all);
}

// Masukkan scan ke antrean. watchIds kosong = semua daftar pantauan.
export async function queueScans(env, watchIds = []) {
  const list = watchIds.length
    ? (await Promise.all(watchIds.map((id) => first(env, 'SELECT * FROM competitor_watchlist WHERE id = ?', id)))).filter(Boolean)
    : await all(env, 'SELECT * FROM competitor_watchlist ORDER BY id');
  let i = 0;
  for (const w of list) {
    await setStatus(env, w.id, { state: 'queued', error: '' });
    // Beri jeda antar scan supaya tidak membuka banyak browser sekaligus (batas paket gratis: 3).
    await env.QUEUE.send({ type: 'ads_browser_scan', watchId: w.id }, { delaySeconds: Math.min(900, i * 75) });
    i++;
  }
  return list.length;
}

export async function runBrowserScan(env, watchId) {
  const w = await first(env, 'SELECT * FROM competitor_watchlist WHERE id = ?', watchId);
  if (!w) return;
  if (!env.BROWSER) {
    await setStatus(env, watchId, { state: 'error', error: 'Browser Rendering belum aktif di Worker ini.' });
    return;
  }
  await setStatus(env, watchId, { state: 'running', error: '' });
  const url = adLibraryUrl(w);
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 2000 });
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(
      '/Library ID|ID Galeri|ID Pustaka|No ads match|Tidak ada iklan|Log in|Masuk/i.test(document.body.innerText)',
      { timeout: 30000 },
    ).catch(() => {});
    // Tutup dialog cookie/login bila muncul, lalu scroll supaya lebih banyak iklan dimuat.
    await page.evaluate(`(function () {
      var b = Array.prototype.slice.call(document.querySelectorAll('div[role="button"], button')).find(function (x) {
        return /^(Allow all cookies|Decline optional cookies|Only allow essential cookies|Close|Tutup|Not now|Lain kali)$/i.test((x.innerText || '').trim());
      });
      if (b) b.click();
    })()`);
    for (let i = 0; i < SCROLLS; i++) {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await new Promise((r) => setTimeout(r, 1800));
      const n = await page.evaluate(`(document.body.innerText.match(/Library ID|ID Galeri|ID Pustaka/gi) || []).length`);
      if (n >= MAX_ADS) break;
    }
    // Dijalankan sebagai teks supaya kode hasil bundling tidak membawa helper yang tidak ada di halaman.
    const ads = await page.evaluate(`var __name = function (f) { return f; }; (${scrapeAdLibrary.toString()})(${MAX_ADS})`);
    if (!Array.isArray(ads) || !ads.length) {
      const text = String(await page.evaluate('document.body.innerText.slice(0, 400)'));
      const blocked = /log in|masuk|login|checkpoint|captcha/i.test(text);
      throw new Error(blocked
        ? 'Facebook meminta login/memblokir browser server. Pakai bookmark "Kirim ke Second Brain" untuk sementara.'
        : 'Tidak ada iklan yang terbaca di hasil pencarian.');
    }
    const r = await ingestScan(env, { keyword: w.value, country: w.country, url, ads, source: 'cloudflare-browser' });
    await setStatus(env, watchId, { state: 'done', count: r.inserted, fresh: r.fresh, error: '' });
  } catch (e) {
    console.error('browser scan', w.value, e?.message);
    await setStatus(env, watchId, { state: 'error', error: String(e?.message || e).slice(0, 300) });
  } finally {
    await browser?.close().catch(() => {});
  }
}

// Dipanggil cron tiap menit: scan otomatis seluruh daftar pantauan sekali sehari jam 06:00 lokal.
export async function dailyAutoScan(env) {
  const p = localParts(env);
  if (p.hh !== 6 || (await getSetting(env, 'last_auto_scan')) === p.date) return;
  await setSetting(env, 'last_auto_scan', p.date);
  await queueScans(env);
}
