import { scrapeAdLibrary } from '/scanner-core.js';

// Website admin Second Brain (tanpa framework). Rute memakai hash: #/tugas, #/kantor, dst.

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let ME = null;
let cleanup = [];

// ---------- Utilitas ----------

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    showLogin();
    throw new Error('Belum login');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
  return data;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

// Markdown sederhana dan aman (input di-escape dulu).
function md(src = '') {
  const lines = esc(src).split('\n');
  let out = '';
  let list = null;
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); out += `<h3>${inline(m[2])}</h3>`; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); out += '<hr>'; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^&gt;\s?(.*)/))) { closeList(); out += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    closeList();
    if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  closeList();
  return out;
}

function onCleanup(fn) { cleanup.push(fn); }
function every(ms, fn) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  onCleanup(() => clearInterval(id));
}

function dialog(html, { onOpen } = {}) {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.showModal();
  onOpen?.(d);
  return d;
}

// ---------- Login ----------

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

function setupLogin() {
  const msg = $('#login-msg');
  $('#send-code').onclick = async () => {
    const btn = $('#send-code');
    btn.disabled = true;
    try {
      const r = await api('/api/auth/request', { method: 'POST' });
      $('#code-form').hidden = false;
      $('#code-input').focus();
      msg.className = 'msg ok';
      msg.textContent = r.sent ? 'Kode sudah dikirim ke Telegram.' : 'Kode dibuat, tapi gagal dikirim ke Telegram. Cek token bot & chat ID.';
      if (r.devCode) msg.textContent += ` (mode dev: ${r.devCode})`;
      setTimeout(() => (btn.disabled = false), 60000);
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
  $('#code-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/verify', { method: 'POST', body: { code: $('#code-input').value } });
      msg.textContent = '';
      start();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  };
}

// ---------- Router ----------

const routes = {
  '': dashboard,
  tugas: tasksView,
  catatan: notesView,
  chat: chatView,
  profil: profileView,
  kantor: officeView,
  riset: researchView,
  sistem: systemView,
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { route: path.split('/')[0], params: new URLSearchParams(query) };
}

async function render() {
  cleanup.forEach((fn) => { try { fn(); } catch {} });
  cleanup = [];
  const { route, params } = parseHash();
  const fn = routes[route] || dashboard;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  view.classList.toggle('wide', route === 'kantor');
  view.innerHTML = '<p class="muted">Memuat…</p>';
  try {
    await fn(params);
  } catch (e) {
    if (e.message !== 'Belum login') view.innerHTML = `<div class="card"><p>Gagal memuat: ${esc(e.message)}</p></div>`;
  }
}

async function start() {
  const status = await api('/api/auth/status');
  $('#login-title').textContent = status.app || 'Second Brain';
  if (!status.loggedIn) return showLogin();
  ME = await api('/api/me');
  document.title = ME.app;
  $('#who').textContent = ME.owner;
  $('#login').hidden = true;
  $('#app').hidden = false;
  render();
}

window.addEventListener('hashchange', render);
$('#logout').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  showLogin();
};
setupLogin();
start().catch(() => showLogin());

// ---------- Dashboard ----------

function taskRow(t, { compact = false } = {}) {
  const overdue = t.status === 'todo' && t.due_at && t.due_at < Date.now();
  return `<li class="${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <input type="checkbox" class="check" ${t.status === 'done' ? 'checked' : ''} aria-label="Tandai selesai">
    <div class="main">
      <div class="title">${esc(t.title)}</div>
      <div class="meta">
        <span class="mono">#${t.id}</span>
        ${t.due_local ? `<span class="chip ${overdue ? 'danger' : 'accent'}">${overdue ? 'lewat · ' : ''}${esc(t.due_local)}</span>` : ''}
        ${t.remind_local && t.remind_local !== t.due_local ? `<span class="chip">⏰ ${esc(t.remind_local)}</span>` : ''}
        ${t.priority === 'high' ? '<span class="chip warn">penting</span>' : ''}
        ${!compact && t.source !== 'web' ? `<span class="chip">${esc(t.source)}</span>` : ''}
      </div>
    </div>
    ${compact ? '' : '<button class="btn ghost small edit">Ubah</button>'}
  </li>`;
}

function bindTaskList(root, reload) {
  root.querySelectorAll('li[data-id]').forEach((li) => {
    const id = li.dataset.id;
    li.querySelector('.check').onchange = async (e) => {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: { status: e.target.checked ? 'done' : 'todo' } });
      toast(e.target.checked ? 'Selesai ✅' : 'Dibuka lagi');
      reload();
    };
    li.querySelector('.edit')?.addEventListener('click', () => editTask(id, reload));
  });
}

async function dashboard() {
  const d = await api('/api/dashboard');
  const s = d.stats;
  view.innerHTML = `
    <div class="page-head"><div><h1>Halo, ${esc(ME.owner || 'Bos')} 👋</h1><p class="muted">${esc(d.now)}</p></div>
      <a class="btn primary" href="#/tugas?new=1">+ Tugas</a></div>
    <div class="stats">
      <div class="stat"><div class="n">${s.today}</div><div class="l">Tenggat hari ini</div></div>
      <div class="stat ${s.overdue ? 'alert' : ''}"><div class="n">${s.overdue}</div><div class="l">Terlewat</div></div>
      <div class="stat"><div class="n">${s.open}</div><div class="l">Tugas aktif</div></div>
      <div class="stat"><div class="n">${s.done_today}</div><div class="l">Selesai hari ini</div></div>
      <div class="stat"><div class="n">${s.notes}</div><div class="l">Catatan</div></div>
      <div class="stat"><div class="n">${s.memories}</div><div class="l">Memori</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">Tugas berikutnya</h2><a href="#/tugas" class="small">Semua</a></div>
        ${d.upcoming.length ? `<ul class="list" id="dash-tasks">${d.upcoming.map((t) => taskRow(t, { compact: true })).join('')}</ul>` : '<p class="empty">Tidak ada tugas aktif 🎉</p>'}
      </div>
      <div>
        <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">Catatan terbaru</h2><a href="#/catatan" class="small">Semua</a></div>
          ${d.notes.length ? `<ul class="list">${d.notes.map((n) => `<li><div class="main"><a class="title" href="#/catatan?id=${n.id}">${esc(n.title)}</a><div class="meta">${n.tags ? `<span class="chip">${esc(n.tags)}</span>` : ''}<span>${timeAgo(n.updated_at)}</span></div></div></li>`).join('')}</ul>` : '<p class="empty">Belum ada catatan.</p>'}
        </div>
        <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">Kerja tim AI</h2><a href="#/kantor" class="small">Kantor 3D</a></div>
          ${d.runs.length ? `<ul class="list">${d.runs.map((r) => `<li><div class="main"><div class="title">${esc(r.command)}</div><div class="meta"><span class="chip ${r.status === 'done' ? 'accent' : r.status === 'failed' ? 'danger' : 'warn'}">${esc(r.status)}</span><span>${timeAgo(r.created_at)}</span></div></div></li>`).join('')}</ul>` : '<p class="empty">Belum ada perintah ke tim.</p>'}
        </div>
      </div>
    </div>`;
  const list = $('#dash-tasks');
  if (list) bindTaskList(list, dashboard);
}

// ---------- Tugas ----------

