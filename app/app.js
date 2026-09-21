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
function getNextService(){
  const now=new Date(); let best=null,bestMs=Infinity;
  for(const e of state.calendar){const target=new Date(now);const delta=(e.day-now.getDay()+7)%7;const [hh,mm]=(e.start||'09:00').split(':').map(Number);target.setDate(now.getDate()+delta);target.setHours(hh||0,mm||0,0,0);if(target<=now)target.setDate(target.getDate()+7);const ms=target-now;if(ms<bestMs){best={...e,target};bestMs=ms;}}
  if(!best){const target=new Date(now);target.setDate(now.getDate()+((7-now.getDay())%7));target.setHours(9,0,0,0);if(target<=now)target.setDate(target.getDate()+7);best={title:'Sunday Service',start:'09:00',target};}
  return best;
}
function formatCountdown(ms){ms=Math.max(0,ms);const sec=Math.floor(ms/1000);return{days:Math.floor(sec/86400),hours:Math.floor(sec%86400/3600),mins:Math.floor(sec%3600/60),secs:sec%60};}
function updateCountdown(target){const draw=()=>{const c=document.querySelector('#countdown');if(!c)return;const t=formatCountdown(target-new Date());c.innerHTML=[['days','Days'],['hours','Hours'],['mins','Mins'],['secs','Secs']].map(([k,l])=>`<div class="time-box"><strong>${String(t[k]).padStart(2,'0')}</strong><span>${l}</span></div>`).join('');};draw();clearInterval(window.copCountdown);window.copCountdown=setInterval(draw,1000);}
function home(){
 const notices=state.notifications||[],next=getNextService(),notice=notices[0];
 app.innerHTML=`<div class="wrap">
  <section class="hero hero-home"><div class="eyebrow">Chapel of Praise · Ibadan</div><h1>Together in Worship<em>Together in His Presence</em></h1><p>A place to belong, grow and make a difference.</p><img src="assets/church.jpg" alt="Chapel of Praise"><div class="hero-dots"><span class="active"></span><span></span><span></span></div></section>
  <section class="next-service"><div class="next-service-head"><div class="service-icon">▣</div><div><h3>Next Service</h3><p>${esc(next.title)} · Worship · Word · Fellowship</p></div><div class="arrow">›</div></div><div class="countdown" id="countdown"></div></section>
  <div class="quick-grid"><button class="quick" onclick="setTab('connect')"><span class="quick-icon">♧</span><small>Prayer</small></button><button class="quick" onclick="setTab('media')"><span class="quick-icon">▶</span><small>Sermons</small></button><button class="quick" onclick="toast('Bible resources will appear here as they are connected.')"><span class="quick-icon">▤</span><small>Bible</small></button><button class="quick" onclick="startGiving()"><span class="quick-icon">♥</span><small>Giving</small></button></div>
  <div class="section-head"><h2>Announcements</h2><button onclick="setTab('connect')">See all</button></div>
  <section class="card announcement">${notice?`<img src="assets/church.jpg" alt="Announcement"><div><h3>${esc(notice.title||'Be Part of Our Church Family')}</h3><p>${esc(notice.message||notice.body||'Join us for a time of fellowship, prayer and the Word.')}</p></div>`:`<img src="assets/church.jpg" alt="Chapel of Praise"><div><h3>Be Part of Our Church Family</h3><p>Join us for worship, prayer, fellowship and the Word.</p></div>`}<div class="arrow">›</div></section>
  <div class="section-head"><h2>Explore Chapel of Praise</h2></div><div class="more-list"><button class="more-item" onclick="setTab('calendar')"><span class="mi">▣</span><span><b>Church Events</b><small>Services, meetings and programmes</small></span><span class="arrow">›</span></button><button class="more-item" onclick="setTab('college')"><span class="mi">▤</span><span><b>RCTC Bible College</b><small>Official college portal</small></span><span class="arrow">›</span></button><button class="more-item" onclick="setTab('profile')"><span class="mi">♙</span><span><b>My Profile</b><small>${state.user?'Manage your account':'Sign in or create an account'}</small></span><span class="arrow">›</span></button></div>
 </div>`;updateCountdown(next.target);
}

