// Authentication built entirely on Node's built-in crypto module.
// No external auth library required.
//
// Passwords: hashed with scrypt (a deliberately slow, salted KDF suitable
// for password storage) — never stored or logged in plain text.
//
// Session tokens: a compact signed token, conceptually the same idea as a
// JWT (payload + HMAC signature) but hand-rolled with zero dependencies.
// The role inside the token is set ONLY by the server at login time and is
// verified via signature on every request — the client can never simply
// claim to be an admin.

import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || (() => {
  console.warn(
    '[auth] WARNING: SESSION_SECRET is not set. Using a random secret ' +
    'generated at startup — this means all sessions will be invalidated ' +
    'every time the server restarts, and this is NOT safe for production. ' +
    'Set SESSION_SECRET as an environment variable before deploying.'
  );
  return crypto.randomBytes(32).toString('hex');
})();

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signToken(payload) {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload; // { uid, role, exp }
}

export function getBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer (.+)$/i);
  return m ? m[1] : null;
}