async function tasksView(params) {
  let status = params.get('status') || 'todo';
  view.innerHTML = `
    <div class="page-head"><div><h1>Tugas</h1><p class="muted">Pengingat dikirim ke Telegram tepat waktu.</p></div></div>
    <form id="quick" class="card stack" style="margin:0 0 16px">
      <div class="row">
        <input class="grow" name="title" placeholder="Tugas baru… mis. Kirim penawaran ke Bu Rina" required>
        <input name="due" type="datetime-local" style="width:auto" aria-label="Tenggat">
        <select name="priority" style="width:auto" aria-label="Prioritas"><option value="normal">Normal</option><option value="high">Penting</option><option value="low">Rendah</option></select>
        <button class="btn primary">Tambah</button>
      </div>
    </form>
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <div class="tabs" id="status-tabs">
        <button data-s="todo">Aktif</button><button data-s="done">Selesai</button><button data-s="all">Semua</button>
      </div>
      <input id="task-q" placeholder="Cari tugas…" style="max-width:260px">
    </div>
    <div class="card"><ul class="list" id="task-list"></ul></div>`;
  const listEl = $('#task-list');
  const load = async () => {
    document.querySelectorAll('#status-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.s === status));
    const q = $('#task-q').value.trim();
    const { tasks } = await api(`/api/tasks?status=${status}&q=${encodeURIComponent(q)}`);
    listEl.innerHTML = tasks.length ? tasks.map((t) => taskRow(t)).join('') : '<li class="empty" style="display:block">Tidak ada tugas.</li>';
    bindTaskList(listEl, load);
  };
  document.querySelectorAll('#status-tabs button').forEach((b) => (b.onclick = () => { status = b.dataset.s; load(); }));
  let qTimer;
  $('#task-q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(load, 250); };
  $('#quick').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api('/api/tasks', { method: 'POST', body: { title: f.get('title'), due: f.get('due') ? f.get('due').replace('T', ' ') : null, priority: f.get('priority') } });
    e.target.reset();
    toast('Tugas ditambahkan');
    load();
  };
  if (params.get('new')) $('#quick input[name=title]').focus();
  await load();
}

async function editTask(id, reload) {
  const { tasks } = await api(`/api/tasks?status=all&limit=500`);
  const t = tasks.find((x) => String(x.id) === String(id));
  if (!t) return;
  const d = dialog(`
    <form method="dialog" class="dlg-body" id="tf">
      <h2>Ubah tugas #${t.id}</h2>
      <div><label class="label">Judul</label><input name="title" value="${esc(t.title)}" required></div>
      <div class="row">
        <div class="grow"><label class="label">Tenggat</label><input name="due" type="datetime-local" value="${esc((t.due_local || '').replace(' ', 'T'))}"></div>
        <div class="grow"><label class="label">Pengingat</label><input name="remind" type="datetime-local" value="${esc((t.remind_local || '').replace(' ', 'T'))}"></div>
        <div><label class="label">Prioritas</label><select name="priority">${['normal', 'high', 'low'].map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${{ normal: 'Normal', high: 'Penting', low: 'Rendah' }[p]}</option>`).join('')}</select></div>
      </div>
      <div><label class="label">Catatan</label><textarea name="notes">${esc(t.notes)}</textarea></div>
    </form>
    <div class="dlg-foot"><button class="btn danger" id="del">Hapus</button><div class="row"><button class="btn" id="cancel">Batal</button><button class="btn primary" id="save">Simpan</button></div></div>`);
  $('#cancel', d).onclick = () => d.close();
  $('#del', d).onclick = async () => {
    if (!confirm('Hapus tugas ini?')) return;
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    d.close();
    toast('Tugas dihapus');
    reload();
  };
  $('#save', d).onclick = async () => {
    const f = new FormData($('#tf', d));
    await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: {
        title: f.get('title'), notes: f.get('notes'), priority: f.get('priority'),
        due: f.get('due') ? f.get('due').replace('T', ' ') : null,
        remind: f.get('remind') ? f.get('remind').replace('T', ' ') : null,
      },
    });
    d.close();
    toast('Tersimpan');
    reload();
  };
}

// ---------- Catatan ----------

async function notesView(params) {
  view.innerHTML = `
    <div class="page-head"><div><h1>Catatan</h1><p class="muted">Semua catatan bisa dicari berdasarkan makna, bukan cuma kata yang sama persis.</p></div>
      <button class="btn primary" id="new-note">+ Catatan</button></div>
    <div class="row" style="margin-bottom:14px">
      <input class="grow" id="note-q" placeholder="Cari… mis. 'ide promo akhir tahun'">
      <label class="row small muted" style="gap:6px"><input type="checkbox" id="semantic" checked style="width:auto"> Cari makna</label>
    </div>
    <div class="note-grid" id="notes"></div>`;
  const load = async () => {
    const q = $('#note-q').value.trim();
    const { notes } = await api(`/api/notes?q=${encodeURIComponent(q)}&semantic=${$('#semantic').checked && q ? 1 : 0}`);
    $('#notes').innerHTML = notes.length ? notes.map((n) => `
      <button class="note-card" data-id="${n.id}">
        <strong>${esc(n.title)}</strong>
        <span class="excerpt">${esc(n.content.slice(0, 400))}</span>
        <span class="meta row small muted" style="margin-top:auto">${n.tags ? `<span class="chip">${esc(n.tags)}</span>` : ''}<span>${timeAgo(n.updated_at)}</span>${n.score ? `<span class="chip accent">${Math.round(n.score * 100)}% cocok</span>` : ''}</span>
      </button>`).join('') : '<p class="empty">Tidak ada catatan.</p>';
    document.querySelectorAll('.note-card').forEach((c) => (c.onclick = () => openNote(c.dataset.id, load)));
  };
  let t;
  $('#note-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
  $('#semantic').onchange = load;
  $('#new-note').onclick = () => openNote(null, load);
  await load();
  if (params.get('id')) openNote(params.get('id'), load);
}

async function openNote(id, reload) {
  const n = id ? (await api(`/api/notes/${id}`)).note : { title: '', content: '', tags: '' };
  const d = dialog(`
    <div class="dlg-body">
      <div class="row" style="justify-content:space-between"><h2>${id ? 'Catatan #' + id : 'Catatan baru'}</h2>${id ? '<div class="tabs"><button id="m-read" class="on">Baca</button><button id="m-edit">Ubah</button></div>' : ''}</div>
      <div id="read" class="md" ${id ? '' : 'hidden'}>${md(n.content)}</div>
      <form id="nf" class="stack" style="margin:0" ${id ? 'hidden' : ''}>
        <div><label class="label">Judul</label><input name="title" value="${esc(n.title)}"></div>
        <div><label class="label">Isi</label><textarea name="content" rows="12">${esc(n.content)}</textarea></div>
        <div><label class="label">Tag (pisahkan koma)</label><input name="tags" value="${esc(n.tags)}"></div>
      </form>
    </div>
    <div class="dlg-foot">${id ? '<button class="btn danger" id="del">Hapus</button>' : '<span></span>'}<div class="row"><button class="btn" id="close">Tutup</button><button class="btn primary" id="save" ${id ? 'hidden' : ''}>Simpan</button></div></div>`);
  const mode = (edit) => {
    $('#read', d).hidden = edit;
    $('#nf', d).hidden = !edit;
    $('#save', d).hidden = !edit;
    $('#m-read', d)?.classList.toggle('on', !edit);
    $('#m-edit', d)?.classList.toggle('on', edit);
  };
  if (id) {
    $('#m-read', d).onclick = () => mode(false);
    $('#m-edit', d).onclick = () => mode(true);
    $('#del', d).onclick = async () => {
      if (!confirm('Hapus catatan ini?')) return;
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      d.close();
      toast('Catatan dihapus');
      reload();
    };
  }
  $('#close', d).onclick = () => d.close();
  $('#save', d).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#nf', d)));
    if (id) await api(`/api/notes/${id}`, { method: 'PATCH', body: f });
    else await api('/api/notes', { method: 'POST', body: f });
    d.close();
    toast('Tersimpan');
    reload();
  };
}

// ---------- Chat ----------

async function chatView() {
  view.innerHTML = `
    <div class="page-head"><div><h1>Chat AI</h1><p class="muted">Otak yang sama dengan bot Telegram: bisa membuat tugas, catatan, memori, dan memerintah tim.</p></div>
      <button class="btn small" id="clear">Bersihkan riwayat</button></div>
    <div class="chat card">
      <div class="chat-log" id="log"></div>
      <form class="chat-form" id="cf">
        <textarea id="msg" rows="1" placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)" required></textarea>
        <button class="btn primary">Kirim</button>
      </form>
    </div>`;
  const log = $('#log');
  const add = (role, text, cls = '') => {
    const b = document.createElement('div');
    b.className = `bubble ${role} ${cls}`;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };
  const { messages } = await api('/api/chat');
  if (!messages.length) add('assistant', `Halo ${ME.owner || ''}! Mau catat apa hari ini? Contoh: "Jumat jam 2 siang meeting dengan supplier", atau "apa saja tugasku minggu ini?"`);
  messages.forEach((m) => add(m.role, m.content));
  const input = $('#msg');
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#cf').requestSubmit(); } };
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    add('user', text);
    const p = add('assistant', 'Sedang berpikir…', 'pending');
    try {
      const r = await api('/api/chat', { method: 'POST', body: { message: text } });
      p.classList.remove('pending');
      p.textContent = [r.reply, ...(r.lines || [])].join('\n');
    } catch (err) {
      p.textContent = '⚠️ ' + err.message;
    }
    log.scrollTop = log.scrollHeight;
  };
  $('#clear').onclick = async () => {
    if (!confirm('Hapus riwayat chat website? (memori & catatan tetap aman)')) return;
    await api('/api/chat', { method: 'DELETE' });
    chatView();
  };
  input.focus();
}

// ---------- Profil & Memori ----------

async function profileView() {
  const [p, { memories }] = await Promise.all([api('/api/profile'), api('/api/memories')]);
  view.innerHTML = `
    <div class="page-head"><div><h1>Profil &amp; Memori</h1><p class="muted">Semua jawaban dan memori dipakai asisten & tim AI supaya sarannya spesifik untukmu.</p></div></div>
    <div class="grid-2">
      <div>
        <div class="card">
          <h2>Ringkasan profil</h2>
          <textarea id="summary" rows="7" placeholder="Belum ada. Isi wawancara di bawah atau ketik /profil di Telegram.">${esc(p.summary)}</textarea>
          <div class="row" style="margin-top:10px"><button class="btn" id="save-summary">Simpan ringkasan</button></div>
        </div>
        <form class="card stack" id="pf" style="margin-top:16px">
          <h2 style="margin:0">Wawancara</h2>
          ${p.questions.map((q) => `<div><label class="label" for="q-${q.key}">${esc(q.q)}</label><textarea id="q-${q.key}" name="${q.key}" rows="2">${esc(p.answers[q.key] || '')}</textarea></div>`).join('')}
          <button class="btn primary">Simpan &amp; buat ulang ringkasan</button>
        </form>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><h2 style="margin:0">Memori (${memories.length})</h2></div>
        <form class="row" id="mf" style="margin:12px 0">
          <input class="grow" name="content" placeholder="Tambah fakta… mis. Supplier kain: Toko Makmur, Bandung" required>
          <button class="btn">Ingat</button>
        </form>
        <input id="mem-q" placeholder="Saring memori…" style="margin-bottom:6px">
        <ul class="list" id="mems">${memories.map(memRow).join('') || '<li class="empty" style="display:block">Belum ada memori.</li>'}</ul>
      </div>
    </div>`;
  $('#save-summary').onclick = async () => {
    await api('/api/profile', { method: 'PUT', body: { summary: $('#summary').value } });
    toast('Ringkasan disimpan');
  };
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    btn.textContent = 'Merangkum…';
    try {
      const r = await api('/api/profile', { method: 'PUT', body: { answers: Object.fromEntries(new FormData(e.target)), regenerate: true } });
      $('#summary').value = r.summary;
      toast('Profil diperbarui');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan & buat ulang ringkasan';
    }
  };
  $('#mf').onsubmit = async (e) => {
    e.preventDefault();
    await api('/api/memories', { method: 'POST', body: { content: new FormData(e.target).get('content') } });
    toast('Diingat 🧠');
    profileView();
  };
  $('#mem-q').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#mems li[data-id]').forEach((li) => (li.hidden = !li.textContent.toLowerCase().includes(q)));
  };
  bindMems();
}

function memRow(m) {
  return `<li data-id="${m.id}"><div class="main"><div class="title">${esc(m.content)}</div><div class="meta"><span class="chip">${esc(m.category)}</span><span>${esc(m.source)}</span><span>${timeAgo(m.updated_at)}</span></div></div><button class="btn ghost small del" aria-label="Lupakan">Lupakan</button></li>`;
}

function bindMems() {
  document.querySelectorAll('#mems li[data-id]').forEach((li) => {
    li.querySelector('.del').onclick = async () => {
      await api(`/api/memories/${li.dataset.id}`, { method: 'DELETE' });
      li.remove();
      toast('Dilupakan');
    };
  });
}

// ---------- Kantor 3D ----------

async function officeView() {
  view.innerHTML = `
    <div class="page-head"><div><h1>Kantor 3D</h1><p class="muted">Tim AI bergerak sesuai pekerjaan aslinya: rapat di meja tengah, bekerja di meja masing-masing, menyerahkan hasil ke CEO.</p></div></div>
    <div class="office">
      <div>
        <div id="claude-q"></div>
        <div class="office-stage" id="stage"><div class="office-legend" id="legend"></div></div>
        <form class="office-cmd" id="cmd">
          <input class="grow" id="cmd-input" placeholder="Perintah untuk tim… mis. Buat strategi promo 11.11 untuk produk terlaris" required>
          <button class="btn primary">Kirim ke tim</button>
        </form>
      </div>
      <div class="office-side">
        <div class="card"><h2>Tim</h2><div class="agent-list" id="agents"></div></div>
        <div class="card" style="display:flex;flex-direction:column;min-height:0;flex:1"><h2>Aktivitas</h2><div class="feed" id="feed"></div></div>
      </div>
    </div>`;
  let office = null;
  let state = await api('/api/agents/state');
  const statusLabel = { idle: 'santai', thinking: 'berpikir', meeting: 'rapat', working: 'bekerja', delivering: 'menyerahkan hasil' };
  const names = Object.fromEntries(state.roster.map((a) => [a.id, a]));
  const draw = () => {
    $('#agents').innerHTML = state.agents.map((a) => `
      <div class="agent-row"><span class="agent-dot" style="background:${a.color}"></span>
        <div><b>${esc(a.name)}</b> <span class="muted">· ${esc(a.title)}</span><br>
        <span class="chip ${a.status === 'idle' ? '' : 'accent'}">${statusLabel[a.status] || a.status}</span>${a.model && a.status !== 'idle' ? ` <span class="chip">${esc(a.model)}</span>` : ''}
        ${a.activity ? `<div class="act">${esc(a.activity)}</div>` : ''}</div></div>`).join('');
    $('#feed').innerHTML = state.events.map((e) => `
      <div class="feed-item" style="border-color:${names[e.agent_id]?.color || 'var(--line)'}">
        <span class="who">${esc(names[e.agent_id]?.name || e.agent_id)}</span> <span class="muted small">${{ plan: 'menyusun rencana', start: 'mulai', result: 'selesai', report: 'laporan akhir', error: 'error', info: '' }[e.type] ?? e.type} · ${timeAgo(e.created_at)}${e.model ? ' · ' + esc(e.model) : ''}</span>
        <pre>${esc(e.content)}</pre>
      </div>`).join('') || '<p class="empty">Belum ada aktivitas. Kirim perintah di bawah panggung.</p>';
    $('#legend').innerHTML = state.agents.filter((a) => a.status !== 'idle').map((a) => `<span class="chip" style="color:${a.color}">● ${esc(a.name)}: ${statusLabel[a.status]}</span>`).join('');
    office?.update(state.agents);
  };
  draw();
  try {
    const mod = await import('/office.js');
    office = await mod.createOffice($('#stage'), state.roster);
    office.update(state.agents);
    onCleanup(() => office.destroy());
  } catch (e) {
    console.error(e);
    $('#stage').insertAdjacentHTML('beforeend', `<p class="empty">Gagal memuat 3D: ${esc(e.message)}</p>`);
  }
  claudeBanner($('#claude-q'));
  every(2500, async () => {
    state = await api('/api/agents/state');
    draw();
  });
  every(10000, () => claudeBanner($('#claude-q')));
  $('#cmd').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#cmd-input');
    try {
      const r = await api('/api/agents/command', { method: 'POST', body: { command: input.value } });
      input.value = '';
      toast(r.run.viaClaude ? `Run #${r.run.id} masuk antrean Claude` : `Run #${r.run.id} dimulai`);
      claudeBanner($('#claude-q'));
      state = await api('/api/agents/state');
      draw();
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- Riset Kompetitor ----------