const CONFIG_LOCATION='Behind NNPC Filling Station, Adegbayi Area, Off Alakia, Ibadan, Oyo State, Nigeria';

// ---------- Calendar ----------
function calendarPage(){app.innerHTML=`<div class="wrap"><div class="page-title"><button class="back" onclick="setTab('home')">‹</button><h1>Events</h1></div><div class="tabs"><button class="active">Upcoming</button><button>Past</button><button>All</button></div><div class="list">${state.calendar.map(e=>`<section class="list-row event"><div class="thumb" style="display:grid;place-items:center;font-size:25px;color:var(--brand)">▣</div><div style="flex:1"><h3>${esc(e.title)}</h3><p>${DAY_NAMES[e.day]} · ${esc(e.start)}–${esc(e.end)}</p></div><button class="arrow" data-action="remind" data-id="${esc(e.id)}">›</button></section>`).join('')||'<div class="card muted">No calendar events yet.</div>'}</div></div>`;}
async function remind(eventId){if(!state.user){openAuth('login');return;}try{await api('/reminders',{method:'POST',body:JSON.stringify({eventId})});toast('Reminder saved to your account');}catch(e){toast(e.message);}}

// ---------- Media ----------
function mediaPage(){const m=state.media;app.innerHTML=`<div class="wrap"><div class="page-title"><button class="back" onclick="setTab('home')">‹</button><h1>Sermons</h1></div><div class="tabs"><button class="active">Latest</button><button>Popular</button><button>Categories</button></div><section class="hero" style="margin-bottom:13px"><div class="eyebrow">Grow spiritually</div><h1 style="font-size:28px">The Word for every season</h1><p>Listen to approved sermons, teachings and worship resources.</p><button class="primary" onclick="watchLive()">Watch Live</button></section><div class="list">${(m.items||[]).map(x=>`<section class="list-row"><div class="thumb" style="display:grid;place-items:center;background:var(--brand);color:#fff;font-size:24px">▶</div><div style="flex:1"><h3>${esc(x.title)}</h3><p>${esc(x.theme||x.speaker||'Sunday Service')} ${x.scripture?'· '+esc(x.scripture):''}</p>${x.url?`<small class="pill">${esc(x.type||'Media')}</small>`:''}</div><button class="arrow" data-action="play-media" data-url="${esc(x.url||'')}">›</button></section>`).join('')||'<div class="card muted">No media items yet.</div>'}</div></div>`;}
function saveMedia(id){if(!state.saved.includes(id))state.saved.push(id);persist();toast('Media saved on this device');render();}
function watchLive(){if(state.media.livestreamUrl)window.open(state.media.livestreamUrl,'_blank');else toast('Livestream destination is awaiting the church-approved URL.');}

// ---------- Connect (auth, prayer/service requests, giving, notifications) ----------
function connect(){if(!state.user){app.innerHTML=`<div class="wrap"><div class="page-title"><button class="back" onclick="setTab('home')">‹</button><h1>Prayer</h1></div><section class="hero"><div class="eyebrow">Let's Pray Together</div><h1 style="font-size:30px">Share your prayer needs</h1><p>Join others in faith and stay connected with the Chapel of Praise family.</p></section><div class="more-list"><button class="more-item" onclick="openAuth('login')"><span class="mi">♧</span><span><b>Submit a Prayer Request</b><small>Sign in to share your prayer need</small></span><span class="arrow">›</span></button><button class="more-item" onclick="openAuth('register')"><span class="mi">♙</span><span><b>Create an Account</b><small>Save reminders and follow up requests</small></span><span class="arrow">›</span></button></div></div>`;return;}app.innerHTML=`<div class="wrap"><div class="page-title"><button class="back" onclick="setTab('home')">‹</button><h1>Prayer</h1></div><section class="hero"><div class="eyebrow">Let's Pray Together</div><h1 style="font-size:30px">Share your prayer needs</h1><p>Our church family is here to pray with you.</p></section><div class="grid">${card('Submit a Request',`<form class="form" onsubmit="submitRequest(event,'Prayer Request')"><textarea name="message" rows="4" placeholder="Share your prayer request" required></textarea><label><input type="checkbox" name="private" checked> Keep this request private</label><button class="primary">Submit Prayer Request</button></form>`)}${card('Prayer Wall',`<p class="muted">View and pray for others through approved church requests.</p><button class="ghost" onclick="toast('Prayer wall is ready for approved requests.')">Open Prayer Wall</button>`)}${card('Giving',givingBody())}${card('Your Requests',requestHistoryBody())}</div></div>`;}

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
function college(){const collegeUrl='https://www.rcbc.edu.ng/';app.innerHTML=`<div class="wrap"><div class="page-title"><button class="back" onclick="setTab('profile')">‹</button><h1>RCTC</h1></div><section class="card rctc-card"><img class="rctc-logo" src="assets/rctc-logo.jpg" alt="The Redeemed Christian Bible College logo"><div><span class="pill">Official college portal</span><h3>The Redeemed Christian Theological College</h3><p class="muted">Formerly Redeemed Christian Bible College (RCBC).</p></div></section><section class="hero" style="margin-top:13px"><div class="eyebrow">Bible College</div><h1 style="font-size:29px">Grow in the Word</h1><p>Connect to the official RCTC portal for programmes, admissions, applications and college information.</p><a class="primary" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="${collegeUrl}">Open Official RCTC Portal</a></section><div class="grid">${card('What you can access',`<p class="muted">Schools and programmes · Theology and pastoral ministry · Admissions and applications · Official college information.</p>`)}${card('Content ownership',`<p class="muted">College information is externally sourced. Chapel of Praise administrators do not maintain RCTC academic content inside the church CMS.</p>`)}</div></div>`;}

