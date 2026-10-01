// RCCG Chapel of Praise — application server.
//
// Built on Node's built-in `http` and `fetch` only (no express, no cors,
// no database driver package) — authored and tested in an offline sandbox
// with no package registry access, and also just a legitimate way to run
// a small app with minimal moving parts. Persistent storage lives in a
// Supabase Postgres project, accessed over its REST API (see db.js) —
// this matters because Render's free web service tier has no persistent
// disk, so anything written to the local filesystem is lost on every
// restart. See docs/DEPLOYMENT.md for the required Supabase setup and
// environment variables.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDB, update, nextId, storageConfigured } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, getBearerToken } from './auth.js';
import { activeProvider, createCheckoutSession, verifyTransaction, verifyWebhookSignature } from './payments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const CONFIG_DIR = path.join(ROOT, 'config');
const PORT = process.env.PORT || 4170;

const ROLES = ['member', 'worker', 'minister', 'pastor', 'admin'];

// ---------- bootstrap: seed config into the DB on first run, create admin ----------
function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function bootstrap() {
  if (!storageConfigured()) {
    console.log('========================================================');
    console.log('WARNING: SUPABASE_URL / SUPABASE_SERVICE_KEY are not set.');
    console.log('The server will start, but every request that needs to');
    console.log('read or write data will fail until these are configured.');
    console.log('See docs/DEPLOYMENT.md for setup steps.');
    console.log('========================================================');
    return;
  }

  await update(db => {
    if (!db.media || db.media.length === 0) {
      try {
        const m = readConfig('media.json');
        db.media = Array.isArray(m) ? m : (m.items || []);
        if (!db.livestreamUrl && m.livestreamUrl) db.livestreamUrl = m.livestreamUrl;
      } catch { db.media = db.media || []; }
    }
    if (db.livestreamUrl === undefined) db.livestreamUrl = '';
    if (!db.events || db.events.length === 0) {
      try {
        const cal = readConfig('calendar.json');
        const raw = Array.isArray(cal) ? cal : (cal.events || []);
        db.events = raw.map(e => ({ ...e, aud: e.aud || e.audience || ['all'] }));
      } catch { db.events = db.events || []; }
    }
    if (!db._leadershipSeeded) {
      try {
        const cfg = readConfig('app-config.json');
        if (Array.isArray(cfg.leadership)) {
          db.leadership = cfg.leadership;
          db._leadershipSeeded = true;
        }
      } catch { /* keep default */ }
    }
    if (!db._rctcSeeded) {
      try {
        const rctc = readConfig('rctc.json');
        db.rctc = { ...db.rctc, ...rctc };
        db._rctcSeeded = true;
      } catch { /* keep default */ }
    }
    return db;
  });

  const db = await readDB();
  const hasAdmin = (db.users || []).some(u => u.role === 'admin');
  if (!hasAdmin) {
    const email = process.env.ADMIN_EMAIL || 'admin@chapelofpraise.local';
    const password = process.env.ADMIN_PASSWORD || randomPassword();
    const { salt, hash } = hashPassword(password);
    await update(db2 => {
      db2.users.push({
        id: nextId(), name: 'Administrator', email, salt, hash,
        role: 'admin', createdAt: new Date().toISOString()
      });
      return db2;
    });
    const usedGenerated = !process.env.ADMIN_PASSWORD;
    console.log('========================================================');
    console.log('No admin account existed — one was created automatically.');
    console.log('Admin email   :', email);
    if (usedGenerated) {
      console.log('Admin password:', password, '(auto-generated — log in and change it, or set ADMIN_EMAIL/ADMIN_PASSWORD env vars before first run instead)');
    } else {
      console.log('Admin password: (taken from ADMIN_PASSWORD env var)');
    }
    console.log('This account is stored in Supabase, so it will persist across restarts.');
    console.log('========================================================');
  }
}

// ---------- small helpers ----------
function send(res, status, body, headers = {}) {
  const isJSON = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJSON ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Content-Type': isJSON ? 'application/json' : (headers['Content-Type'] || 'text/plain'),
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function currentUser(req) {
  const token = getBearerToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;
  const db = await readDB();
  const user = db.users.find(u => u.id === payload.uid);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function requireAuth(req, res) {
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'Authentication required' }); return null; }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') { send(res, 403, { error: 'Admin access required' }); return null; }
  return user;
}

function isValidEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// ---------- simple in-memory rate limiting for auth endpoints ----------
const rateBuckets = new Map();
function rateLimited(req, max = 8, windowMs = 60_000) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const list = (rateBuckets.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now);
  rateBuckets.set(ip, list);
  return list.length > max;
}

// ---------- route table ----------
const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regex = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, m => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, paramNames, handler });
}

route('GET', '/api/health', (req, res) => send(res, 200, { ok: true, app: 'RCCG Chapel of Praise', stage: 7, storage: storageConfigured() ? 'configured' : 'not-configured' }));

route('GET', '/api/config', (req, res) => {
  send(res, 200, JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'app-config.json'), 'utf8')));
});

// RCTC info is now admin-editable, stored in the database (seeded once
// from config/rctc.json at bootstrap) rather than served as a static file,
// so an admin's edits actually take effect.
route('GET', '/api/rctc', async (req, res) => send(res, 200, (await readDB()).rctc));
route('PUT', '/api/admin/rctc', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => { db.rctc = { ...db.rctc, ...body }; return db.rctc; });
  send(res, 200, result);
});

// Homepage hero text is admin-editable the same way.
route('GET', '/api/homepage', async (req, res) => send(res, 200, (await readDB()).homepage));
route('PUT', '/api/admin/homepage', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => { db.homepage = { ...db.homepage, ...body }; return db.homepage; });
  send(res, 200, result);
});

// ---- calendar / events (public read; role-filtered) ----
route('GET', '/api/calendar', async (req, res) => {
  const user = await currentUser(req);
  const role = user ? user.role : 'guest';
  const db = await readDB();
  const visible = db.events.filter(e => {
    const aud = e.aud || ['all'];
    return aud.includes('all') || aud.includes(role) || role === 'admin';
  });
  send(res, 200, visible);
});
route('POST', '/api/admin/events', (req, res) => handleAdminCreate(req, res, 'events'));
route('PUT', '/api/admin/events/:id', (req, res, p) => handleAdminUpdate(req, res, 'events', p.id));
route('DELETE', '/api/admin/events/:id', (req, res, p) => handleAdminDelete(req, res, 'events', p.id));

// ---- media / sermons (public read; admin-managed) ----
route('GET', '/api/media', async (req, res) => {
  const db = await readDB();
  send(res, 200, { livestreamUrl: db.livestreamUrl || '', items: db.media });
});
route('POST', '/api/admin/media', (req, res) => handleAdminCreate(req, res, 'media'));
route('PUT', '/api/admin/media/:id', (req, res, p) => handleAdminUpdate(req, res, 'media', p.id));
route('DELETE', '/api/admin/media/:id', (req, res, p) => handleAdminDelete(req, res, 'media', p.id));
route('PUT', '/api/admin/livestream', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => { db.livestreamUrl = body.url || ''; return db.livestreamUrl; });
  send(res, 200, { livestreamUrl: result });
});

// ---- notifications / announcements ----
route('GET', '/api/notifications', async (req, res) => {
  const user = await currentUser(req);
  const role = user ? user.role : 'guest';
  const db = await readDB();
  const visible = db.notifications.filter(n => {
    const aud = n.aud || ['all'];
    return aud.includes('all') || aud.includes(role) || role === 'admin';
  });
  send(res, 200, visible);
});
route('POST', '/api/admin/notifications', (req, res) => handleAdminCreate(req, res, 'notifications'));
route('PUT', '/api/admin/notifications/:id', (req, res, p) => handleAdminUpdate(req, res, 'notifications', p.id));
route('DELETE', '/api/admin/notifications/:id', (req, res, p) => handleAdminDelete(req, res, 'notifications', p.id));