// Bookmarklet = pembaca bersama (scanner-core.js) + kirim hasil ke jendela kecil /scan.html.
function bookmarkletSource(ORIGIN) {
  var ads = SCRAPE(120);
  if (!ads.length) { alert('Tidak menemukan iklan. Buka hasil pencarian Meta Ad Library dan scroll sampai iklan muncul.'); return; }
  var u = new URL(location.href);
  var payload = { type: 'sb-scan', keyword: u.searchParams.get('q') || '', country: u.searchParams.get('country') || '', url: location.href, ads: ads };
  var w = window.open(ORIGIN + '/scan.html', 'sbscan', 'width=520,height=640');
  if (!w) { alert('Popup diblokir. Izinkan popup untuk facebook.com lalu klik lagi.'); return; }
  var tries = 0;
  var timer = setInterval(function () { try { w.postMessage(payload, ORIGIN); } catch (e) {} if (++tries > 60) clearInterval(timer); }, 500);
  window.addEventListener('message', function (e) { if (e.origin === ORIGIN && e.data === 'sb-ack') clearInterval(timer); });
}

function bookmarkletHref() {
  return 'javascript:' + encodeURIComponent(`(function(){var SCRAPE=${scrapeAdLibrary.toString()};(${bookmarkletSource.toString()})(${JSON.stringify(location.origin)});})();void 0`);
}

