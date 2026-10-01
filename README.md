# 🧠 Asisten AI & Second Brain

Asisten pribadi yang jalan di akun Cloudflare-mu sendiri (paket gratis cukup untuk satu orang).

| Fitur | Isi |
|---|---|
| **Bot Telegram** | Catat tugas dari chat, voice note, foto, atau pesan terusan. Pengingat tepat waktu dengan tombol ✅ / +1 jam / besok. Briefing pagi 07:00 & rekap malam 21:00. |
| **Website admin** | Dashboard, Tugas, Catatan, Chat AI, Profil & Memori, Kantor 3D, Riset Kompetitor, Sistem. Login pakai kode Telegram, tanpa password. |
| **Tim agen AI + Kantor 3D** | CEO, Manajer Operasional (+ Admin, Analis Data), Manajer Marketing (+ Riset Kompetitor, Copywriter, Content Planner). Mereka berjalan ke meja rapat, meja kerja, dan meja CEO sesuai pekerjaan aslinya. |
| **Memori jangka panjang** | Fakta penting dari obrolan diingat otomatis dan dicari berdasarkan makna (Workers AI embeddings + Vectorize). |
| **Riset Kompetitor** | Bookmarklet "Kirim ke Second Brain" untuk Meta Ad Library: gambar & video, lama tayang, urutan impresi, skor, bedah iklan, dan "Bikin 5 konten mirip". Media iklan pemenang disalin permanen. |
| **Konektor Claude (MCP)** | Claude di claude.ai / desktop bisa membaca & menulis tugas, catatan, memori, riset kompetitor, dan memerintah tim. |
| **Gmail & Drive** (opsional) | Email belum dibaca masuk briefing pagi; asisten bisa mencari email & file Drive. |

## Otak AI

- **Workers AI (gratis)** — dipakai untuk hampir semua hal: memahami pesan, membuat tugas/catatan, memori, briefing, rencana CEO, kerja tim biasa, penilaian iklan. Default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- **Claude Opus (`claude-opus-5-5`)** — hanya untuk pekerjaan berat: menulis konten, bedah iklan, "Bikin 5 konten mirip", membaca foto, dan tugas tim yang ditandai berat. Butuh `ANTHROPIC_API_KEY` (berbayar). Kalau kunci tidak ada atau panggilan gagal, otomatis kembali ke Workers AI. Permintaan Opus memakai *server-side fallback* Anthropic (`fallbacks: "default"`) supaya penolakan filter keamanan dialihkan ke model cadangan.

Kantor 3D menampilkan model yang sedang dipakai tiap agen (Llama / Claude Opus).

## Pemasangan lewat GitHub → Cloudflare (±30 menit, tanpa install apa pun di laptop)

Aplikasi berjalan di server Cloudflare. GitHub menyimpan kodenya, dan setiap kali kode di branch `main` berubah, GitHub Actions otomatis membuat database & penyimpanan, deploy, lalu menyambungkan bot Telegram.

### 1. Siapkan akun

