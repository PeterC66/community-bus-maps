// Passwordless magic-link auth + server-side sessions. No external deps.
//
// Flow: POST /api/auth/request {email} -> a single-use token is created and the
// sign-in link is printed to the SERVER CONSOLE (in dev; a real email provider
// is wired at launch). GET /auth/verify?token=… consumes the token, creates a
// session, and sets an httpOnly cookie holding an opaque random session token.
// No passwords are handled anywhere; the cookie value is unguessable and the
// session is stored server-side.

import crypto from 'node:crypto';
import {
  getUserByEmail, insertMagicLink, consumeMagicLink,
  insertSession, getSession, deleteSession,
} from '../db/index.js';

export const COOKIE_NAME = 'cbm_session';
const SESSION_DAYS = 30;
const MAGIC_MINUTES = 15;

const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// A UTC timestamp in SQLite's own format ("YYYY-MM-DD HH:MM:SS"), so that
// `expires_at > datetime('now')` compares correctly as strings.
function sqlDatePlus(ms) {
  return new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Create a magic-link token for an active user; null if the email is unknown
 *  (the caller responds identically either way, to avoid user enumeration). */
export function requestMagicLink(email) {
  const user = getUserByEmail(email);
  if (!user || user.status !== 'active') return null;
  const token = newToken();
  insertMagicLink(token, email, sqlDatePlus(MAGIC_MINUTES * 60_000));
  return token;
}

/** Consume a magic-link token and open a session. Returns { sessionToken, user } or null. */
export function verifyMagicLink(token) {
  const row = consumeMagicLink(token);
  if (!row) return null;
  const user = getUserByEmail(row.email);
  if (!user || user.status !== 'active') return null;
  const sessionToken = newToken();
  insertSession(sessionToken, user.id, sqlDatePlus(SESSION_DAYS * 86_400_000));
  return { sessionToken, user };
}

/** Resolve the logged-in user for a request from its session cookie, or null. */
export function resolveUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const s = getSession(token);
  if (!s) return null;
  return {
    id: s.user_id, email: s.email, name: s.name, role: s.role,
    status: s.status, customer_id: s.customer_id, sessionToken: token,
  };
}

export function logout(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) deleteSession(token);
}

// --- cookies (hand-rolled; the value is an opaque server-side token) ---------
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function sessionCookie(token, { secure = false } = {}) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}` + (secure ? '; Secure' : '');
}
export function clearCookie({ secure = false } = {}) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (secure ? '; Secure' : '');
}