const ICO = {
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  tagi: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const ico = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICO[name]}</svg>`;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtDay = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? `Hari ini ${hm}` : `${d.getDate()} ${BULAN[d.getMonth()]} ${hm}`;
}
// Hasil Ad Library untuk satu item pantauan: iklan aktif, diurutkan dari impresi terbanyak.
function adLibraryUrl(w) {
  const p = new URLSearchParams({ active_status: 'active', ad_type: 'all', country: w.country || 'ID', q: w.value, search_type: 'keyword_unordered', media_type: 'all' });
  return `https://www.facebook.com/ads/library/?${p}&sort_data[direction]=desc&sort_data[mode]=total_impressions`;
}
const CLAUDE_PROMPT = 'Scan iklan kompetitor dari daftar pantauan Second Brain di Meta Ad Library (pakai browser, urut impresi, ambil gambar & video), simpan semua hasilnya, lalu buat laporan bedah iklannya.';

async function researchView(params) {
  const st = {
    tab: params.get('tab') || 'galeri',
    q: params.get('q') || '',
    page: params.get('page') || '',
    angle: '',
    sort: 'impressions',
    active: false,
    open: params.get('open') || '',
  };
  let busy = false;
  let scanBusy = false;
  view.innerHTML = `
    <div class="page-head rk-head"><div><h1>Riset Kompetitor</h1><p class="muted">Iklan kompetitor dari Meta Ad Library: lengkap dengan gambar &amp; video, lama tayang, duplikat, dan urutan impresi.</p></div></div>
    <div class="rk-tabs" role="tablist">
      <button data-tab="galeri">${ico('megaphone')}Galeri iklan</button>
      <button data-tab="laporan">${ico('doc')}Laporan bedah iklan</button>
      <button data-tab="konten">${ico('pen')}Konten tim</button>
    </div>
    <div id="claude-q"></div>
    <div class="rk-stats" id="rk-stats"></div>
    <div class="rk-layout"><div id="rk-main"></div><aside class="rk-side" id="rk-side"></aside></div>`;

  const stats = async () => {
    const s = await api('/api/competitor/stats');
    const t = s.totals || {};
    $('#rk-stats').innerHTML = [['Iklan tersimpan', t.total], ['Masih tayang', t.active], ['Halaman kompetitor', t.pages], ['Baru 7 hari', t.new7]]
      .map(([l, n]) => `<div class="rk-stat"><div class="l">${l}</div><div class="n">${n || 0}</div></div>`).join('');
    return s;
  };

  const renderSide = async (s) => {
    const [{ watchlist }, { scans }] = await Promise.all([api('/api/competitor/watchlist'), api('/api/competitor/scan-status')]);
    scanBusy = Object.values(scans).some((x) => x.state === 'queued' || x.state === 'running');
    const maxAngle = Math.max(1, ...s.angles.map((a) => a.n));
    const last = s.lastScan;
    $('#rk-side').innerHTML = `
      <section><h3>Daftar pantauan</h3><div class="side-card">
        ${watchlist.map((w) => `<div class="watch-item"><span class="kind">${w.kind === 'page' ? 'Halaman' : 'Kata kunci'}</span><span class="val">${esc(w.value)}${scanLine(scans[w.id])}</span><span class="muted small">${esc(w.country)}</span><button class="btn small primary" data-scan="${w.id}" ${['queued', 'running'].includes(scans[w.id]?.state) ? 'disabled' : ''}>Scan</button><a href="${adLibraryUrl(w)}" target="_blank" rel="noopener" title="Buka di Ad Library (manual)" aria-label="Buka di Ad Library">${ico('ext')}</a><button data-del="${w.id}" aria-label="Hapus">${ico('trash')}</button></div>`).join('')}
        <form class="watch-form" id="watch-form">
          <select name="kind" aria-label="Jenis"><option value="keyword">Kata kunci</option><option value="page">Halaman</option></select>
          <input name="value" placeholder="mis. novia" required aria-label="Kata kunci atau halaman">
          <button class="btn primary">${ico('plus')} Pantau</button>
        </form>
      </div></section>
      <section><h3>Cara scan</h3><div class="side-card pad">
        <p class="scan-step">Otomatis di Cloudflare</p>
        <p class="muted small">Server membuka Ad Library, mengurutkan impresi terbanyak, lalu mengambil iklan beserta gambar &amp; video. Berjalan sendiri setiap hari jam 06:00, dan langsung saat kata kunci baru ditambahkan.</p>
        <button class="btn primary small" id="scan-all" ${watchlist.length ? '' : 'disabled'}>Scan semua sekarang</button>
        <p class="scan-step" style="margin-top:16px">1. Sendiri, lewat Chrome di laptop</p>
        <p class="muted small">Seret tombol ini ke bookmark bar. Buka Ad Library, cari kata kunci, urutkan <i>Impressions: high to low</i>, lalu klik bookmark-nya. Semua iklan beserta gambar &amp; videonya masuk ke sini.</p>
        <a class="btn primary small" id="bm" href="#">${ico('megaphone')} Kirim ke Second Brain</a>
        <p class="scan-step" style="margin-top:16px">2. Lewat Claude (bisa sekaligus dibuatkan laporan)</p>
        <p class="muted small">Di Claude desktop / Claude in Chrome (konektor Second Brain aktif), kirim:</p>
        <div class="prompt-box">${esc(CLAUDE_PROMPT)}<button id="copy-prompt" aria-label="Salin">${ico('copy')}</button></div>
        ${last ? `<p class="muted small">Scan terakhir ${fmtWhen(last.created_at)} · ${last.ad_count} iklan, ${last.new_count} baru</p>` : '<p class="muted small">Belum pernah scan.</p>'}
      </div></section>
      <section><h3>Kompetitor</h3><div class="side-card">
        ${s.competitors.map((c) => `<button class="comp-item ${st.page === c.page_name ? 'on' : ''}" data-page="${esc(c.page_name)}">${esc(c.page_name)}<small>${c.active}/${c.total} tayang · terlama ${c.oldest_days} hari</small></button>`).join('') || '<p class="empty">Belum ada.</p>'}
      </div></section>
      <section><h3>Angle yang dipakai</h3><div class="side-card pad">
        ${s.angles.map((a) => `<div class="angle-row"><div class="top"><span>${esc(a.angle)}</span><span>${a.n}</span></div><div class="angle-bar"><span style="width:${Math.round((a.n / maxAngle) * 100)}%"></span></div></div>`).join('') || '<p class="muted small">Muncul setelah iklan dinilai tim AI.</p>'}
      </div></section>`;
    const bm = $('#bm');
    bm.href = bookmarkletHref();
    bm.onclick = (e) => { e.preventDefault(); toast('Seret tombol ini ke bookmark bar, jangan diklik di sini.'); };
    $('#scan-all').onclick = async () => {
      const r = await api('/api/competitor/scan', { method: 'POST', body: {} });
      toast(`${r.queued} kata kunci masuk antrean scan (±1 menit per kata kunci)`);
      renderSide(s);
    };
    document.querySelectorAll('[data-scan]').forEach((b) => (b.onclick = async () => {
      await api('/api/competitor/scan', { method: 'POST', body: { watchId: b.dataset.scan } });
      toast('Scan dimulai di Cloudflare, ±1 menit');
      renderSide(s);
    }));
    $('#copy-prompt').onclick = () => navigator.clipboard.writeText(CLAUDE_PROMPT).then(() => toast('Disalin'));
    $('#watch-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/competitor/watchlist', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        toast('Ditambahkan. Scan otomatis dimulai di Cloudflare, ±1 menit.');
        renderSide(s);
      } catch (err) {
        toast(err.message);
      }
    };
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      await api(`/api/competitor/watchlist/${b.dataset.del}`, { method: 'DELETE' });
      renderSide(s);
    }));
    document.querySelectorAll('.comp-item[data-page]').forEach((b) => (b.onclick = () => {
      st.page = st.page === b.dataset.page ? '' : b.dataset.page;
      st.tab = 'galeri';
      renderMain();
      document.querySelectorAll('.comp-item').forEach((x) => x.classList.toggle('on', x.dataset.page === st.page));
    }));
  };

  const loadAds = async () => {
    const p = new URLSearchParams({ q: st.q, page: st.page, angle: st.angle, sort: st.sort, active: st.active ? '1' : '0' });
    const { ads } = await api(`/api/competitor/ads?${p}`);
    busy = ads.some((a) => a.score === null || ['pending', 'claude'].includes(a.analysis_status) || ['pending', 'claude'].includes(a.variations_status));
    const list = $('#ads');
    if (!list) return;
    list.innerHTML = ads.length ? ads.map(adRow).join('') : (st.q || st.page || st.angle || st.active)
      ? '<div class="side-card empty">Tidak ada iklan yang cocok dengan filter ini.</div>'
      : `<div class="side-card pad"><h3>Belum ada iklan. Begini cara mengisinya:</h3>
          <ol class="steps">
            <li>Seret tombol <b>Kirim ke Second Brain</b> (kolom kanan, bagian Cara scan) ke bookmark bar Chrome. Cukup sekali.</li>
            <li>Klik tombol <b>Scan ↗</b> di Daftar pantauan. Meta Ad Library terbuka dengan kata kuncimu, sudah diurutkan dari impresi terbanyak.</li>
            <li>Scroll halaman itu sampai semua iklan yang kamu mau tampil.</li>
            <li>Klik bookmark <b>Kirim ke Second Brain</b>. Jendela kecil terbuka, lalu iklan muncul di sini dalam beberapa detik.</li>
          </ol>
          <p class="muted small">Daftar pantauan tidak men-scan sendiri: Meta tidak menyediakan jalur resmi untuk mengambil iklan komersial Indonesia otomatis dari server.</p></div>`;
    bindAdRows(list, ads);
  };

  const renderGallery = async (s) => {
    $('#rk-main').innerHTML = `
      <div class="rk-main-head"><h3>Iklan</h3><span class="rk-pill">Penilai: Claude Opus</span></div>
      <div class="rk-filter">
        <div class="row">
          <label class="rk-search">${ico('search')}<input type="search" id="f-q" placeholder="Cari teks iklan / halaman" value="${esc(st.q)}" aria-label="Cari"></label>
          <select id="f-page" aria-label="Kompetitor"><option value="">Semua kompetitor</option>${s.competitors.map((c) => `<option ${c.page_name === st.page ? 'selected' : ''}>${esc(c.page_name)}</option>`).join('')}</select>
        </div>
        <div class="row">
          <select id="f-angle" aria-label="Angle"><option value="">Semua angle</option>${s.anglesList.map((a) => `<option ${a === st.angle ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
          <select id="f-sort" aria-label="Urutkan">
            ${[['impressions', 'Impresi terbanyak'], ['days', 'Paling lama tayang'], ['new', 'Terbaru'], ['score', 'Skor tertinggi']].map(([v, l]) => `<option value="${v}" ${v === st.sort ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <label class="rk-check"><input type="checkbox" id="f-active" ${st.active ? 'checked' : ''}> Masih tayang</label>
      </div>
      <div class="rk-list" id="ads"><p class="muted">Memuat…</p></div>`;
    let t;
    $('#f-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); loadAds(); }, 300); };
    $('#f-page').onchange = (e) => { st.page = e.target.value; loadAds(); document.querySelectorAll('.comp-item').forEach((x) => x.classList.toggle('on', x.dataset.page === st.page)); };
    $('#f-angle').onchange = (e) => { st.angle = e.target.value; loadAds(); };
    $('#f-sort').onchange = (e) => { st.sort = e.target.value; loadAds(); };
    $('#f-active').onchange = (e) => { st.active = e.target.checked; loadAds(); };
    await loadAds();
  };

  const renderWork = async (kind) => {
    const isReport = kind === 'laporan';
    const { ads } = await api(isReport ? '/api/competitor/reports' : '/api/competitor/content');
    busy = ads.some((a) => ['pending', 'claude'].includes(a.analysis_status) || ['pending', 'claude'].includes(a.variations_status));
    const status = (a) => (isReport ? a.analysis_status : a.variations_status);
    const text = (a) => (isReport ? a.analysis : a.variations);
    $('#rk-main').innerHTML = `
      <div class="rk-main-head"><h3>${isReport ? 'Laporan bedah iklan' : 'Konten tim'}</h3>
        ${isReport ? '<button class="btn small primary" id="analyze-top">Bedah 5 iklan terkuat</button>' : ''}</div>
      <p class="muted small" style="margin:6px 0 14px">${isReport
        ? 'Hook, angle, penawaran, celah, dan cara mengadaptasi untuk bisnismu. Bisa juga dibuat Claude lewat konektor (save_ad_report).'
        : 'Hasil "Bikin 5 konten mirip": konten orisinal yang meniru pola iklan pemenang untuk bisnismu. Salinannya juga ada di Catatan.'}</p>
      ${ads.map((a) => `
        <details class="work-item" data-id="${a.id}" ${String(a.id) === st.open ? 'open' : ''}>
          <summary><b>${esc(a.page_name || 'Iklan')}</b>${badges(a)}
            <span class="tag ${status(a) === 'error' ? 'risk' : status(a) === 'pending' ? 'promo' : 'angle'}">${{ pending: isReport ? 'sedang dibedah…' : 'sedang ditulis…', claude: 'menunggu Claude', error: 'gagal', done: 'selesai' }[status(a)] || status(a)}</span>
            <span class="muted small" style="flex-basis:100%">${esc(a.headline || a.body.slice(0, 120))}</span></summary>
          <div class="md">${status(a) === 'pending' ? '<p class="muted">Sedang diproses, 1-3 menit…</p>' : status(a) === 'claude' ? '<p class="muted">Menunggu dikerjakan Claude lewat konektor (lihat kartu Antrean Claude di atas).</p>' : md(text(a))}</div>
          <div class="adrow-actions" style="margin-top:10px">
            <button class="btn small redo">${isReport ? 'Bedah ulang' : 'Bikin lagi'}</button>
            <a class="btn small" href="https://www.facebook.com/ads/library/?id=${esc(a.library_id)}" target="_blank" rel="noopener">Ad Library ${ico('ext')}</a>
          </div>
        </details>`).join('') || `<div class="side-card empty">${isReport ? 'Belum ada laporan. Klik "Bedah 5 iklan terkuat" atau buka detail iklan di Galeri.' : 'Belum ada konten. Klik "Bikin 5 konten mirip" di kartu iklan.'}</div>`}`;
    $('#analyze-top')?.addEventListener('click', async () => {
      const r = await api('/api/competitor/analyze-top', { method: 'POST', body: { n: 5 } });
      toast(r.queued ? `${r.queued} iklan masuk antrean bedah` : 'Semua iklan sudah dibedah');
      renderWork(kind);
      claudeBanner($('#claude-q'));
    });
    document.querySelectorAll('.work-item').forEach((el) => {
      el.querySelector('.redo').onclick = async () => {
        const r = await api(`/api/competitor/ads/${el.dataset.id}/${isReport ? 'analyze' : 'variations'}`, { method: 'POST' });
        toast(r.viaClaude ? 'Masuk antrean Claude' : isReport ? 'Sedang dibedah ulang…' : 'Sedang ditulis ulang…');
        renderWork(kind);
        claudeBanner($('#claude-q'));
      };
    });
    document.querySelector('.work-item[open]')?.scrollIntoView({ block: 'start' });
  };

  let lastStats;
  const renderMain = async () => {
    document.querySelectorAll('.rk-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
    if (st.tab === 'laporan' || st.tab === 'konten') return renderWork(st.tab);
    return renderGallery(lastStats);
  };

  function bindAdRows(root, ads) {
    const byId = Object.fromEntries(ads.map((a) => [String(a.id), a]));
    root.querySelectorAll('.adrow').forEach((el) => {
      const a = byId[el.dataset.id];
      el.querySelector('.open').onclick = () => openAd(a.id, loadAds);
      const v = el.querySelector('video');
      const play = el.querySelector('.play');
      if (v && play) {
        play.onclick = () => { v.controls = true; v.play().catch(() => {}); play.remove(); };
        v.addEventListener('loadedmetadata', () => {
          const d = el.querySelector('.dur');
          if (d && !d.textContent && isFinite(v.duration)) d.textContent = fmtDur(Math.round(v.duration));
        });
      }
      el.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
        const box = img.closest('.adrow-media');
        box.classList.add('empty');
        box.innerHTML = `<div>${ico('image')}<div>Gambar kedaluwarsa</div><a href="https://www.facebook.com/ads/library/?id=${esc(a.library_id)}" target="_blank" rel="noopener">Buka Ad Library</a></div>`;
      }, { once: true }));
      el.querySelector('.make')?.addEventListener('click', async () => {
        const r = await api(`/api/competitor/ads/${a.id}/variations`, { method: 'POST' });
        toast(r.viaClaude ? 'Masuk antrean Claude. Kirim prompt di kartu Antrean Claude ke Claude.' : '5 konten sedang ditulis… hasil juga dikirim ke Telegram');
        loadAds();
        claudeBanner($('#claude-q'));
      });
      el.querySelector('.see')?.addEventListener('click', () => { st.tab = 'konten'; st.open = String(a.id); renderMain(); });
    });
  }

  document.querySelectorAll('.rk-tabs button').forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; st.open = ''; renderMain(); }));
  lastStats = await stats();
  await Promise.all([renderSide(lastStats), renderMain(), claudeBanner($('#claude-q'))]);
  every(8000, async () => {
    if (!(busy || scanBusy) || document.querySelector('dialog[open]')) return;
    const wasScanning = scanBusy;
    lastStats = await stats();
    if (wasScanning) await renderSide(lastStats);
    claudeBanner($('#claude-q'));
    if (st.tab === 'galeri') loadAds(); else renderWork(st.tab);
  });
}