| Kebutuhan | Cara dapat |
|---|---|
| Akun Cloudflare (Free) | [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). **Verifikasi email**, lalu buka menu **Workers & Pages** sekali supaya subdomain `….workers.dev` dibuat. |
| Bot Telegram | Chat [@BotFather](https://t.me/BotFather) → `/newbot` → simpan token-nya. |
| Akun GitHub | [github.com/signup](https://github.com/signup) |
| Username Telegram | Telegram → Settings → Username. Dipakai supaya bot hanya melayani kamu. |
| API key Anthropic (opsional) | [console.anthropic.com](https://console.anthropic.com) — untuk Claude Opus pada pekerjaan berat. |

### 2. Buat API token Cloudflare

1. Cloudflare → ikon profil → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permissions (semua jenis **Account**):
   - Workers Scripts — Edit
   - Workers KV Storage — Edit
   - D1 — Edit
   - Queues — Edit
   - Vectorize — Edit
   - Workers AI — Read
   - Account Settings — Read
3. Account Resources: akunmu. **Continue → Create Token**, salin token-nya (hanya ditampilkan sekali).
4. Salin juga **Account ID**: Cloudflare → Workers & Pages → kolom kanan.

### 3. Taruh kode di GitHub

1. GitHub → **New repository** → nama bebas (mis. `asisten-ai`) → pilih **Private** → Create.
2. **Add file → Upload files** → seret semua isi folder proyek ini → **Commit changes**.
   - Folder `.github` tersembunyi di Finder. Tekan **⌘ + Shift + .** di Finder supaya terlihat, lalu ikut seret.
   - Kalau `.github` tetap tidak terunggah: **Add file → Create new file**, beri nama `.github/workflows/deploy.yml`, tempel isi file itu dari proyek ini, lalu Commit.

### 4. Isi Secrets & Variables di GitHub

Repo → **Settings → Secrets and variables → Actions**.

Tab **Secrets** → *New repository secret*:

| Nama | Isi | |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | token dari langkah 2 | wajib |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID dari langkah 2 | wajib |
| `TELEGRAM_BOT_TOKEN` | token dari @BotFather | wajib |
| `ANTHROPIC_API_KEY` | API key Anthropic | opsional |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | lihat bagian Gmail & Drive | opsional |

Tab **Variables** → *New repository variable*:

| Nama | Isi | |
|---|---|---|
| `OWNER_USERNAME` | username Telegram-mu tanpa `@` | wajib* |
| `OWNER_NAME` | nama panggilanmu, mis. `Dayat` | disarankan |
| `TIMEZONE_OFFSET` | `7` (WIB), `8` (WITA), atau `9` (WIT) | default 7 |
| `APP_NAME` | nama aplikasi/subdomain, mis. `asisten-dayat` | default `asisten-ai` |
| `OWNER_CHAT_ID` | chat ID Telegram | *pengganti `OWNER_USERNAME` kalau kamu tidak punya username |
| `MODEL_FAST`, `MODEL_SMART` | ganti model AI | opsional |

### 5. Jalankan deploy

Repo → tab **Actions** → (klik *I understand… enable* kalau diminta) → **Deploy ke Cloudflare** → **Run workflow**.

Tunggu ±3 menit. Buka run yang selesai: ringkasannya berisi alamat website, link bot, dan URL konektor Claude. Selanjutnya, setiap perubahan kode di `main` otomatis di-deploy ulang. Mengubah Secrets/Variables? Jalankan ulang workflow ini.

Kunci rahasia sesi (`SESSION_SECRET`) dibuat otomatis sekali di Cloudflare; rahasia webhook Telegram diturunkan dari token bot, jadi tidak ada kunci tambahan yang perlu kamu simpan.

## Pakai pertama kali

- **Telegram:** kirim `/start` ke bot. Karena username-mu cocok dengan `OWNER_USERNAME`, kamu langsung tercatat sebagai pemilik. Lalu `/profil` (wawancara 7 pertanyaan).
- **Website admin:** buka alamat dari ringkasan deploy → *Kirim kode ke Telegram* → masukkan kodenya.
- **Kantor 3D:** tulis perintah di kotak bawah panggung, mis. "Buat strategi promo 11.11 untuk produk terlaris". Laporan akhir dikirim ke Telegram dan disimpan di Catatan.
- **Riset Kompetitor:** menu Riset Kompetitor → *Cara scan* → seret tombol *Kirim ke Second Brain* ke bookmark bar Chrome. Buka [Meta Ad Library](https://www.facebook.com/ads/library/), cari kata kunci, urutkan *Impressions: high to low*, scroll, lalu klik bookmark itu.
- **Konektor Claude:** claude.ai → Settings → Connectors → Add custom connector → `https://<alamat-website>/mcp` → Connect → masuk dengan kode Telegram → Izinkan.

### Perintah bot

`/tugas` `/selesai 12` `/catatan` `/cari kata` `/ingat fakta` `/memori` `/kantor perintah` `/briefing` `/rekap` `/web` `/profil` `/batal`

Atau tulis bebas: "besok jam 9 telpon Pak Budi", "ingatkan aku 30 menit lagi angkat jemuran", "sudah kirim invoice", "apa target bulan ini?", "buatkan 3 caption IG untuk promo gajian".

## Opsional

### Gmail & Google Drive

1. [console.cloud.google.com](https://console.cloud.google.com) → buat project → APIs & Services → Library → aktifkan **Gmail API** dan **Google Drive API**.
2. Google Auth Platform → **Branding**: isi nama app & email. **Audience**: External, tambahkan emailmu sebagai test user, lalu **Publish app**.
3. Clients → Create client → Web application → Authorized redirect URI: `https://<alamat-website>/api/google/callback`
4. Simpan Client ID & Client Secret sebagai GitHub Secrets `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET`, lalu jalankan ulang workflow Deploy.

Lalu di website: Sistem → Hubungkan Google. Layar "Google hasn't verified this app" wajar untuk app pribadi: pilih Advanced → Go to ….

### Ganti model AI

Isi Variables `MODEL_FAST` (mis. `@cf/google/gemma-3-12b-it` yang lebih hemat jatah) atau `MODEL_SMART`, lalu jalankan ulang workflow.

### Memperbarui kode

Ubah/unggah file di GitHub (branch `main`). Workflow otomatis menjalankan migrasi database dan deploy ulang. Data tidak hilang.

## Batas paket gratis Cloudflare

| Layanan | Batas gratis | Dipakai untuk |
|---|---|---|
| Workers | 100.000 request/hari | Bot, website, konektor, cron tiap menit |
| Workers AI | 10.000 neuron/hari | Otak utama, voice note, foto (tanpa Opus), memori, penilaian iklan |
| D1 | 5 GB, 100.000 tulis/hari | Semua data |
| KV | 1 GB, 1.000 tulis/hari | Media iklan pemenang, kode login, klien konektor |
| Queues | 10.000 operasi/hari | Pemrosesan pesan & kerja tim |
| Vectorize | ±5 juta dimensi tersimpan | Pencarian makna (±4.800 catatan + memori) |

Kalau jatah Workers AI harian habis, balasan bot akan gagal sampai jatah reset (00:00 UTC). Model yang lebih kecil (mis. Gemma) memakai neuron lebih sedikit.

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Workflow gagal | Buka run di tab Actions; pesan error di akhir log menjelaskan penyebabnya (biasanya izin API token kurang atau secret belum diisi). Perbaiki lalu **Re-run jobs**. |
| Deploy gagal soal "workers.dev subdomain" | Buka Cloudflare → Workers & Pages sekali untuk membuat subdomain, lalu jalankan ulang workflow. |
| Bot tidak membalas | Jalankan ulang workflow (langkah terakhirnya memasang webhook). Subdomain baru kadang butuh 1–2 menit. Cek juga Sistem → Telegram di website. |
| Bot membalas "Bot ini belum punya pemilik" | `OWNER_USERNAME` kosong atau tidak cocok dengan username Telegram-mu. Perbaiki Variable-nya, lalu jalankan ulang workflow. |
| Kode login website tidak masuk | Pastikan bot sudah di-`/start` dari akun pemilik. Kode berlaku 5 menit, bisa diminta lagi setelah 60 detik. |
| "Otak AI sedang bermasalah" | Biasanya jatah Workers AI harian habis atau gangguan sementara. Lihat log: Cloudflare → Workers & Pages → aplikasimu → Logs. |
| Gagal di Vectorize/Queue | Pastikan email akun Cloudflare sudah terverifikasi dan API token punya izin Queues & Vectorize, lalu jalankan ulang workflow. |
| Error "exceeded CPU" di log | Paket gratis membatasi CPU 10 ms per permintaan. Kalau sering terjadi (mis. scan ratusan iklan sekaligus), upgrade ke Workers Paid (US$5/bulan). |
| Bookmarklet tidak menemukan iklan | Tunggu halaman Ad Library selesai memuat dan scroll sampai kartu iklan muncul. Facebook kadang mengubah tampilan; laporkan agar pola pembacanya diperbarui (`adLibraryScanner` di `public/app.js`). |
| Gambar iklan kompetitor kosong | Link media Facebook kedaluwarsa dalam beberapa hari. Scan ulang; iklan pemenang disalin permanen otomatis. |

## Keamanan & privasi

- Setiap salinan terpisah total: database, bot, dan login milikmu sendiri.
- Bot hanya melayani chat ID pemilik; pesan dari orang lain diabaikan.
- Pakai repo GitHub **Private**: log Actions pada repo publik bisa dilihat orang lain (secret tetap disamarkan, tapi alamat aplikasimu terlihat).
- Jangan menaruh token di dalam file kode; selalu lewat GitHub Secrets.
- Token bot bocor? @BotFather → `/revoke`, perbarui Secret `TELEGRAM_BOT_TOKEN`, lalu jalankan ulang workflow.
- Mau mengeluarkan semua sesi website & konektor Claude? Hapus secret `SESSION_SECRET` di Cloudflare (Workers & Pages → aplikasimu → Settings → Variables and Secrets) lalu jalankan ulang workflow; yang baru dibuat otomatis.

## Struktur kode

```
src/index.js        router HTTP, consumer antrean, cron
src/telegram.js     webhook & perintah bot          src/brain.js     pemahaman pesan → aksi
src/ai.js           Workers AI + Claude Opus        src/memory.js    memori & pencarian makna
src/store.js        tugas, catatan, profil          src/cron.js      pengingat, briefing, rekap
src/agents.js       tim agen AI                     src/competitor.js riset iklan kompetitor
src/auth.js         login kode Telegram             src/oauth.js + mcp.js  konektor Claude
src/google.js       Gmail & Drive                   src/api.js       REST untuk website
src/owner.js        pemilik bot & rahasia webhook
public/             website admin, Kantor 3D (Three.js), penerima bookmarklet
scripts/deploy.mjs  deploy otomatis (dijalankan GitHub Actions)
.github/workflows/deploy.yml
```