// ---- giving ----
route('GET', '/api/giving/provider-status', (req, res) => {
  send(res, 200, { provider: activeProvider(), configured: !!activeProvider() });
});
route('GET', '/api/giving/accounts', async (req, res) => send(res, 200, (await readDB()).givingAccounts));
route('PUT', '/api/admin/giving-accounts', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => { db.givingAccounts = body; return db.givingAccounts; });
  send(res, 200, result);
});
route('POST', '/api/giving/intent', async (req, res) => {
  const user = await requireAuth(req, res); if (!user) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const provider = activeProvider();
  const reference = 'giving-' + nextId();
  const category = body?.category || 'Other';

  const record = await update(db => {
    const x = {
      id: nextId(), memberId: user.id, type: 'Giving Intent', category, reference,
      amountNaira: body?.amountNaira || null, createdAt: new Date().toISOString(),
      status: provider ? 'pending-payment' : 'awaiting-payment-provider-configuration'
    };
    db.requests.push(x);
    return x;
  });

  if (!provider) {
    return send(res, 202, { ok: true, ...record, note: 'No live payment provider is configured yet. This intent was recorded but no money has moved.' });
  }

  if (!body?.email || !body?.amountNaira || body.amountNaira <= 0) {
    return send(res, 400, { error: 'A valid email and a positive amountNaira are required to start a payment.' });
  }

  const host = req.headers['x-forwarded-proto'] && req.headers['x-forwarded-host']
    ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`
    : `http://${req.headers.host}`;

  const session = await createCheckoutSession({
    provider, email: body.email, amountNaira: body.amountNaira, reference,
    category, callbackUrl: host + '/#giving-complete'
  });

  if (!session.ok) {
    await update(db => { const r = db.requests.find(x => x.id === record.id); if (r) r.status = 'payment-init-failed'; return db; });
    return send(res, 502, { error: session.error });
  }
  send(res, 202, { ok: true, id: record.id, reference, checkoutUrl: session.authorizationUrl });
});

route('POST', '/api/giving/webhook/:provider', async (req, res, p) => {
  let raw = '';
  await new Promise(resolve => { req.on('data', c => raw += c); req.on('end', resolve); });
  const provider = p.provider;
  const validSig = verifyWebhookSignature({ provider, rawBody: raw, headers: req.headers });
  if (!validSig) return send(res, 401, { error: 'Invalid webhook signature' });

  let payload; try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  const reference = provider === 'paystack' ? payload?.data?.reference : payload?.data?.tx_ref;
  if (!reference) return send(res, 400, { error: 'Missing reference' });

  const verification = await verifyTransaction({ provider, reference });
  await update(db => {
    const r = db.requests.find(x => x.reference === reference);
    if (r) r.status = verification.ok ? 'paid' : 'payment-failed';
    return db;
  });
  send(res, 200, { received: true });
});

// ---- leadership ----
route('GET', '/api/leadership', async (req, res) => send(res, 200, (await readDB()).leadership));
route('PUT', '/api/admin/leadership', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => { db.leadership = body; return db.leadership; });
  send(res, 200, result);
});