// Kartu "Antrean Claude": muncul saat tidak ada API key dan ada analisa yang menunggu.
async function claudeBanner(el) {
  if (!el) return;
  const c = await api('/api/claude/pending').catch(() => null);
  if (!c || c.apiKey || !c.total) { el.innerHTML = ''; return; }
  const parts = [[c.scores, 'iklan dinilai'], [c.reports, 'bedah iklan'], [c.contents, '5 konten mirip'], [c.teams, 'perintah tim'], [c.writes, 'tulisan']]
    .filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(' · ');
  el.innerHTML = `<div class="claude-banner">
    <div><b>${c.total} pekerjaan menunggu Claude</b><div class="muted small">${parts}</div>
    <div class="small" style="margin-top:6px">Dikerjakan Claude Opus dari langgananmu. Buka Claude (desktop / claude.ai) dengan konektor Second Brain aktif, lalu kirim:</div></div>
    <div class="prompt-box" style="margin:0">${esc(c.prompt)}<button aria-label="Salin">${ico('copy')}</button></div>
  </div>`;
  el.querySelector('.prompt-box button').onclick = () => navigator.clipboard.writeText(c.prompt).then(() => toast('Disalin. Tempel di Claude.'));
}

function scanLine(x) {
  if (!x) return '';
  const label = {
    queued: 'menunggu giliran scan…',
    running: 'sedang scan di Cloudflare…',
    done: `scan ${fmtWhen(x.at)} · ${x.count || 0} iklan, ${x.fresh || 0} baru`,
    error: `gagal: ${x.error || ''}`,
  }[x.state] || '';
  return label ? `<small class="${x.state === 'error' ? 'scan-err' : 'muted'}" style="display:block;font-weight:400">${esc(label)}</small>` : '';
}

