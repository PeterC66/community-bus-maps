// Passwordless magic-link auth + server-side sessions. No external deps.
//
// Flow: POST /api/auth/request {email} -> a single-use token is created and the
// sign-in link is printed to the SERVER CONSOLE (in dev; a real email provider
// is wired at launch). GET /auth/verify?token=… consumes the token, creates a
// session, and sets an httpOnly cookie holding an opaque random session token.
// No passwords are handled anywhere; the cookie value is unguessable and the
// session is stored server-side.

import crypto from 'node:crypto';
import { tokenHash } from '../hash.js';   // the ONE token hash (OA-224 Tier 3.3)
import { dbDateMs } from '../db/dates.js';
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
 *
 * That reasoning was right and stopped one hop short of the store, which is
 * technical-audit_2026-08-25 N3: the table itself held every live token in the
 * clear, and unencrypted copies of it left the box nightly. Since 2026-08-25 it
 * holds the hash — so there is no raw token on the server left to name, and the
 * handle is byte-for-byte what it always was, because it was already a prefix of
 * exactly this hash. Nothing the admin sees changed.
 */
export function sessionHandle(token) {
  return handleFromHash(sessionTokenHash(token));
}

/** The full stored hash of a raw token — what `session.token` holds since N3.
 *  The implementation is `src/hash.js`'s, shared with `src/db/index.js`, because
 *  a token hashed on the way in by one spelling and looked up by another is a
 *  fault nothing in the code would explain (OA-224 Tier 3.3). */
export function sessionTokenHash(token) {
  return tokenHash(token);
}

/** The same handle, for callers holding the stored hash rather than a token. */
export function handleFromHash(hash) {
  return String(hash).slice(0, 12);
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
  const lastSlide = dbDateMs(s.expires_at) - SESSION_DAYS * 86_400_000;
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
  const t = dbDateMs(user.sessionCreatedAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= minutes * 60_000;
}

export function logout(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) deleteSession(token);
}

// --- cookies (hand-rolled; the value is an opaque server-side token) ---------
//
// THE DECODE MUST NOT THROW (technical-audit_2026-08-25 N6). `decodeURIComponent`
// raises URIError on any malformed percent-escape — `%`, `%zz`, a lone `%e0` —
// and until 2026-08-25 that throw escaped resolveUser(), escaped the preHandler
// in server.js, and surfaced as a 500. Reproduced against production before the
// fix, and this is the shape of the check that must keep passing:
//
//   curl -H 'Cookie: cbm_session=%' https://busmaps.uk/api/me   ->  500  (was)
//   curl                            https://busmaps.uk/api/me   ->  401
//
// Two things made it worse than it first looks. The loop decodes EVERY cookie on
// the request, not just this one, so any unrelated cookie on the domain carrying
// a stray `%` took the whole signed-in app down for that browser — every URL
// under /api/, /app, /auth/ and /metrics — with a 500 and nothing to tell the
// reader that clearing cookies was the cure. And it was a free unauthenticated
// error path for anybody who wanted to fill the log.
//
// Falling back to the RAW value is the right repair rather than dropping the
// cookie: a session token is base64url and contains nothing that needs decoding,
// so the raw value IS the correct one whenever the decode fails. A genuinely
// malformed cookie then simply fails to match a session, which is a 401.
function decodeCookieValue(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeCookieValue(part.slice(i + 1).trim());
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

// ---------------------------------------------------------------------------
// CSRF — double submit (technical-audit_2026-08-25 N7)
//
// `SameSite=Lax` on the session cookie was the whole defence. It is a good one
// and it is not the same as having a token: Lax is a browser default that a
// browser may relax (it has been softened before, for two-minute-old top-level
// POSTs), it does nothing for a browser that predates it, and it leaves
// login-CSRF via a top-level GET wide open — which is the hole /auth/verify sat
// in.
//
// DOUBLE SUBMIT, because this service has no server-side per-form state and
// adding some for one header would be the larger change. The cookie is readable
// by script ON PURPOSE — that is the mechanism, not an oversight: our own page
// can read it and echo it in a header, and a page on another origin cannot,
// because the same-origin policy stops it reading our cookies. HttpOnly here
// would make the whole scheme impossible, so it is deliberately absent and this
// value is deliberately NOT a credential: it authenticates nothing, it only
// proves the request came from a page that could read our cookie jar.
export const CSRF_COOKIE = 'cbm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function newCsrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function csrfCookie(token, { secure = false } = {}) {
  // No HttpOnly (see above). SameSite=Lax and a session-length Max-Age so it
  // survives the sign-in round trip and expires with the session it guards.
  return `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}` + (secure ? '; Secure' : '');
}

/**
 * Does this request carry a matching cookie/header pair?
 *
 * Constant-time, and length-checked first because timingSafeEqual THROWS on
 * unequal lengths — a comparison that crashes on the attacker's input is not a
 * comparison. Same reasoning as the ops-token compare closed in the P0 block.
 */
export function csrfOk(req) {
  const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  if (!cookie || !header || typeof header !== 'string') return false;
  const a = Buffer.from(cookie), b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Was this request initiated from our own site?
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be forged by a page. The
 * value that matters is `none`: a top-level navigation the USER started — typed,
 * bookmarked, or followed from a desktop mail client. `cross-site` is what a
 * link clicked in webmail produces, which is why nothing here refuses outright
 * on that value; see the /auth/verify handler for what happens instead.
 *
 * Absent means an older browser. Treated as same-site, because refusing every
 * browser that does not send the header would fail closed on the wrong axis —
 * the header is a bonus signal, and the double-submit token above is the
 * defence that does not depend on it.
 */
export function sameSiteRequest(req) {
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'same-site' || site === 'none';
}
