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
  $('#brand-name').textContent = ME.app;
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
  every(2500, async () => {
    state = await api('/api/agents/state');
    draw();
  });
  $('#cmd').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#cmd-input');
    try {
      const r = await api('/api/agents/command', { method: 'POST', body: { command: input.value } });
      input.value = '';
      toast(`Run #${r.run.id} dimulai`);
      state = await api('/api/agents/state');
      draw();
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- Riset Kompetitor ----------

// Dijalankan di halaman Meta Ad Library lewat bookmarklet. Harus mandiri (tidak memakai variabel luar).
function adLibraryScanner(ORIGIN) {
  var ID_RE = /(Library ID|ID Galeri|ID Pustaka|ID perpustakaan|ID Arsip)\s*:?\s*(\d{6,})/i;
  var ID_RE_G = /(Library ID|ID Galeri|ID Pustaka|ID perpustakaan|ID Arsip)\s*:?\s*(\d{6,})/gi;
  var START_RE = /(Started running on|Mulai ditayangkan pada|Mulai tayang pada|Mulai berjalan pada|Mulai ditayangkan)\s+([^·\n]+)/i;
  var VAR_RE = /(\d+)\s+(ads use this creative|iklan menggunakan materi|iklan menggunakan konten|iklan menggunakan)/i;
  var CTA_RE = /^(Shop now|Learn more|Sign up|Send message|Send WhatsApp message|WhatsApp|Book now|Order now|Get offer|Contact us|Download|Install now|Apply now|Subscribe|Watch more|Belanja sekarang|Pelajari selengkapnya|Selengkapnya|Daftar|Kirim pesan|Kirim Pesan WhatsApp|Pesan sekarang|Hubungi kami|Dapatkan penawaran|Unduh|Instal sekarang|Lamar sekarang)$/i;
  var count = function (t) { var m = (t || '').match(ID_RE_G); return m ? m.length : 0; };
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var seen = {};
  var ads = [];
  var node;
  while ((node = walker.nextNode())) {
    var mm = (node.nodeValue || '').match(ID_RE);
    if (!mm || seen[mm[2]]) continue;
    seen[mm[2]] = 1;
    var card = node.parentElement;
    while (card.parentElement && card.parentElement !== document.body && count(card.parentElement.innerText) === 1) card = card.parentElement;
    var text = card.innerText || '';
    var start = text.match(START_RE);
    var variants = text.match(VAR_RE);
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
    var cands = card.querySelectorAll('div[role="button"], a[role="link"], span');
    for (var j = 0; j < cands.length && !cta; j++) {
      var ct = (cands[j].innerText || '').trim();
      if (ct && ct.length < 40 && CTA_RE.test(ct)) cta = ct;
    }
    var imgs = [];
    card.querySelectorAll('img').forEach(function (im) {
      var w = im.naturalWidth || im.width;
      var src = im.currentSrc || im.src;
      if (w >= 150 && src && src.indexOf('http') === 0 && imgs.indexOf(src) < 0) imgs.push(src);
    });
    var vids = [];
    card.querySelectorAll('video').forEach(function (v) {
      var src = v.currentSrc || v.src || (v.querySelector('source') || {}).src;
      if (src && src.indexOf('blob:') !== 0) vids.push({ src: src, poster: v.poster || '' });
    });
    ads.push({ libraryId: mm[2], pageName: pageName, pageUrl: pageUrl, body: body.slice(0, 5000), cta: cta, startDate: start ? start[2].trim() : '', variants: variants ? variants[1] : 1, images: imgs.slice(0, 6), videos: vids.slice(0, 3) });
  }
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
  return 'javascript:' + encodeURIComponent(`(${adLibraryScanner.toString()})(${JSON.stringify(location.origin)});void 0`);
}

async function researchView(params) {
  const { scans, keywords } = await api('/api/competitor/scans');
  let keyword = params.get('keyword') ?? (keywords[0]?.keyword || '');
  let sort = params.get('sort') || 'rank';
  let winners = params.get('winners') === '1';
  let busy = false;
  view.innerHTML = `
    <div class="page-head"><div><h1>Riset Kompetitor</h1><p class="muted">Iklan dari Meta Ad Library: gambar &amp; video, lama tayang, urutan impresi, skor, bedah iklan, dan "Bikin 5 konten mirip".</p></div>
      <button class="btn" id="howto">Cara scan</button></div>
    <div class="row" style="margin-bottom:14px">
      <select id="kw" style="width:auto;max-width:100%">
        <option value="">Semua kata kunci</option>
        ${keywords.map((k) => `<option value="${esc(k.keyword)}" ${k.keyword === keyword ? 'selected' : ''}>${esc(k.keyword || '(tanpa kata kunci)')} · ${k.n}</option>`).join('')}
      </select>
      <div class="tabs" id="sort">
        <button data-s="rank">Urutan impresi</button><button data-s="days">Paling lama tayang</button><button data-s="score">Skor</button><button data-s="new">Terbaru</button>
      </div>
      <label class="row small" style="gap:6px"><input type="checkbox" id="winners" style="width:auto" ${winners ? 'checked' : ''}> Pemenang saja</label>
    </div>
    <div class="ad-grid" id="ads"></div>`;
  const howto = () => dialog(`
    <div class="dlg-body">
      <h2>Cara scan iklan kompetitor</h2>
      <ol class="steps">
        <li>Seret tombol ini ke <b>bookmark bar</b> Chrome (tampilkan dengan Ctrl/⌘+Shift+B):<br><br><a class="bookmarklet" id="bm" href="#">Kirim ke Second Brain</a></li>
        <li>Buka <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noopener">Meta Ad Library</a>, pilih negara, kategori <i>Semua iklan</i>, lalu cari kata kunci.</li>
        <li>Urutkan <b>Impressions: high to low</b> (Tayangan: tertinggi ke terendah) dan scroll supaya lebih banyak iklan dimuat.</li>
        <li>Klik bookmark <b>Kirim ke Second Brain</b>. Jendela kecil terbuka dan iklan tersimpan di sini.</li>
      </ol>
      <p class="muted small">Pastikan kamu sudah login di website ini pada browser yang sama. Iklan pemenang (tayang ≥30 hari, 5 teratas, atau skor ≥75) otomatis disalin permanen karena link media Facebook kedaluwarsa dalam beberapa hari.</p>
    </div>
    <div class="dlg-foot"><span></span><button class="btn" onclick="this.closest('dialog').close()">Tutup</button></div>`,
  { onOpen: (d) => { const a = $('#bm', d); a.href = bookmarkletHref(); a.onclick = (e) => { e.preventDefault(); toast('Seret tombol ini ke bookmark bar, jangan diklik di sini.'); }; } });
  $('#howto').onclick = howto;

  const load = async () => {
    document.querySelectorAll('#sort button').forEach((b) => b.classList.toggle('on', b.dataset.s === sort));
    const { ads } = await api(`/api/competitor/ads?keyword=${encodeURIComponent(keyword)}&sort=${sort}&winners=${winners ? 1 : 0}`);
    busy = ads.some((a) => a.score === null || a.analysis_status === 'pending' || a.variations_status === 'pending');
    $('#ads').innerHTML = ads.length ? ads.map(adCard).join('') : `<div class="card empty" style="grid-column:1/-1">Belum ada iklan${scans.length ? ' untuk filter ini' : ''}. <a href="#" id="howto2">Lihat cara scan</a>.</div>`;
    $('#howto2')?.addEventListener('click', (e) => { e.preventDefault(); howto(); });
    document.querySelectorAll('.ad[data-id]').forEach((el) => {
      el.querySelector('.open').onclick = () => openAd(el.dataset.id, load);
      el.querySelector('.analyze').onclick = () => adAction(el.dataset.id, 'analyze', 'Bedah iklan sedang dibuat…', load);
      el.querySelector('.vars').onclick = () => adAction(el.dataset.id, 'variations', '5 konten sedang ditulis… hasil juga dikirim ke Telegram', load);
      el.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'nomedia', textContent: 'Gambar kedaluwarsa — scan ulang iklan ini' })); }, { once: true }));
    });
  };
  $('#kw').onchange = (e) => { keyword = e.target.value; load(); };
  document.querySelectorAll('#sort button').forEach((b) => (b.onclick = () => { sort = b.dataset.s; load(); }));
  $('#winners').onchange = (e) => { winners = e.target.checked; load(); };
  await load();
  if (!scans.length) howto();
  // Muat ulang hanya selama ada penilaian/bedah/penulisan yang sedang berjalan.
  every(8000, () => { if (busy && !document.querySelector('dialog[open]')) load(); });
}