function badges(a) {
  return `${a.evergreen ? `<span class="bdg ever">Evergreen ${a.days_running} hari</span>` : ''}${a.scaling ? '<span class="bdg scale">Scaling</span>' : ''}${a.rank ? `<span class="bdg imp">Impresi #${a.rank}</span>` : ''}${a.worth_copy ? '<span class="bdg copy">Layak ditiru</span>' : ''}`;
}

function adRow(a) {
  const m = a.media.find((x) => x.type === 'video') || a.media[0];
  const lib = `https://www.facebook.com/ads/library/?id=${esc(a.library_id)}`;
  let media;
  if (!m) {
    media = `<div class="adrow-media empty"><div>${ico('image')}<div>Tanpa media</div><a href="${lib}" target="_blank" rel="noopener">Buka Ad Library</a></div></div>`;
  } else if (m.type === 'video') {
    media = `<div class="adrow-media"><video src="${esc(m.display)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} playsinline preload="${m.poster ? 'none' : 'metadata'}"></video>
      <button class="play" aria-label="Putar video"><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg></button><span class="dur">${fmtDur(a.video_seconds)}</span></div>`;
  } else {
    media = `<div class="adrow-media"><img src="${esc(m.display)}" alt="Iklan ${esc(a.page_name)}" loading="lazy" referrerpolicy="no-referrer"></div>`;
  }
  const meta = [
    a.media_type === 'video' ? `video${a.video_seconds ? ' ' + fmtDur(a.video_seconds) : ''}` : a.media_type === 'image' ? 'gambar' : '',
    a.variants > 1 ? `${a.variants} duplikat` : '',
    a.start_ts ? `sejak ${fmtDay(a.start_ts)}` : '',
    a.days_running !== null && a.days_running !== undefined ? `${a.days_running} hari tayang` : '',
  ].filter(Boolean).join(' · ');
  const strong = a.hook === 'Kuat' || a.hook === 'Sangat kuat';
  const showBody = a.body && a.body.trim() !== (a.headline || '').trim();
  const vs = a.variations_status;
  const action = vs === 'claude' ? `<button class="btn small" disabled>${ico('spark')} Menunggu Claude</button>`
    : vs === 'pending' ? `<button class="btn small" disabled>${ico('spark')} Menulis…</button>`
    : vs === 'done' ? `<button class="btn small see">Lihat konten tim</button><button class="btn small make">Bikin lagi</button>`
      : vs === 'error' ? `<button class="btn small err make">${ico('spark')} Gagal — coba lagi</button>`
        : `<button class="btn small make">${ico('spark')} Bikin 5 konten mirip</button>`;
  return `<article class="adrow" data-id="${a.id}">
    ${media}
    <div class="adrow-body">
      <div class="adrow-title"><b><a href="#" class="open" onclick="return false" style="color:inherit;text-decoration:none">${esc(a.page_name || 'Tanpa nama')}</a></b>${a.active ? '<span class="live-dot" title="Masih tayang"></span>' : '<span class="tag">berhenti</span>'}${badges(a)}</div>
      ${meta ? `<div class="adrow-meta">${meta}</div>` : ''}
      ${a.headline ? `<div class="hookbox">“${esc(a.headline)}”</div>` : ''}
      ${showBody ? `<div class="adrow-text">${esc(a.body)}</div>` : ''}
      <div class="tags">
        ${a.angle ? `<span class="tag angle">${esc(a.angle)}</span>` : `<span class="tag">${a.score === null ? 'dinilai Claude Opus…' : 'menunggu penilaian Claude'}</span>`}
        ${a.hook ? `<span class="tag ${strong ? 'hook-strong' : ''}">Hook ${esc(a.hook)}</span>` : ''}
        ${a.is_promo ? `<span class="tag promo">${ico('tagi')}Promo</span>` : ''}
        ${a.risky_claim ? `<span class="tag risk">${ico('warn')}Klaim berisiko</span>` : ''}
        ${a.cta ? `<span class="tag">${esc(a.cta)}</span>` : ''}
      </div>
      <div class="adrow-foot">${a.landing ? `<span>${esc(a.landing)}</span>` : ''}${a.keyword ? `<span>“${esc(a.keyword)}”</span>` : ''}<span class="grow"></span><a href="${lib}" target="_blank" rel="noopener">Ad Library ${ico('ext')}</a></div>
      <div class="adrow-actions">${action}</div>
    </div>
  </article>`;
}

