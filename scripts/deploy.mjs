#!/usr/bin/env node
// Deploy otomatis, dijalankan oleh GitHub Actions (.github/workflows/deploy.yml).
// Membuat D1/KV/Queue/Vectorize bila belum ada, mengisi wrangler.jsonc, migrasi, deploy,
// memasang secret, lalu menyambungkan webhook Telegram. Aman dijalankan berulang kali.

import { spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const env = process.env;
const log = (s) => console.log(s);
const ok = (s) => log(`✓ ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = [];

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## ❌ Deploy gagal\n\n${msg}\n`);
  process.exit(1);
}

const WRANGLER = existsSync('node_modules/.bin/wrangler') ? 'node_modules/.bin/wrangler' : 'npx';
function wr(args, { echo = false } = {}) {
  const full = WRANGLER === 'npx' ? ['--yes', 'wrangler', ...args] : args;
  const r = spawnSync(WRANGLER, full, { encoding: 'utf8', env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: 'true' } });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (echo) log(out);
  return { code: r.status ?? 1, out };
}

function jsonArray(text) {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e < s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

async function tg(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---------- 0. Cek input ----------
const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'TELEGRAM_BOT_TOKEN'].filter((k) => !env[k]);
if (missing.length) fail(`Secret GitHub belum diisi: ${missing.join(', ')}.\nRepo → Settings → Secrets and variables → Actions → New repository secret.`);

const appName = (env.APP_NAME || 'asisten-ai').trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/.test(appName)) fail(`APP_NAME "${appName}" tidak valid. Pakai huruf kecil, angka, dan tanda - (4-40 karakter).`);
const tz = ['7', '8', '9'].includes(String(env.TIMEZONE_OFFSET || '').trim()) ? String(env.TIMEZONE_OFFSET).trim() : '7';

const me = await tg('getMe').catch(() => ({ ok: false }));
if (!me.ok) fail('TELEGRAM_BOT_TOKEN tidak valid. Salin ulang dari @BotFather.');
ok(`Bot Telegram @${me.result.username}`);

// ---------- 1. Sumber daya Cloudflare ----------
const names = { db: `${appName}-db`, kv: `${appName}-kv`, queue: `${appName}-jobs`, index: `${appName}-memory` };

const findD1 = () => (jsonArray(wr(['d1', 'list', '--json']).out) || []).find((d) => d.name === names.db)?.uuid;
let d1Id = findD1();
if (!d1Id) {
  const r = wr(['d1', 'create', names.db], { echo: true });
  d1Id = findD1() || (r.out.match(/database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/) || [])[1];
}
if (!d1Id) fail('Gagal membuat/menemukan database D1. Pastikan API token punya izin "D1: Edit".');
ok(`D1 ${names.db}`);

const findKv = () => (jsonArray(wr(['kv', 'namespace', 'list']).out) || [])
  .find((n) => n.title === names.kv || n.title.endsWith(`-${names.kv}`))?.id;
let kvId = findKv();
if (!kvId) {
  const r = wr(['kv', 'namespace', 'create', names.kv], { echo: true });
  kvId = findKv() || (r.out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/) || [])[1];
}
if (!kvId) fail('Gagal membuat/menemukan KV namespace. Pastikan API token punya izin "Workers KV Storage: Edit".');
ok(`KV ${names.kv}`);

{
  const r = wr(['queues', 'create', names.queue]);
  if (r.code !== 0 && !wr(['queues', 'list']).out.includes(names.queue)) {
    fail(`Gagal membuat Queue. Pastikan API token punya izin "Queues: Edit" dan email akun Cloudflare sudah terverifikasi.\n${r.out}`);
  }
  ok(`Queue ${names.queue}`);
}
{
  const r = wr(['vectorize', 'create', names.index, '--dimensions=1024', '--metric=cosine']);
  if (r.code !== 0 && !wr(['vectorize', 'list', '--json']).out.includes(names.index)) {
    fail(`Gagal membuat Vectorize. Pastikan API token punya izin "Vectorize: Edit".\n${r.out}`);
  }
  ok(`Vectorize ${names.index}`);
}

// ---------- 2. wrangler.jsonc ----------
const vars = {
  APP_NAME: appName,
  OWNER_NAME: env.OWNER_NAME || 'Bos',
  OWNER_USERNAME: (env.OWNER_USERNAME || '').replace(/^@/, ''),
  OWNER_CHAT_ID: env.OWNER_CHAT_ID || '',
  TIMEZONE_OFFSET: tz,
  MODEL_FAST: env.MODEL_FAST || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  MODEL_SMART: env.MODEL_SMART || 'claude-opus-5-5',
  MODEL_VISION: env.MODEL_VISION || '@cf/llava-hf/llava-1.5-7b-hf',
  ...(env.PUBLIC_URL ? { PUBLIC_URL: env.PUBLIC_URL.replace(/\/+$/, '') } : {}),
};
const config = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: appName,
  main: 'src/index.js',
  compatibility_date: '2025-09-01',
  compatibility_flags: ['nodejs_compat'],
  account_id: env.CLOUDFLARE_ACCOUNT_ID,
  workers_dev: true,
  observability: { enabled: true },
  assets: { directory: './public', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: true },
  ai: { binding: 'AI' },
  d1_databases: [{ binding: 'DB', database_name: names.db, database_id: d1Id, migrations_dir: 'migrations' }],
  kv_namespaces: [{ binding: 'KV', id: kvId }],
  vectorize: [{ binding: 'VECTORIZE', index_name: names.index }],
  queues: {
    producers: [{ binding: 'QUEUE', queue: names.queue }],
    consumers: [{ queue: names.queue, max_batch_size: 1, max_batch_timeout: 1, max_retries: 2 }],
  },
  triggers: { crons: ['* * * * *'] },
  vars,
};
writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2));
ok('wrangler.jsonc diisi');

