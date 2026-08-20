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
  insertSession, getSession, deleteSession, touchSession,
} from '../db/index.js';

export const COOKIE_NAME = 'cbm_session';

// SESSION LIFETIME (technical-audit_2026-08-19 S5).
//
// Was 30 days, fixed from the moment of sign-in, with no idle timeout, no
// re-authentication before anything privileged, and no way for anyone to list or
// revoke a live session. Set against that, the operator's own notes recorded a
// live admin session token sitting in a plaintext file on a laptop for a month
// at a time — a standing bearer credential for production with no revocation
// path, which is the shape of the risk rather than an accident of housekeeping.
//
// Seven days, SLIDING. Somebody using the portal daily is never signed out;
// somebody who stops using it loses the credential within a week instead of
// within a month. The window only slides when a session is actually used, which
// is what makes it an idle timeout rather than a slower clock.
export const SESSION_DAYS = 7;

// Don't rewrite the row on every request. The window is only pushed forward when
// more than this has passed since the last extension, so a busy session costs one
// UPDATE an hour rather than one per request. The cost of the coarseness is that
// a session can expire up to an hour "early" against a strict reading of the
// window, which nobody can perceive at a seven-day scale.
const SLIDE_EVERY_MS = 60 * 60_000;

// STEP-UP: how recently must the CURRENT session have proved control of the
// mailbox before a privileged action is allowed? Publishing a map, changing an
// organisation's quota and changing a user's role are the three the audit named:
// they are the actions whose damage a stolen month-old cookie would do.
//
// Thirty minutes is long enough to sign in and then work through a review, and
// short enough that a cookie lifted from a laptop, a backup or a log is useless
// for them. It is not a second factor — it is proof that whoever is acting can
// still receive mail at that address RIGHT NOW, using the only credential this
// system has.
//
// It also has a pleasant interaction with the mint-and-revoke pattern the ops
// notes already use for scripted work: a freshly minted session passes by
// construction, and a stored one does not, which is exactly the incentive the
// stored-cookie file needed.
export const STEP_UP_MINUTES = 30;

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

/**
 * A stable, non-secret name for a session.
 *
 * The token itself is a bearer credential: hand a list of them to an admin
 * console and the console — plus its logs, its browser history and anything that
 * ever screenshots it — is holding live credentials for other people's accounts.
 * So the sessions view names each session by the first 12 hex of its SHA-256
 * instead, which is enough to point at one and revoke it, and worth nothing to
 * anyone who copies it down.
 */
export function sessionHandle(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/** Resolve the logged-in user for a request from its session cookie, or null. */
export function resolveUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const s = getSession(token);
  if (!s) return null;

  // The sliding half of the seven-day window. `expires_at` doubles as the
  // record of when the session was last used — it is always exactly
  // SESSION_DAYS after that moment — so no extra column is needed to know
  // whether it is time to slide again.
  let expiresAt = s.expires_at;
  const lastSlide = new Date(`${String(s.expires_at).replace(' ', 'T')}Z`).getTime() - SESSION_DAYS * 86_400_000;
  let slid = false;
  if (Number.isFinite(lastSlide) && Date.now() - lastSlide > SLIDE_EVERY_MS) {
    const next = sqlDatePlus(SESSION_DAYS * 86_400_000);
    if (touchSession(token, next)) { expiresAt = next; slid = true; }
  }

  return {
    id: s.user_id, email: s.email, name: s.name, role: s.role,
    status: s.status, customer_id: s.customer_id, sessionToken: token,
    sessionCreatedAt: s.created_at, sessionExpiresAt: expiresAt, sessionSlid: slid,
  };
}

/**
 * Has this session proved mailbox control within STEP_UP_MINUTES?
 *
 * Anchored on the session's CREATION, because that is the moment a magic link
 * was consumed. The sliding window above never moves it, so simply staying
 * signed in can never re-earn step-up — which is the whole point.
 */
export function stepUpFresh(user, { minutes = STEP_UP_MINUTES } = {}) {
  if (!user || !user.sessionCreatedAt) return false;
  const t = new Date(`${String(user.sessionCreatedAt).replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= minutes * 60_000;
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
  // Max-Age matches SESSION_DAYS and is re-sent whenever the server slides the
  // row (see the preHandler in server.js). Without that re-send the cookie would
  // still die seven days after sign-in however active the session was, and the
  // window would slide on the server while the browser quietly stopped
  // presenting the credential — a sliding session that does not slide.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}` + (secure ? '; Secure' : '');
}
export function clearCookie({ secure = false } = {}) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (secure ? '; Secure' : '');
}
