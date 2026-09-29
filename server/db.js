// Persistence layer — talks to a Supabase Postgres project over its REST
// API (PostgREST), using Node's built-in `fetch` (stable since Node 18+,
// no npm dependency needed). This replaces the local-file version because
// Render's free web service tier has no persistent disk: the whole
// filesystem is thrown away on every restart. Storing the data in Supabase
// instead means it survives restarts even on Render's free tier.
//
// Design: rather than modeling separate SQL tables for every collection
// (users, requests, media, etc — a bigger rewrite with more surface area
// for bugs), this keeps the exact same "one JSON document" shape the rest
// of the server already expects, and stores that whole document as a
// single JSONB column in one row of one table. All the route handlers in
// server.js are unchanged in *what* they do — only readDB()/update() now
// go over the network instead of hitting disk, so they're async.
//
// Required setup in Supabase (done once, from the Supabase dashboard SQL
// editor — see docs/DEPLOYMENT.md):
//   create table app_state (
//     id int primary key default 1,
//     data jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//   insert into app_state (id, data) values (1, '{}'::jsonb);
//
// Required environment variables:
//   SUPABASE_URL          e.g. https://xxxxx.supabase.co
//   SUPABASE_SERVICE_KEY   the project's service_role key (server-side
//                          secret — bypasses row-level security, which is
//                          correct here since this server IS the trusted
//                          backend; this key must never reach the browser)

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TABLE = 'app_state';

function configured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function defaultData() {
  return {
    users: [],
    requests: [],
    reminders: [],
    media: [],
    events: [],
    notifications: [],
    givingAccounts: {
      note: 'Account details have not been added yet. An admin can add them from the Admin panel.',
      accounts: []
    },
    leadership: {
      areaPastor: 'Felix Akintunde',
      parishPastor: 'Aderemi Ajayi',
      deacons: 'TBI',
      workers: 'TBI'
    }
  };
}

// In-process cache to avoid a network round trip on every single request
// within the same handler chain, and as a last-resort fallback if a read
// briefly fails. Not a substitute for the real persisted copy in Supabase.
let cache = null;

export async function readDB() {
  if (!configured()) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. The server has no ' +
      'persistent storage configured — see docs/DEPLOYMENT.md.'
    );
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.1&select=data`,
    { headers: headers() }
  );
  if (!res.ok) {
    if (cache) return cache; // serve last known good copy rather than hard-fail a request
    throw new Error(`Supabase read failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const rows = await res.json();
  if (!rows.length) {
    // First run: the row doesn't exist yet — create it.
    const fresh = defaultData();
    await writeDB(fresh);
    cache = fresh;
    return fresh;
  }
  cache = rows[0].data;
  return cache;
}

export async function writeDB(data) {
  if (!configured()) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY are not set — cannot persist data.');
  }
  // Try update first; if no row exists yet, insert it.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.1`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ data, updated_at: new Date().toISOString() })
  });
  if (res.status === 404 || res.headers.get('content-range') === '0-0/0') {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ id: 1, data, updated_at: new Date().toISOString() })
    });
  } else if (!res.ok) {
    throw new Error(`Supabase write failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  cache = data;
}

// Run `fn(db)` which mutates the in-memory document, then persist the
// whole thing back. Same simple last-write-wins model as the file-based
// version had — fine for a single small church app's traffic level.
export async function update(fn) {
  const db = await readDB();
  const result = fn(db);
  await writeDB(db);
  return result;
}

export function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function storageConfigured() {
  return configured();
}