// ---- auth ----
route('POST', '/api/auth/register', async (req, res) => {
  if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Please wait a minute and try again.' });
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const { name, email, password } = body || {};
  if (!name || !isValidEmail(email) || !password || password.length < 8) {
    return send(res, 400, { error: 'Name, a valid email, and a password of at least 8 characters are required.' });
  }
  const db = await readDB();
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return send(res, 409, { error: 'An account with this email already exists.' });
  }
  const { salt, hash } = hashPassword(password);
  const user = await update(db2 => {
    const u = { id: nextId(), name, email, salt, hash, role: 'member', createdAt: new Date().toISOString() };
    db2.users.push(u);
    return u;
  });
  const token = signToken({ uid: user.id, role: user.role });
  send(res, 201, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

route('POST', '/api/auth/login', async (req, res) => {
  if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Please wait a minute and try again.' });
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const { email, password } = body || {};
  const db = await readDB();
  const user = db.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || !verifyPassword(password || '', user.salt, user.hash)) {
    return send(res, 401, { error: 'Incorrect email or password.' });
  }
  const token = signToken({ uid: user.id, role: user.role });
  send(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

route('GET', '/api/auth/me', async (req, res) => {
  const user = await requireAuth(req, res); if (!user) return;
  send(res, 200, { user });
});

// ---- member: reminders ----
route('POST', '/api/reminders', async (req, res) => {
  const user = await requireAuth(req, res); if (!user) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  if (!body.eventId) return send(res, 400, { error: 'eventId is required' });
  const rec = await update(db => {
    const x = { id: nextId(), memberId: user.id, eventId: body.eventId, createdAt: new Date().toISOString() };
    db.reminders.push(x);
    return x;
  });
  send(res, 201, rec);
});
route('GET', '/api/reminders', async (req, res) => {
  const user = await requireAuth(req, res); if (!user) return;
  const db = await readDB();
  send(res, 200, db.reminders.filter(r => r.memberId === user.id));
});

// ---- member: prayer / service requests ----
route('POST', '/api/requests', async (req, res) => {
  const user = await requireAuth(req, res); if (!user) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  if (!body.type || !body.message) return send(res, 400, { error: 'type and message are required' });
  const rec = await update(db => {
    const x = {
      id: nextId(), memberId: user.id, type: body.type, message: body.message,
      private: !!body.private, status: 'received', createdAt: new Date().toISOString()
    };
    db.requests.push(x);
    return x;
  });
  send(res, 201, rec);
});
route('GET', '/api/requests', async (req, res) => {
  const user = await requireAuth(req, res); if (!user) return;
  const db = await readDB();
  send(res, 200, db.requests.filter(r => r.memberId === user.id));
});

// ---- admin: users, requests ----
route('GET', '/api/admin/users', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const db = await readDB();
  send(res, 200, db.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })));
});
route('PATCH', '/api/admin/users/:id', async (req, res, p) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  if (body.role && !ROLES.includes(body.role)) return send(res, 400, { error: 'Invalid role. Must be one of: ' + ROLES.join(', ') });
  const result = await update(db => {
    const u = db.users.find(x => x.id === p.id);
    if (!u) return null;
    if (body.role) u.role = body.role;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  });
  if (!result) return send(res, 404, { error: 'User not found' });
  send(res, 200, result);
});
route('GET', '/api/admin/requests', async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const db = await readDB();
  send(res, 200, db.requests);
});
route('PATCH', '/api/admin/requests/:id', async (req, res, p) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => {
    const r = db.requests.find(x => x.id === p.id);
    if (!r) return null;
    if (body.status) r.status = body.status;
    return r;
  });
  if (!result) return send(res, 404, { error: 'Request not found' });
  send(res, 200, result);
});

// ---- generic admin create/update/delete for simple collections ----
async function handleAdminCreate(req, res, collection) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const rec = await update(db => {
    const x = { id: nextId(), ...body, createdAt: new Date().toISOString() };
    db[collection].push(x);
    return x;
  });
  send(res, 201, rec);
}
async function handleAdminUpdate(req, res, collection, id) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  let body; try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const result = await update(db => {
    const idx = db[collection].findIndex(x => x.id === id);
    if (idx === -1) return null;
    db[collection][idx] = { ...db[collection][idx], ...body, id };
    return db[collection][idx];
  });
  if (!result) return send(res, 404, { error: 'Not found' });
  send(res, 200, result);
}
async function handleAdminDelete(req, res, collection, id) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const result = await update(db => {
    const before = db[collection].length;
    db[collection] = db[collection].filter(x => x.id !== id);
    return db[collection].length < before;
  });
  if (!result) return send(res, 404, { error: 'Not found' });
  send(res, 200, { ok: true });
}

// ---------- static file serving for the frontend ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(APP_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(APP_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(APP_DIR, 'index.html'); // SPA fallback
  }
  const ext = path.extname(filePath);
  const body = fs.readFileSync(filePath);
  send(res, 200, body, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
}

// ---------- main request handler ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '', {});

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.regex);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      try {
        await r.handler(req, res, params);
      } catch (err) {
        console.error('Handler error:', err);
        if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
      }
      return;
    }
    return send(res, 404, { error: 'Not found' });
  }

  try {
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('Static file error:', err);
    send(res, 500, { error: 'Internal server error' });
  }
});

bootstrap()
  .then(() => server.listen(PORT, () => console.log('Chapel of Praise server running on port', PORT)))
  .catch(err => {
    console.error('Bootstrap failed:', err);
    // Still start the server so /api/health can report the problem rather
    // than the whole process silently failing to come up.
    server.listen(PORT, () => console.log('Chapel of Praise server running on port', PORT, '(bootstrap had errors — see above)'));
  });
