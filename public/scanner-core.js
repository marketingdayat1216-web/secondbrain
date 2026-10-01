// Pembaca halaman hasil Meta Ad Library. Dipakai di dua tempat:
// - bookmarklet "Kirim ke Second Brain" (Chrome pengguna)
// - scan otomatis di Cloudflare Browser Rendering (src/browser-scan.js)
// Fungsi ini dijalankan DI DALAM halaman Facebook, jadi harus mandiri:
// tanpa import, tanpa variabel dari luar, gaya ES5 supaya aman diserialisasi.
export function scrapeAdLibrary(maxAds) {
  var MAX = maxAds || 120;
  var ID_RE = /(Library ID|ID Galeri|ID Pustaka|ID perpustakaan|ID Arsip)\s*:?\s*(\d{6,})/i;
  var ID_RE_G = /(Library ID|ID Galeri|ID Pustaka|ID perpustakaan|ID Arsip)\s*:?\s*(\d{6,})/gi;
  var START_RE = /(Started running on|Mulai dijalankan pada|Mulai ditayangkan pada|Mulai tayang pada|Mulai berjalan pada|Mulai dijalankan|Mulai ditayangkan)\s+([^·\n]+)/i;
  var VAR_RE = /(\d+)\s+(ads use this creative|iklan menggunakan materi|iklan menggunakan konten|iklan menggunakan)/i;
  var CTA_RE = /^(Shop now|Learn more|Sign up|Send message|Send WhatsApp message|WhatsApp|Book now|Order now|Get offer|Contact us|Download|Install now|Apply now|Subscribe|Watch more|Belanja sekarang|Pelajari selengkapnya|Selengkapnya|Daftar|Kirim pesan|Kirim Pesan WhatsApp|Pesan sekarang|Hubungi kami|Dapatkan penawaran|Unduh|Instal sekarang|Lamar sekarang)$/i;
  var DOMAIN_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  function countIds(t) { var m = (t || '').match(ID_RE_G); return m ? m.length : 0; }
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var seen = {};
  var ads = [];
  var node;
  while ((node = walker.nextNode()) && ads.length < MAX) {
    var mm = (node.nodeValue || '').match(ID_RE);
    if (!mm || seen[mm[2]]) continue;
    seen[mm[2]] = 1;
    var card = node.parentElement;
    while (card.parentElement && card.parentElement !== document.body && countIds(card.parentElement.innerText) === 1) card = card.parentElement;
    var text = card.innerText || '';
    var start = text.match(START_RE);
    var variants = text.match(VAR_RE);
    var active = !/\b(Inactive|Tidak aktif|Nonaktif)\b/i.test(text);
    var bodyEl = card.querySelector('div[style*="pre-wrap"], span[style*="pre-wrap"]');
    var body = bodyEl ? bodyEl.innerText : '';
    if (!body) {
      var lines = text.split('\n').filter(function (l) { return l.length > 60 && !ID_RE.test(l) && !START_RE.test(l); });
      body = lines.sort(function (a, b) { return b.length - a.length; })[0] || '';
    }
    var pageName = '';
    var pageUrl = '';
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var t = (links[i].innerText || '').trim();
      var h = links[i].href || '';
      if (t && t.length < 80 && /facebook\.com\/(?!ads\/library|l\.php)/.test(h) && !/ad details|detail iklan|lihat/i.test(t)) { pageName = t; pageUrl = h; break; }
    }
    if (!pageName) {
      var strong = card.querySelector('strong, span[dir="auto"] > span');
      pageName = strong ? strong.innerText.trim().slice(0, 80) : '';
    }
    var cta = '';
    var landing = '';
    var leaves = card.querySelectorAll('div, span, a');
    for (var j = 0; j < leaves.length; j++) {
      if (leaves[j].children.length) continue;
      var ct = (leaves[j].innerText || '').trim();
      if (!cta && ct && ct.length < 40 && CTA_RE.test(ct)) cta = ct;
      if (!landing && ct && ct.length < 60 && DOMAIN_RE.test(ct) && !/facebook|instagram|fb\.me/i.test(ct)) landing = ct.toLowerCase();
    }
    var imgs = [];
    var imgEls = card.querySelectorAll('img');
    for (var k = 0; k < imgEls.length; k++) {
      var im = imgEls[k];
      var w = im.naturalWidth || im.width;
      var src = im.currentSrc || im.src;
      if (w >= 150 && src && src.indexOf('http') === 0 && imgs.indexOf(src) < 0) imgs.push(src);
    }
    var vids = [];
    var seconds = null;
    var vidEls = card.querySelectorAll('video');
    for (var n = 0; n < vidEls.length; n++) {
      var v = vidEls[n];
      var vsrc = v.currentSrc || v.src || (v.querySelector('source') || {}).src;
      if (vsrc && vsrc.indexOf('blob:') !== 0) vids.push({ src: vsrc, poster: v.poster || '' });
      if (!seconds && isFinite(v.duration) && v.duration > 0) seconds = Math.round(v.duration);
    }
    // Nama pengguna halaman (mis. kokofit.herbal) bukan domain tujuan.
    if (landing && (landing.replace(/[^a-z0-9]/g, '') === pageName.toLowerCase().replace(/[^a-z0-9]/g, '') || pageUrl.toLowerCase().indexOf(landing) >= 0 || !/\.(com|id|co|net|org|shop|store|my|link|site|online|app|biz|info|xyz|pw|io|me)(\.[a-z]{2})?$/.test(landing))) landing = '';
    ads.push({
      libraryId: mm[2], pageName: pageName, pageUrl: pageUrl, body: body.slice(0, 5000), cta: cta, landing: landing,
      active: active, startDate: start ? start[2].trim() : '', variants: variants ? variants[1] : 1,
      images: imgs.slice(0, 6), videos: vids.slice(0, 3), videoSeconds: seconds,
    });
  }
  return ads;
}
