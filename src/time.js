// Waktu lokal pemilik berdasarkan TIMEZONE_OFFSET (jam dari UTC: 7 = WIB, 8 = WITA, 9 = WIT).

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export const DAY = 86400000;

export function offsetHours(env) {
  const n = Number(env.TIMEZONE_OFFSET ?? 7);
  return Number.isFinite(n) ? n : 7;
}

export function tzLabel(env) {
  const h = offsetHours(env);
  return { 7: 'WIB', 8: 'WITA', 9: 'WIT' }[h] || `UTC${h >= 0 ? '+' : ''}${h}`;
}

const pad = (n) => String(n).padStart(2, '0');

export function localParts(env, ts = Date.now()) {
  const d = new Date(ts + offsetHours(env) * 3600000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  return {
    y, m, day, hh, mm,
    dow: d.getUTCDay(),
    date: `${y}-${pad(m)}-${pad(day)}`,
    time: `${pad(hh)}:${pad(mm)}`,
  };
}

// Terima "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm", atau "YYYY-MM-DD" (jam default 09:00) dalam waktu lokal.
export function parseLocal(env, str) {
  if (str === null || str === undefined || str === '') return null;
  if (typeof str === 'number') return str;
  const m = String(str).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh = '9', mi = '0'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +hh, +mi) - offsetHours(env) * 3600000;
  return Number.isFinite(utc) ? utc : null;
}

export function toLocalInput(env, ts) {
  if (!ts) return '';
  const p = localParts(env, ts);
  return `${p.date} ${p.time}`;
}

export function startOfLocalDay(env, ts = Date.now()) {
  const p = localParts(env, ts);
  return Date.UTC(p.y, p.m - 1, p.day) - offsetHours(env) * 3600000;
}

export function fmtLocal(env, ts, { withTime = true } = {}) {
  if (!ts) return '';
  const p = localParts(env, ts);
  const today = localParts(env).date;
  const tomorrow = localParts(env, Date.now() + DAY).date;
  let dayStr;
  if (p.date === today) dayStr = 'Hari ini';
  else if (p.date === tomorrow) dayStr = 'Besok';
  else dayStr = `${HARI_PENDEK[p.dow]}, ${p.day} ${BULAN_PENDEK[p.m - 1]}`;
  return withTime ? `${dayStr} ${p.time}` : dayStr;
}

export function nowDescription(env, ts = Date.now()) {
  const p = localParts(env, ts);
  return `${HARI[p.dow]}, ${p.day} ${BULAN[p.m - 1]} ${p.y} pukul ${p.time} ${tzLabel(env)} (tanggal ISO ${p.date})`;
}

export function longDate(env, ts = Date.now()) {
  const p = localParts(env, ts);
  return `${HARI[p.dow]}, ${p.day} ${BULAN[p.m - 1]} ${p.y}`;
}

// Tanggal "Started running on ..." dari Meta Ad Library (Inggris atau Indonesia) → epoch ms.
const MONTHS = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1,
  mar: 2, march: 2, maret: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7, agu: 7, agt: 7, agustus: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, okt: 9, oktober: 9,
  nov: 10, november: 10, nop: 10, nopember: 10,
  dec: 11, december: 11, des: 11, desember: 11,
};

export function parseAdDate(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().replace(/,/g, ' ').replace(/\./g, ' ');
  let m = s.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/); // "sep 12 2026"
  if (m && m[1] in MONTHS) return Date.UTC(+m[3], MONTHS[m[1]], +m[2]);
  m = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/); // "12 sep 2026"
  if (m && m[2] in MONTHS) return Date.UTC(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return null;
}

export function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / DAY));
}
