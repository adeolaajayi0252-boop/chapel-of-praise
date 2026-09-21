// Minimal file-based persistence layer. No external dependencies.
// Data survives server restarts (unlike the old in-memory arrays).
// Writes are atomic (write to temp file, then rename) to avoid corruption
// if the process is killed mid-write.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData(), null, 2));
  }
}

export function readDB() {
  ensureFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupted file — back it up and start fresh rather than crash the server.
    fs.renameSync(DB_FILE, DB_FILE + '.corrupt-' + Date.now());
    const fresh = defaultData();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

export function writeDB(data) {
  ensureFile();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Simple helper: run `fn(db)` which mutates db, then persist it.
// Not a true transaction (single-process file locking would need extra
// tooling), but fine for a single Node process serving one small app.
export function update(fn) {
  const db = readDB();
  const result = fn(db);
  writeDB(db);
  return result;
}

export function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