function adCard(a) {
  const m = a.media[0];
  const media = !m ? '<div class="nomedia">Tanpa media</div>'
    : m.type === 'video'
      ? `<video src="${esc(m.display)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} muted playsinline preload="none" controls></video>`
      : `<img src="${esc(m.display)}" alt="Iklan ${esc(a.page_name)}" loading="lazy" referrerpolicy="no-referrer">`;
  const pending = (s) => s === 'pending';
  return `<article class="ad" data-id="${a.id}">
    <div class="ad-media">${media}<span class="rank">#${a.rank ?? '–'}</span>${a.winner ? '<span class="chip warn win">🏆 pemenang</span>' : ''}</div>
    <div class="ad-body">
      <div class="ad-page">${esc(a.page_name || 'Tanpa nama')}</div>
      <div class="ad-meta">
        <span class="chip ${a.days_running >= 30 ? 'accent' : ''}">${a.days_running ?? '?'} hari tayang</span>
        ${a.score !== null && a.score !== undefined ? `<span class="chip"><span class="score">${a.score}</span>/100</span>` : '<span class="chip">menilai…</span>'}
        ${a.variants > 1 ? `<span class="chip">${a.variants} varian</span>` : ''}
        ${a.media.length > 1 ? `<span class="chip">${a.media.length} media</span>` : ''}
        ${a.media_saved ? '<span class="chip accent">tersimpan</span>' : ''}
      </div>
      <div class="ad-text">${esc(a.body || '(tanpa teks)')}</div>
      <div class="ad-actions">
        <button class="btn small open">Detail</button>
        <button class="btn small analyze" ${pending(a.analysis_status) ? 'disabled' : ''}>${pending(a.analysis_status) ? 'Membedah…' : a.analysis_status === 'done' ? 'Bedah ulang' : 'Bedah iklan'}</button>
        <button class="btn small primary vars" ${pending(a.variations_status) ? 'disabled' : ''}>${pending(a.variations_status) ? 'Menulis…' : 'Bikin 5 konten mirip'}</button>
      </div>
    </div>
  </article>`;
}

