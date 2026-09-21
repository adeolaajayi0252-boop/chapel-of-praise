// RCCG Chapel of Praise — frontend application shell.
// Talks to the server over /api/*. Role is decided by the SERVER (from the
// signed session token) — this file never lets the user grant themselves
// a role; the old "pick your role from a dropdown" behaviour is gone.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const state = {
  tab: localStorage.copTab || 'home',
  token: localStorage.copToken || null,
  user: null,            // filled in from /api/auth/me once we have a token
  calendar: [],
  media: { livestreamUrl: '', items: [] },
  leadership: [],
  notifications: [],
  givingAccounts: null,
  requests: [],
  saved: JSON.parse(localStorage.copSaved || '[]'),
  authOpen: false,
  authMode: 'login'      // 'login' | 'register'
};

const $ = s => document.querySelector(s);
const app = $('#app');

function persist() {
  localStorage.copTab = state.tab;
  if (state.token) localStorage.copToken = state.token; else localStorage.removeItem('copToken');
  localStorage.copSaved = JSON.stringify(state.saved);
}

function toast(t) {
  const x = $('#toast');
  x.textContent = t;
  x.style.display = 'block';
  setTimeout(() => { x.style.display = 'none'; }, 2800);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function card(title, body, extra = '') {
  return `<section class="card"><h3>${title}</h3>${body}${extra}</section>`;
}

// ---------- API helper ----------
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || ('Request failed: ' + res.status));
    err.status = res.status;
    throw err;
  }
  return body;
}

async function loadSession() {
  if (!state.token) return;
  try {
    const { user } = await api('/auth/me');
    state.user = user;
  } catch {
    state.token = null;
    state.user = null;
    persist();
  }
}

async function loadPublicData() {
  const [calendar, media, leadership, notifications, givingAccounts] = await Promise.all([
    api('/calendar').catch(() => []),
    api('/media').catch(() => ({ livestreamUrl: '', items: [] })),
    api('/leadership').catch(() => []),
    api('/notifications').catch(() => []),
    api('/giving/accounts').catch(() => null)
  ]);
  state.calendar = calendar;
  state.media = media;
  state.leadership = leadership;
  state.notifications = notifications;
  state.givingAccounts = givingAccounts;
}

async function loadMemberData() {
  if (!state.user) return;
  try { state.requests = await api('/requests'); } catch { state.requests = []; }
}

// ---------- routing / render ----------
function nav() {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
}

const PAGES = {
  home, calendar: calendarPage, mediaPage, connect, college, profile, admin: adminPage
};

function render() {
  nav();
  const key = state.tab === 'media' ? 'mediaPage' : state.tab;
  (PAGES[key] || home)();
  renderNavExtras();
}

function renderNavExtras() {
  const navEl = document.querySelector('.nav');
  let adminBtn = navEl.querySelector('[data-tab="admin"]');
  if (state.user && state.user.role === 'admin') {
    if (!adminBtn) {
      adminBtn = document.createElement('button');
      adminBtn.dataset.tab = 'admin';
      adminBtn.textContent = 'Admin';
      adminBtn.onclick = () => setTab('admin');
      navEl.appendChild(adminBtn);
    }
    adminBtn.classList.toggle('active', state.tab === 'admin');
  } else if (adminBtn) {
    adminBtn.remove();
  }
}

function setTab(t) {
  if (t === 'admin' && (!state.user || state.user.role !== 'admin')) return;
  state.tab = t;
  persist();
  render();
}