async function adAction(id, action, msg, reload) {
  const r = await api(`/api/competitor/ads/${id}/${action}`, { method: 'POST' });
  toast(r.viaClaude ? 'Masuk antrean Claude. Kirim prompt di kartu Antrean Claude ke Claude.' : msg);
  reload();
  claudeBanner($('#claude-q'));
}

async function openAd(id, reload) {
  const { ad: a } = await api(`/api/competitor/ads/${id}`);
  const d = dialog(`
    <div class="dlg-body">
      <h2>${esc(a.page_name || 'Iklan')} <span class="muted small">${a.rank ? 'Impresi #' + a.rank + ' · ' : ''}${esc(a.keyword)}</span></h2>
      <div class="media-strip">${a.media.map((m) => m.type === 'video'
        ? `<video src="${esc(m.display)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} controls playsinline preload="metadata"></video>`
        : `<img src="${esc(m.display)}" alt="" referrerpolicy="no-referrer">`).join('') || '<p class="muted">Tanpa media.</p>'}</div>
      <div class="ad-meta">
        <span class="chip">Mulai ${esc(a.start_date || '?')}</span><span class="chip accent">${a.days_running ?? '?'} hari tayang</span>
        <span class="chip">Skor ${a.score ?? '-'}</span>${a.score_model ? `<span class="chip">dinilai ${esc(a.score_model)}</span>` : ''}${a.cta ? `<span class="chip">CTA: ${esc(a.cta)}</span>` : ''}
      </div>
      <p class="small muted">${esc(a.score_reason)}</p>
      <div class="card" style="white-space:pre-wrap">${esc(a.body || a.headline || '(tanpa teks)')}</div>
      <div class="tabs"><button class="on" data-t="analysis">Bedah iklan</button><button data-t="variations">5 konten mirip</button></div>
      <div id="tab-analysis" class="md">${a.analysis_status === 'pending' ? '<p class="muted">Sedang dibuat… (1-2 menit)</p>' : a.analysis ? md(a.analysis) : '<p class="muted">Belum ada. Klik "Bedah iklan".</p>'}</div>
      <div id="tab-variations" class="md" hidden>${a.variations_status === 'pending' ? '<p class="muted">Sedang ditulis… (1-3 menit)</p>' : a.variations ? md(a.variations) : '<p class="muted">Belum ada. Klik "Bikin 5 konten mirip".</p>'}</div>
    </div>
    <div class="dlg-foot">
      <div class="row"><a class="btn small" href="https://www.facebook.com/ads/library/?id=${esc(a.library_id)}" target="_blank" rel="noopener">Buka di Ad Library</a><button class="btn small danger" id="del">Hapus</button>${a.media_saved || !a.media.length ? '' : '<button class="btn small" id="save">Simpan media permanen</button>'}</div>
      <div class="row"><button class="btn small" id="an">Bedah iklan</button><button class="btn small primary" id="va">Bikin 5 konten mirip</button><button class="btn small" id="close">Tutup</button></div>
    </div>`);
  d.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
    d.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#tab-analysis', d).hidden = b.dataset.t !== 'analysis';
    $('#tab-variations', d).hidden = b.dataset.t !== 'variations';
  }));
  $('#close', d).onclick = () => d.close();
  $('#an', d).onclick = async () => { await adAction(id, 'analyze', 'Bedah iklan sedang dibuat… lihat tab Laporan bedah iklan', reload); d.close(); };
  $('#va', d).onclick = async () => { await adAction(id, 'variations', '5 konten sedang ditulis…', reload); d.close(); };
  $('#save', d)?.addEventListener('click', async () => { await adAction(id, 'save-media', 'Menyalin media…', reload); d.close(); });
  $('#del', d).onclick = async () => {
    if (!confirm('Hapus iklan ini dari riset?')) return;
    await api(`/api/competitor/ads/${id}`, { method: 'DELETE' });
    d.close();
    reload();
  };
}

// ---------- Sistem ----------

async function systemView(params) {
  const s = await api('/api/system');
  if (params.get('google') === 'ok') toast('Google terhubung ✅');
  if (params.get('google_error')) toast('Google gagal: ' + params.get('google_error'));
  const smart = s.models.smartStatus;
  view.innerHTML = `
    <div class="page-head"><div><h1>Sistem</h1><p class="muted">Status koneksi, model AI, dan integrasi.</p></div></div>
    <div class="grid-2">
      <div class="card">
        <h2>Telegram</h2>
        <dl class="kv">
          <dt>Pemilik</dt><dd>${esc(s.owner || '-')} ${s.chatIdSet ? '<span class="chip accent">chat ID terisi</span>' : '<span class="chip danger">OWNER_CHAT_ID kosong</span>'}</dd>
          <dt>Webhook</dt><dd>${s.webhook?.url ? `<span class="mono">${esc(s.webhook.url)}</span>` : '<span class="chip danger">belum terpasang</span>'}</dd>
          <dt>Antrean update</dt><dd>${s.webhook?.pending ?? '-'}</dd>
          ${s.webhook?.lastError ? `<dt>Error terakhir</dt><dd class="small">${esc(s.webhook.lastError)}</dd>` : ''}
          <dt>Zona waktu</dt><dd>${esc(s.tz)}</dd>
        </dl>
        <div class="row" style="margin-top:14px"><button class="btn small" id="brief">Kirim briefing pagi sekarang</button><button class="btn small" id="recap">Kirim rekap malam sekarang</button></div>
      </div>
      <div class="card">
        <h2>Otak AI</h2>
        <dl class="kv">
          <dt>Model cepat</dt><dd class="mono">${esc(s.models.fast)} <span class="chip accent">Workers AI</span></dd>
          <dt>Analisa</dt><dd>${s.models.smartEnabled ? `<span class="mono">${esc(s.models.smart)}</span> <span class="chip accent">API key</span>` : '<b>Claude langganan</b> lewat konektor <span class="chip accent">antrean Claude</span>'}</dd>
          <dt>Status Opus</dt><dd>${smart ? (smart.ok ? `OK · ${timeAgo(smart.at)}` : `<span class="chip danger">gagal</span> ${esc(smart.error || '')} · ${timeAgo(smart.at)}`) : 'Belum dipakai'}</dd>
          <dt>Dipakai untuk</dt><dd class="small">Claude Opus (tanpa cadangan Llama): semua analisa — penilaian & bedah iklan, 5 konten mirip, penulisan konten, dan seluruh kerja tim AI. Workers AI hanya untuk chat harian, mencatat tugas/catatan, briefing, rekap, dan voice note.</dd>
        </dl>
        ${s.models.smartEnabled ? '' : '<p class="small muted" style="margin-top:10px">Analisa masuk antrean dan dikerjakan Claude Opus dari langgananmu: buka Claude dengan konektor Second Brain, lalu kirim "Kerjakan semua antrean analisa di Second Brain". Mau otomatis tanpa membuka Claude? Isi GitHub Secret <code class="mono">ANTHROPIC_API_KEY</code> (berbayar per pemakaian).</p>'}
      </div>
      <div class="card">
        <h2>Konektor Claude (MCP)</h2>
        <p class="small muted">claude.ai → Settings → Connectors → Add custom connector → tempel URL ini → Connect → masuk dengan kode Telegram → Izinkan.</p>
        <div class="codebox"><span id="mcp-url">${esc(s.mcpUrl)}</span><button class="btn small" id="copy-mcp">Salin</button></div>
      </div>
      <div class="card">
        <h2>Gmail &amp; Google Drive</h2>
        ${!s.google.configured
          ? '<p class="small">Belum dikonfigurasi. Isi GitHub Secrets <code class="mono">GOOGLE_CLIENT_ID</code> dan <code class="mono">GOOGLE_CLIENT_SECRET</code> (lihat README), jalankan ulang workflow Deploy, lalu kembali ke sini.</p>'
          : s.google.connected
            ? `<p>Terhubung${s.google.email ? ' sebagai <b>' + esc(s.google.email) + '</b>' : ''} ✅</p><button class="btn small danger" id="gdis">Putuskan</button>`
            : '<p class="small">Siap dihubungkan. Email belum dibaca akan masuk ke briefing pagi, dan asisten bisa mencari file Drive.</p><a class="btn primary small" href="/api/google/connect">Hubungkan Google</a>'}
      </div>
      <div class="card">
        <h2>Data</h2>
        <dl class="kv">
          ${Object.entries(s.counts || {}).map(([k, v]) => `<dt>${esc({ tasks: 'Tugas', notes: 'Catatan', memories: 'Memori', ads: 'Iklan kompetitor', runs: 'Run tim AI', messages: 'Pesan chat' }[k] || k)}</dt><dd>${v}</dd>`).join('')}
          <dt>Binding</dt><dd>${Object.entries(s.bindings).map(([k, v]) => `<span class="chip ${v ? 'accent' : 'danger'}">${k}</span>`).join(' ')}</dd>
        </dl>
      </div>
    </div>`;
  $('#brief').onclick = async () => { await api('/api/system/briefing', { method: 'POST' }); toast('Briefing dikirim ke Telegram'); };
  $('#recap').onclick = async () => { await api('/api/system/recap', { method: 'POST' }); toast('Rekap dikirim ke Telegram'); };
  $('#copy-mcp').onclick = () => navigator.clipboard.writeText(s.mcpUrl).then(() => toast('URL disalin'));
  $('#gdis')?.addEventListener('click', async () => { await api('/api/google/disconnect', { method: 'POST' }); systemView(new URLSearchParams()); });
}