async function adAction(id, action, msg, reload) {
  await api(`/api/competitor/ads/${id}/${action}`, { method: 'POST' });
  toast(msg);
  reload();
}

async function openAd(id, reload) {
  const { ad: a } = await api(`/api/competitor/ads/${id}`);
  const d = dialog(`
    <div class="dlg-body">
      <h2>${esc(a.page_name || 'Iklan')} <span class="muted small">#${a.rank} · ${esc(a.keyword)}</span></h2>
      <div class="media-strip">${a.media.map((m) => m.type === 'video'
        ? `<video src="${esc(m.display)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} controls playsinline preload="metadata"></video>`
        : `<img src="${esc(m.display)}" alt="" referrerpolicy="no-referrer">`).join('') || '<p class="muted">Tanpa media.</p>'}</div>
      <div class="ad-meta">
        <span class="chip">Mulai ${esc(a.start_date || '?')}</span><span class="chip accent">${a.days_running ?? '?'} hari tayang</span>
        <span class="chip">Skor ${a.score ?? '-'}</span>${a.score_model ? `<span class="chip">dinilai ${esc(a.score_model)}</span>` : ''}${a.cta ? `<span class="chip">CTA: ${esc(a.cta)}</span>` : ''}
      </div>
      <p class="small muted">${esc(a.score_reason)}</p>
      <div class="card" style="white-space:pre-wrap">${esc(a.body || '(tanpa teks)')}</div>
      <div class="tabs"><button class="on" data-t="analysis">Bedah iklan</button><button data-t="variations">5 konten mirip</button></div>
      <div id="tab-analysis" class="md">${a.analysis_status === 'pending' ? '<p class="muted">Sedang dibuat… (1-2 menit)</p>' : a.analysis ? md(a.analysis) : '<p class="muted">Belum ada. Klik "Bedah iklan".</p>'}</div>
      <div id="tab-variations" class="md" hidden>${a.variations_status === 'pending' ? '<p class="muted">Sedang ditulis… (1-3 menit)</p>' : a.variations ? md(a.variations) : '<p class="muted">Belum ada. Klik "Bikin 5 konten mirip".</p>'}</div>
    </div>
    <div class="dlg-foot">
      <div class="row"><a class="btn small" href="https://www.facebook.com/ads/library/?id=${esc(a.library_id)}" target="_blank" rel="noopener">Buka di Ad Library</a><button class="btn small danger" id="del">Hapus</button>${a.media_saved ? '' : '<button class="btn small" id="save">Simpan media permanen</button>'}</div>
      <div class="row"><button class="btn small" id="an">Bedah iklan</button><button class="btn small primary" id="va">Bikin 5 konten mirip</button><button class="btn small" id="close">Tutup</button></div>
    </div>`);
  d.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
    d.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#tab-analysis', d).hidden = b.dataset.t !== 'analysis';
    $('#tab-variations', d).hidden = b.dataset.t !== 'variations';
  }));
  $('#close', d).onclick = () => d.close();
  $('#an', d).onclick = async () => { await adAction(id, 'analyze', 'Bedah iklan sedang dibuat…', reload); d.close(); };
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
          <dt>Model berat</dt><dd class="mono">${esc(s.models.smart)} ${s.models.smartEnabled ? '<span class="chip accent">aktif</span>' : '<span class="chip warn">tidak aktif</span>'}</dd>
          <dt>Status Opus</dt><dd>${smart ? (smart.ok ? `OK · ${timeAgo(smart.at)}` : `<span class="chip danger">gagal</span> ${esc(smart.error || '')} · ${timeAgo(smart.at)}`) : 'Belum dipakai'}</dd>
          <dt>Dipakai untuk</dt><dd class="small">Opus: menulis konten, bedah iklan, 5 konten mirip, membaca foto, tugas berat tim. Sisanya Workers AI. Kalau Opus gagal/tidak aktif, otomatis pakai Workers AI.</dd>
        </dl>
        ${s.models.smartEnabled ? '' : '<p class="small muted" style="margin-top:10px">Aktifkan: isi GitHub Secret <code class="mono">ANTHROPIC_API_KEY</code>, lalu jalankan ulang workflow Deploy.</p>'}
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