// ---------- Home ----------
function home() {
  const notices = state.notifications;
  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <div class="eyebrow">The Redeemed Christian Church of God</div>
      <h1>Chapel of Praise, Ibadan</h1>
      <p>One church experience for worship, calendar, media, communication, giving, requests and ministry connection.</p>
      <img src="assets/church.jpg" alt="Chapel of Praise">
    </section>
    <div class="grid">
      ${card('Today', `<p class="muted">Your church schedule and reminders are brought together here.</p><button class="primary" onclick="setTab('calendar')">Open Calendar</button>`)}
      ${card('Announcements', `<p>${notices.length} announcement${notices.length === 1 ? '' : 's'} for you right now.</p><button class="ghost" onclick="setTab('connect')">Open Notifications</button>`)}
      ${card('Account', state.user
        ? `<p>Signed in as <b>${esc(state.user.name)}</b><br><span class="pill">${esc(state.user.role)}</span></p><button class="ghost" onclick="logout()">Log out</button>`
        : `<p class="muted">Sign in to save reminders, submit requests and use giving.</p><button class="primary" onclick="openAuth('login')">Log in</button> <button class="ghost" onclick="openAuth('register')">Create account</button>`)}
      ${card('Sunday Priority', `<div class="event" style="padding:10px"><b>Sunday Service</b><div>9:00 AM – 12:00 PM</div><span class="pill">HIGHEST PRIORITY</span></div>`)}
    </div>
    <div class="grid" style="margin-top:12px">
      ${card('Quick Actions', `<div class="list"><button class="ghost" onclick="setTab('media')">Sermons & Media</button><button class="ghost" onclick="setTab('connect')">Prayer / Church Requests</button><button class="ghost" onclick="setTab('college')">RCTC College</button></div>`)}
      ${card('Church Location', `<p class="muted">${esc(CONFIG_LOCATION)}</p><a class="primary" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONFIG_LOCATION)}">Directions</a>`)}
    </div>
  </div>`;
}

const CONFIG_LOCATION = 'Behind NNPC Filling Station, Adegbayi Area, Off Alakia, Ibadan, Oyo State, Nigeria';

// ---------- Calendar ----------
function calendarPage() {
  app.innerHTML = `<div class="wrap">
    <section class="hero"><div class="eyebrow">Stage 3</div><h1>Church Calendar</h1><p>Services, meetings, prayers and role-aware reminders.</p></section>
    <div class="list">${state.calendar.map(e => `
      <section class="card event">
        <div class="row"><div><h3>${esc(e.title)}</h3><span class="muted">Every ${DAY_NAMES[e.day]} · ${esc(e.start)}–${esc(e.end)}</span></div><span class="pill">${esc((e.priority || '').toUpperCase())}</span></div>
        <button class="ghost" data-action="remind" data-id="${esc(e.id)}">${state.user ? 'Remind me' : 'Log in to save reminder'}</button>
      </section>`).join('') || '<div class="card muted">No calendar events yet.</div>'}
    </div>
  </div>`;
}

async function remind(eventId) {
  if (!state.user) { openAuth('login'); return; }
  try {
    await api('/reminders', { method: 'POST', body: JSON.stringify({ eventId }) });
    toast('Reminder saved to your account');
  } catch (e) { toast(e.message); }
}

// ---------- Media ----------
function mediaPage() {
  const m = state.media;
  app.innerHTML = `<div class="wrap">
    <section class="hero"><div class="eyebrow">Stage 4</div><h1>Media & Sermons</h1><p>Approved sermons, worship resources and livestream entry points.</p>
      <button class="primary" onclick="watchLive()">Watch Live</button></section>
    <div class="list">${(m.items || []).map(x => `
      <section class="card">
        <span class="pill">${esc(x.type || 'media')}</span>
        <h3>${esc(x.title)}</h3>
        <p class="muted">${esc(x.theme || x.speaker || '')} ${x.scripture ? '· ' + esc(x.scripture) : ''} ${x.date ? '· ' + esc(x.date) : ''}</p>
        ${x.url ? `<button class="primary" data-action="play-media" data-url="${esc(x.url)}">Play</button>` : '<p class="muted">Recording URL will be supplied by the approved media team.</p>'}
        <button class="ghost" data-action="save-media" data-id="${esc(x.id)}">${state.saved.includes(x.id) ? 'Saved' : 'Save'}</button>
      </section>`).join('') || '<div class="card muted">No media items yet.</div>'}
    </div>
  </div>`;
}

function saveMedia(id) {
  if (!state.saved.includes(id)) state.saved.push(id);
  persist();
  toast('Media saved on this device');
  render();
}

function watchLive() {
  if (state.media.livestreamUrl) window.open(state.media.livestreamUrl, '_blank');
  else toast('Livestream destination is awaiting the church-approved URL.');
}

// ---------- Connect (auth, prayer/service requests, giving, notifications) ----------
function connect() {
  if (!state.user) {
    app.innerHTML = `<div class="wrap">
      <section class="hero"><div class="eyebrow">Connect & Serve</div><h1>Sign in required</h1><p>Prayer requests, church service requests, giving and reminders require an account so the church can follow up with you.</p>
      <button class="primary" onclick="openAuth('login')">Log in</button> <button class="ghost" onclick="openAuth('register')">Create account</button></section>
    </div>`;
    return;
  }
  app.innerHTML = `<div class="wrap">
    <section class="hero"><div class="eyebrow">Stage 5 + Stage 6</div><h1>Connect & Serve</h1><p>Communication, prayer and church service requests in one member area.</p></section>
    <div class="grid">
      ${card('Prayer Request', `<form class="form" onsubmit="submitRequest(event,'Prayer Request')"><textarea name="message" rows="4" placeholder="Share your prayer request" required></textarea><label><input type="checkbox" name="private" checked> Keep this request private</label><button class="primary">Submit Prayer Request</button></form>`)}
      ${card('Church Service Request', `<form class="form" onsubmit="submitRequest(event,'Church Service Request')"><select name="requestType"><option>Pastoral Follow-up</option><option>Counselling</option><option>Home Visit</option><option>Welfare Assistance</option><option>Other</option></select><textarea name="message" rows="3" placeholder="Tell the church what you need" required></textarea><button class="primary">Submit Request</button></form>`)}
      ${card('Giving', givingBody())}
      ${card('Your Requests', requestHistoryBody())}
    </div>
  </div>`;
}

function givingBody() {
  const accts = state.givingAccounts;
  const hasAccounts = accts && Array.isArray(accts.accounts) && accts.accounts.length > 0;
  return `<p class="muted">Giving categories are configured by the church. Payment credentials are not stored in this app.</p>
    <select id="givingType"><option>Tithe</option><option>Offering</option><option>Thanksgiving</option><option>Missions</option><option>Building/Project</option><option>Welfare</option><option>Other</option></select>
    <button class="primary" style="margin-top:10px" onclick="startGiving()">Continue to Giving</button>
    <div style="margin-top:10px" class="muted">${hasAccounts
      ? accts.accounts.map(a => `<div>${esc(a.label || 'Account')}: ${esc(a.bank || '')} ${esc(a.number || '')}</div>`).join('')
      : esc((accts && accts.note) || 'Account details have not been added yet.')}</div>`;
}

function requestHistoryBody() {
  if (!state.requests.length) return '<p class="muted">No requests submitted yet.</p>';
  return '<div class="list">' + state.requests.map(r => `<div class="card"><b>${esc(r.type)}</b><p class="muted">${esc(r.status)} · ${new Date(r.createdAt).toLocaleDateString()}</p></div>`).join('') + '</div>';
}

async function submitRequest(ev, type) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await api('/requests', {
      method: 'POST',
      body: JSON.stringify({ type, message: f.get('message'), private: f.get('private') === 'on' })
    });
    toast(type + ' submitted');
    ev.target.reset();
    await loadMemberData();
    render();
  } catch (e) {
    toast(e.message);
  }
}

async function startGiving() {
  const category = $('#givingType') ? $('#givingType').value : 'Other';
  try {
    const res = await api('/giving/intent', { method: 'POST', body: JSON.stringify({ category }) });
    toast(res.note || 'Giving intent recorded.');
  } catch (e) { toast(e.message); }
}

async function enablePush() {
  if (!('Notification' in window)) { toast('Browser notifications are unavailable'); return; }
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Notifications enabled' : 'Notification permission not granted');
}

// ---------- RCTC ----------
function college() {
  const collegeUrl = 'https://www.rcbc.edu.ng/';
  app.innerHTML = `<div class="wrap">
    <section class="hero"><div class="eyebrow">Stage 7 · Official external source</div><h1>The Redeemed Christian Theological College (RCTC)</h1>
      <p>Connect directly to the official college portal for programmes, admissions, applications and college information. Chapel of Praise administrators do not maintain this content.</p>
      <a class="primary" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="${collegeUrl}">Open Official RCTC Portal</a></section>
    <div class="grid">
      ${card('College Portal', `<p class="muted">The official portal currently resolves at the legacy <b>rcbc.edu.ng</b> domain while the institution has adopted the RCTC name.</p><a class="ghost" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="${collegeUrl}">Visit Portal</a>`)}
      ${card('What you can access', `<ul><li>Schools and programmes</li><li>Theology and pastoral ministry programmes</li><li>Admissions/application entry points</li><li>Official college information</li><li>College updates maintained by RCTC</li></ul>`)}
      ${card('Content ownership', `<p class="muted">College information is externally sourced. Church admins can control the link and integration settings, but should not edit RCTC academic content inside the Chapel of Praise CMS.</p>`)}
    </div>
  </div>`;
}

// ---------- Profile ----------
function profile() {
  if (!state.user) {
    app.innerHTML = `<div class="wrap"><section class="hero"><div class="eyebrow">Profile</div><h1>Sign in</h1><p>Create an account or log in to view your profile.</p>
      <button class="primary" onclick="openAuth('login')">Log in</button> <button class="ghost" onclick="openAuth('register')">Create account</button></section></div>`;
    return;
  }
  app.innerHTML = `<div class="wrap">
    <section class="hero"><div class="eyebrow">Member experience</div><h1>Profile & Access</h1><p>Your role determines what restricted church information is displayed to you.</p></section>
    ${card('Account', `<p><b>${esc(state.user.name)}</b><br>${esc(state.user.email)}</p><p class="muted">Role: <span class="pill">${esc(state.user.role)}</span></p><p class="muted">Role changes are made by a church admin — this is no longer a self-service setting.</p><button class="ghost" onclick="logout()">Log out</button>`)}
    <div class="grid" style="margin-top:12px">
      ${card('Departments', `<p>Prayer · Choir · Media · Ushering/Protocol · Welfare/Visitation · Sanitation · Children/DTCE</p>`)}
      ${card('Leadership', state.leadership.map(l => `${esc(l.role)}: ${esc(l.name)}`).join('<br>') || '<p class="muted">Not yet configured.</p>')}
    </div>
  </div>`;
}

async function logout() {
  state.token = null;
  state.user = null;
  state.requests = [];
  persist();
  if (state.tab === 'admin') state.tab = 'home';
  render();
  toast('Logged out');
}

// ---------- Auth modal ----------
function openAuth(mode) {
  state.authMode = mode;
  state.authOpen = true;
  renderAuthModal();
}
function closeAuth() {
  state.authOpen = false;
  document.getElementById('authModal')?.remove();
}
function renderAuthModal() {
  document.getElementById('authModal')?.remove();
  const isLogin = state.authMode === 'login';
  const el = document.createElement('div');
  el.id = 'authModal';
  el.className = 'modal';
  el.innerHTML = `<div class="card">
    <h3>${isLogin ? 'Log in' : 'Create your account'}</h3>
    <form class="form" id="authForm">
      ${isLogin ? '' : '<input name="name" placeholder="Full name" required>'}
      <input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password (min 8 characters)" minlength="8" required>
      <button class="primary">${isLogin ? 'Log in' : 'Create account'}</button>
    </form>
    <p class="muted" style="margin-top:10px">${isLogin ? "Don't have an account?" : 'Already have an account?'}
      <a href="#" onclick="event.preventDefault();openAuth('${isLogin ? 'register' : 'login'}')">${isLogin ? 'Create one' : 'Log in'}</a>
    </p>
    <button class="ghost" onclick="closeAuth()" style="margin-top:6px">Cancel</button>
  </div>`;
  document.body.appendChild(el);
  document.getElementById('authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const payload = { email: f.get('email'), password: f.get('password') };
    if (!isLogin) payload.name = f.get('name');
    try {
      const res = await api(isLogin ? '/auth/login' : '/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      state.token = res.token;
      state.user = res.user;
      persist();
      closeAuth();
      toast(isLogin ? 'Logged in' : 'Account created');
      await loadMemberData();
      render();
    } catch (e) {
      toast(e.message);
    }
  };
}

// ---------- Admin panel ----------
let adminData = { users: [], requests: [] };

async function loadAdminData() {
  const [users, requests] = await Promise.all([
    api('/admin/users').catch(() => []),
    api('/admin/requests').catch(() => [])
  ]);
  adminData = { users, requests };
}

function adminPage() {
  app.innerHTML = `<div class="wrap"><section class="hero"><div class="eyebrow">Stage 7 · Admin</div><h1>Admin Panel</h1><p>Loading…</p></section></div>`;
  loadAdminData().then(renderAdminPage);
}

function renderAdminPage() {
  app.innerHTML = `<div class="wrap">
    <section class="hero"><div class="eyebrow">Stage 7 · Admin</div><h1>Admin Panel</h1><p>Manage members, requests, sermons, events, notifications and giving accounts.</p></section>

    ${card('Add a sermon / media item', `<form class="form" onsubmit="adminAddMedia(event)">
      <input name="title" placeholder="Title" required>
      <select name="type"><option value="audio">Audio</option><option value="video">Video</option></select>
      <input name="speaker" placeholder="Speaker">
      <input name="scripture" placeholder="Scripture reference">
      <input name="date" type="date">
      <input name="url" placeholder="Recording URL (leave blank if not yet available)">
      <button class="primary">Add Media</button>
    </form>`)}

    ${card('Set livestream URL', `<form class="form" onsubmit="adminSetLivestream(event)">
      <input name="url" placeholder="https://..." value="${esc(state.media.livestreamUrl || '')}">
      <button class="primary">Save</button>
    </form>`)}

    ${card('Giving accounts', `<form class="form" onsubmit="adminSetGiving(event)">
      <textarea name="accountsJson" rows="4" placeholder='[{"label":"Church Account","bank":"...","number":"..."}]'>${esc(JSON.stringify((state.givingAccounts && state.givingAccounts.accounts) || [], null, 0))}</textarea>
      <p class="muted">Enter accounts as JSON — one object per account with label, bank, number.</p>
      <button class="primary">Save Accounts</button>
    </form>`)}

    ${card('Members & Roles (' + adminData.users.length + ')', `<div class="list">${adminData.users.map(u => `
      <div class="card row">
        <div><b>${esc(u.name)}</b><div class="muted">${esc(u.email)}</div></div>
        <select data-action="set-role" data-id="${esc(u.id)}">
          ${['member', 'worker', 'minister', 'pastor', 'admin'].map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>`).join('') || '<p class="muted">No members yet.</p>'}</div>`)}

    ${card('Prayer & Service Requests (' + adminData.requests.length + ')', `<div class="list">${adminData.requests.map(r => `
      <div class="card">
        <div class="row"><b>${esc(r.type)}</b><span class="pill">${esc(r.status)}</span></div>
        <p>${esc(r.message || r.category || '')}</p>
        <select data-action="set-request-status" data-id="${esc(r.id)}">
          ${['received', 'in-progress', 'completed'].map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>`).join('') || '<p class="muted">No requests yet.</p>'}</div>`)}
  </div>`;
}

async function adminAddMedia(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await api('/admin/media', {
      method: 'POST',
      body: JSON.stringify({
        title: f.get('title'), type: f.get('type'), speaker: f.get('speaker'),
        scripture: f.get('scripture'), date: f.get('date'), url: f.get('url')
      })
    });
    toast('Media added');
    state.media = await api('/media');
    render();
  } catch (e) { toast(e.message); }
}

async function adminSetLivestream(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await api('/admin/livestream', { method: 'PUT', body: JSON.stringify({ url: f.get('url') }) });
    toast('Livestream URL saved');
    state.media = await api('/media');
  } catch (e) { toast(e.message); }
}

async function adminSetGiving(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  let accounts;
  try { accounts = JSON.parse(f.get('accountsJson') || '[]'); }
  catch { toast('Accounts must be valid JSON'); return; }
  try {
    await api('/admin/giving-accounts', { method: 'PUT', body: JSON.stringify({ note: 'Configured by admin', accounts }) });
    toast('Giving accounts saved');
    state.givingAccounts = await api('/giving/accounts');
  } catch (e) { toast(e.message); }
}

async function adminSetRole(userId, role) {
  try {
    await api('/admin/users/' + userId, { method: 'PATCH', body: JSON.stringify({ role }) });
    toast('Role updated');
    await loadAdminData();
    renderAdminPage();
  } catch (e) { toast(e.message); }
}

async function adminSetRequestStatus(id, status) {
  try {
    await api('/admin/requests/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast('Status updated');
    await loadAdminData();
    renderAdminPage();
  } catch (e) { toast(e.message); }
}

// ---------- delegated event handling ----------
// Buttons/selects that carry dynamic, admin- or server-supplied data (URLs,
// IDs) use data-action/data-id/data-url attributes and are wired up here,
// rather than being string-interpolated into inline onclick="" attributes.
// Interpolating untrusted text into an inline event-handler attribute is
// unsafe even when HTML-escaped, because the browser HTML-decodes the
// attribute value before handing it to the JS parser — a value containing
// a quote character could break out of the intended string literal.
// Delegated listeners avoid that class of bug entirely.
app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'remind') remind(el.dataset.id);
  else if (action === 'play-media') window.open(el.dataset.url, '_blank');
  else if (action === 'save-media') saveMedia(el.dataset.id);
});
app.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'set-role') adminSetRole(el.dataset.id, el.value);
  else if (action === 'set-request-status') adminSetRequestStatus(el.dataset.id, el.value);
});

// ---------- boot ----------
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').onclick = async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; $('#installBtn').hidden = true; }
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async function boot() {
  app.innerHTML = '<div class="wrap"><p class="muted">Loading…</p></div>';
  await loadSession();
  await loadPublicData();
  if (state.user) await loadMemberData();
  render();
})();