// ---------- Profile ----------
function profile(){app.innerHTML=`<div class="wrap"><div class="page-title"><h1>More</h1></div><div class="more-list"><button class="more-item" onclick="${state.user?"toast('Profile details are shown below.')":"openAuth('login')"}"><span class="mi">♙</span><span><b>My Profile</b><small>${state.user?esc(state.user.name):'Sign in and manage your account'}</small></span><span class="arrow">›</span></button><button class="more-item" onclick="setTab('college')"><span class="mi">▤</span><span><b>RCTC Bible College</b><small>Programmes, admissions and official portal</small></span><span class="arrow">›</span></button><button class="more-item" onclick="toast('Announcements are shown on Home.')"><span class="mi">♢</span><span><b>Announcements</b><small>Latest church news and updates</small></span><span class="arrow">›</span></button><button class="more-item" onclick="toast('Gallery is ready for approved church photos and videos.')"><span class="mi">▧</span><span><b>Gallery</b><small>Photos and videos</small></span><span class="arrow">›</span></button><button class="more-item" onclick="toast('Bible resources will appear here as they are connected.')"><span class="mi">▤</span><span><b>Bible</b><small>Read, study and grow</small></span><span class="arrow">›</span></button><button class="more-item" onclick="startGiving()"><span class="mi">♥</span><span><b>Giving</b><small>Tithe, offering and more</small></span><span class="arrow">›</span></button><button class="more-item" onclick="toast('App preferences are managed by your device and church configuration.')"><span class="mi">⚙</span><span><b>Settings</b><small>App preferences</small></span><span class="arrow">›</span></button></div>${state.user?`<section class="card" style="margin-top:12px"><h3>Account</h3><p><b>${esc(state.user.name)}</b><br>${esc(state.user.email)}</p><p class="muted">Role: <span class="pill">${esc(state.user.role)}</span></p><button class="ghost" onclick="logout()">Log out</button></section>`:''}</div>`;}

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

    ${card('Content Management Centre', `<div class="quick-grid"><button class="quick" onclick="toast('Events manager ready for connection')"><span class="quick-icon">▣</span><small>Events</small></button><button class="quick" onclick="toast('Announcements manager ready for connection')"><span class="quick-icon">!</span><small>Announcements</small></button><button class="quick" onclick="toast('Homepage controls ready for connection')"><span class="quick-icon">⌂</span><small>Homepage</small></button><button class="quick" onclick="toast('RCTC controls ready for connection')"><span class="quick-icon">▤</span><small>RCTC</small></button></div>`)}

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
  else if (action === 'play-media') { if (el.dataset.url) window.open(el.dataset.url, '_blank'); else toast('This sermon does not have a recording URL yet.'); }
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