// ---------- 3. Migrasi & deploy ----------
{
  const r = wr(['d1', 'migrations', 'apply', 'DB', '--remote'], { echo: true });
  if (r.code !== 0) fail('Migrasi database gagal (lihat log di atas).');
  ok('Tabel database siap');
}

let url = '';
{
  const r = wr(['deploy'], { echo: true });
  if (r.code !== 0) {
    const hint = /workers\.dev subdomain|register a workers\.dev|onboarding/i.test(r.out)
      ? '\nAkun Cloudflare baru belum punya subdomain workers.dev. Buka dash.cloudflare.com → Workers & Pages sekali (isi nama subdomain), lalu jalankan ulang workflow.'
      : '';
    fail(`Deploy gagal.${hint}`);
  }
  url = (r.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0] || env.PUBLIC_URL || '';
  if (!url) fail('Deploy berhasil tapi alamat workers.dev tidak ditemukan. Isi variabel PUBLIC_URL di GitHub lalu jalankan ulang.');
  url = url.replace(/\/+$/, '');
  ok(`Website: ${url}`);
}

// ---------- 4. Secret ----------
{
  let existing = jsonArray(wr(['secret', 'list', '--format', 'json']).out);
  if (!existing) existing = jsonArray(wr(['secret', 'list']).out) || [];
  const have = new Set(existing.map((s) => s.name));
  const secrets = { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN };
  if (!have.has('SESSION_SECRET')) secrets.SESSION_SECRET = randomBytes(48).toString('base64url');
  for (const k of ['ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) if (env[k]) secrets[k] = env[k];
  const tmp = `.secrets-${Date.now()}.json`;
  writeFileSync(tmp, JSON.stringify(secrets));
  const r = wr(['secret', 'bulk', tmp]);
  unlinkSync(tmp);
  if (r.code !== 0) fail(`Gagal memasang secret:\n${r.out.replace(/[A-Za-z0-9_-]{30,}/g, '***')}`);
  ok(`Secret: ${Object.keys(secrets).join(', ')}`);
}

// ---------- 5. Webhook Telegram ----------
const hookSecret = createHash('sha256').update(`${env.TELEGRAM_BOT_TOKEN}:webhook`).digest('base64url').slice(0, 40);
let hook = null;
for (let i = 0; i < 12 && !hook?.ok; i++) {
  try {
    const res = await fetch(`${url}/setup?secret=${encodeURIComponent(hookSecret)}`);
    hook = await res.json();
  } catch {}
  if (!hook?.ok) {
    if (i === 0) log('Menunggu subdomain aktif (bisa 1-2 menit)…');
    await sleep(10000);
  }
}
if (hook?.ok) ok(`Webhook Telegram terpasang (pemilik: ${hook.owner})`);
else log(`! Webhook belum terpasang: ${JSON.stringify(hook)}. Jalankan ulang workflow beberapa menit lagi.`);

// ---------- 6. Ringkasan ----------
const ownerLine = vars.OWNER_CHAT_ID
  ? `Pemilik: chat ID ${vars.OWNER_CHAT_ID}`
  : vars.OWNER_USERNAME
    ? `Pemilik: @${vars.OWNER_USERNAME} — kirim pesan apa saja ke bot untuk mengklaim.`
    : '⚠️ OWNER_USERNAME belum diisi. Bot akan membalas "Chat ID kamu: …" sampai variabel itu diisi.';
summary.push(
  `## ✅ ${appName} sudah online`,
  '',
  '| | |',
  '|---|---|',
  `| Website admin | ${url} |`,
  `| Bot Telegram | https://t.me/${me.result.username} |`,
  `| Konektor Claude (MCP) | ${url}/mcp |`,
  `| Otak AI | Workers AI \`${vars.MODEL_FAST}\`${env.ANTHROPIC_API_KEY ? ` + Claude \`${vars.MODEL_SMART}\` untuk pekerjaan berat` : ' (Claude Opus belum aktif)'} |`,
  '',
  ownerLine,
  '',
  'Langkah berikutnya: kirim `/start` lalu `/profil` ke bot, lalu buka website dan klik **Kirim kode ke Telegram**.',
);
log('\n' + summary.join('\n'));
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
