// The guards and the small request helpers every route file needs (OA-231,
// codebase review Tier 4.4, portal-src F8). They lived at module scope in
// src/server.js and every route closed over them; a route file cut out of that
// scope has to IMPORT them, which is what this module is for. Moved verbatim,
// comments and all -- the reasoning stayed with the code it explains.
//
// Nothing here reads the database or a map. What reads env (PUBLIC_BASE_URL,
// EMAIL_PROVIDER, the three tokens) still reads it here, and that is the "one
// env reader" item the same review lists for later, not a claim this file makes.
import crypto from 'node:crypto';
import { STEP_UP_MINUTES, stepUpFresh } from '../auth/index.js';
import { emailProvider, metricsToken, operatorToken, publicBaseUrl } from '../config.js';
import { dbDateMs } from '../db/dates.js';

// ---- request-shaped values and the constants the routes validate against ----
// The five pain-point classes the shopfront is organised around, plus 'other'.
// The trailing seven are the original organisation-type values: no longer offered
// on the form, still accepted so that stored applications and seeded demo rows
// keep validating (customer.type is copied straight from here on approval).
const ORG_TYPES = [
  'authority-council', 'healthcare-campus', 'business-park', 'bid-tourism', 'operator-ct', 'other',
  'council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt',
];
// What the PUBLIC contact form may set. 'diagram-request' is a fourth kind in the
// message table, but only the server writes it (see /api/maps/:id/diagram-request),
// so it is deliberately not in this list.
const MSG_KINDS = ['enquiry', 'question', 'feedback', 'issue'];
// The admin-settable states for a message (schema default is 'new' on insert).
const MSG_STATUSES = ['new', 'read', 'answered'];
const MAP_KINDS = ['area', 'place'];
// In dev (no email provider) the invite/sign-in link is surfaced to the admin UI
// so the whole apply→approve→sign-in loop is demoable without a mailbox.
const DEV_LINKS = !emailProvider();   // snapshotted at load, as it always was

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const isHttps = (req) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
const parseOutputs = (json) => { try { return JSON.parse(json || '{}') || {}; } catch { return {}; } };
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const parseJson = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

// THE ABSOLUTE BASE FOR EVERY LINK THIS SERVER BUILDS.
//
// Configured first, request header only as a fallback. It used to be the other
// way round for the auth links, and the difference is an account-takeover class
// (technical-audit_2026-08-25 N5): `req.headers.host` is a value the CALLER
// chooses. A request to POST /api/auth/request carrying `Host: attacker.example`
// produced a genuine, valid sign-in email whose link handed the single-use token
// to the attacker's server — the victim clicks a real link from a real address
// and is phished with this system's own credential.
//
// It did not land in production, and it is worth being precise about WHY,
// because the reason was not the application: Caddy's site block matches only
// busmaps.uk and www.busmaps.uk, so a spoofed Host never reached this process at
// all (verified — `curl -H 'Host: evil.example.com' https://busmaps.uk/` returns
// Caddy's own empty 200, not ours). That is a real mitigation and it was also
// the ENTIRE mitigation: an implicit property of a reverse-proxy config,
// asserted by no test, mentioned in no comment, that disappears the moment
// anyone adds a wildcard site, a staging hostname, or exposes 127.0.0.1:5180 to
// debug something.
//
// So the app defends itself now. PUBLIC_BASE_URL is already set in production
// (compose.yaml passes it; robots.txt and sitemap.xml have always used it) and
// baseUrl() already preferred it — the auth links simply were not going through
// baseUrl(). They do now, and every absolute URL this file builds comes from one
// function.
const BASE_URL = publicBaseUrl();     // snapshotted at load, as it always was
const baseUrl = (req) => BASE_URL || `${req.protocol}://${req.headers.host}`;
const authLink = (req, token) => `${baseUrl(req)}/auth/verify?token=${token}`;

// ---- the guards ----------------------------------------------------------------
// Each sends the refusal itself and returns null, so a handler reads
//   const user = requireUser(req, reply); if (!user) return;
// and a plugin-level preHandler reads `if (!requireAdmin(req, reply)) return reply;`.
function requireUser(req, reply) {
  if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return null; }
  return req.user;
}

function requireAdmin(req, reply) {
  if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return null; }
  if (req.user.role !== 'admin') { reply.code(403).send({ ok: false, error: 'Admin access only.' }); return null; }
  return req.user;
}

// Publishing is a platform review (separation of duties from the customer who
// edits): approvers and admins may review + publish; editors may only submit.
function requireApprover(req, reply) {
  if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return null; }
  if (req.user.role !== 'approver' && req.user.role !== 'admin') {
    reply.code(403).send({ ok: false, error: 'Approver access only.' }); return null;
  }
  return req.user;
}

// STEP-UP AUTHENTICATION for the three actions the audit named: publishing a
// version, changing an organisation's quota, and changing a user's role
// (technical-audit_2026-08-19 S5).
//
// The check is "did THIS session prove control of the mailbox in the last
// STEP_UP_MINUTES", anchored on the session's creation — the moment a magic link
// was consumed. Staying signed in never re-earns it. Since the magic link is the
// only credential this system has, re-authenticating IS re-requesting one, which
// is what the audit's remedy asked for; the difference is that the user is sent
// to do it rather than being interrupted mid-action by an email round-trip
// wedged into a POST handler.
//
// 403 rather than 401 on purpose: the caller IS authenticated, and an app that
// treats 401 as "signed out" would otherwise throw them back to the login page
// having lost whatever they had typed. `code: 'step-up-required'` is what the
// UI keys on.
// When this session's step-up freshness runs out, as an absolute ISO time, or null
// if it cannot be worked out. Mirrors stepUpFresh()'s anchor (session creation) so
// the two can never disagree about the same session.
function stepUpDeadline(user) {
  if (!user || !user.sessionCreatedAt) return null;
  const t = dbDateMs(user.sessionCreatedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + STEP_UP_MINUTES * 60_000).toISOString();
}

function requireStepUp(req, reply, what) {
  if (stepUpFresh(req.user)) return true;
  req.log.warn({ userId: req.user && req.user.id, what }, 'step-up required');
  reply.code(403).send({
    ok: false,
    code: 'step-up-required',
    error: `For security, ${what} needs a sign-in from the last ${STEP_UP_MINUTES} minutes. Sign out and follow a fresh sign-in link, then try again.`,
  });
  return false;
}

// A CREDENTIAL BELONGS IN A HEADER, NEVER IN A URL (technical-audit_2026-08-25 N7).
//
// Both ops tokens used to be accepted as `?token=...` as well as a Bearer header.
// The Caddyfile turns on an access log, and Caddy's request line records the
// FULL URI including its query string — so every use of the query form wrote a
// live credential, in clear, into /var/log/caddy/busmaps.access.log: a file in
// no backup, rotated by nothing here, and covered by no retention rule. Query
// strings also reach Referer headers, browser history and shell history.
//
// This project had already reasoned it through correctly for a LESS sensitive
// value: the custom log serialiser at the top of this file strips `q` off
// /api/public/search because "search queries are never logged, and an access log
// counts as a log". A token deserves the argument more — and the app's own
// serialiser could not have helped anyway, because the leak was in Caddy's log,
// not Fastify's.
//
// The query form is GONE rather than deprecated. Its only caller was
// scripts/deploy.mjs, changed in the same commit; bus-work's push-status.mjs has
// always sent an Authorization header.
//
// Constant-time comparison while we are here. Over a network the timing signal
// is mostly noise, but `===` on a secret is a two-line fix and there is no
// argument for keeping it. timingSafeEqual throws on unequal lengths, so the
// length check comes first; that is not itself a leak worth minding, because the
// token's length is fixed by us and not by the attacker's guess.
function tokenMatches(supplied, expected) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(supplied), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The Bearer token on this request, or ''. */
const bearerToken = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

// Is the caller allowed to see operational DETAIL? Same gate as /metrics: a
// METRICS_TOKEN Bearer header, or a signed-in admin. Factored out because
// /health and /metrics want the same answer, and two hand-rolled copies of one
// authorisation rule are two chances to drift apart.
function opsAuthorised(req) {
  const viaToken = tokenMatches(bearerToken(req), metricsToken());
  const viaAdmin = Boolean(req.user) && req.user.role === 'admin';
  return viaToken || viaAdmin;
}

// OPERATOR_TOKEN — a READ-ONLY operator credential for the laptop's own tooling
// (OA-203, 2026-08-31). It admits exactly three GETs, `/api/admin/worklist`,
// `/api/maps` and, since 2026-09-05 (buses-data OA-233), `/api/maps/:id/poi-tiers`,
// at the scope an admin session already sees on them, and it admits nothing else
// anywhere. scripts/test-operator-token.mjs holds that set closed by counting the
// call sites across src/.
//
// WHY IT EXISTS. `bus-work/assets/worklist.mjs` reads those routes. All sit
// behind a signed-in admin, and the only credential this portal issues for a
// PERSON is a magic-link session — so until now the laptop borrowed one: a live
// `cbm_session` value pasted into .env and left there. That is a full admin
// session doing a read tool's job. Only four routes sit behind step-up, so such
// a stored cookie could also approve an organisation application, approve a map
// request, create a user, revoke anybody's sessions and mail every customer.
// The 2026-08-20 P1 block (technical-audit_2026-08-19 S5) had explicitly retired
// "the standing admin cookie kept in a file on the laptop"; it came back eleven
// days later as documented setup, in a different repository, because nothing on
// either side named the other.
//
// ITS OWN VARIABLE, and not a reuse of STATUS_TOKEN — the argument at
// POST /api/admin/status below is that keeping the credentials separate stops a
// read token from quietly becoming a write token. Sharing one here would run
// that backwards, which is worse: STATUS_TOKEN WRITES the snapshot the worklist
// then trusts.
//
// THE METHOD CHECK IS THE POINT, not belt-and-braces. Read-only is a property
// this function can hold on its own, rather than one that depends on nobody ever
// adding a third call site in a POST handler — and a property in one place is a
// property a test can break on purpose. Unset ⇒ nobody is ever admitted, the
// same failure direction as METRICS_TOKEN and STATUS_TOKEN. Bearer header only,
// constant-time, for the reasons written out above tokenMatches().
function operatorRead(req) {
  if (req.method !== 'GET') return false;
  return tokenMatches(bearerToken(req), operatorToken());
}

// Escape for XML/HTML text and attributes. Used by sitemap.xml and by the
// admin-only changelog page, which prints the developer CHANGELOG.md as escaped
// plain text rather than parsed markdown. It lived in server.js until 2026-09-02;
// the changelog page moved to src/routes/pages.js and a route file may not reach
// into server.js, so this moved out with it (OA-231).
function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ---- the per-IP rate limit for public POSTs -------------------------------
// Moved here from src/server.js on 2026-09-03 (OA-232 Tier 3.2) BEFORE the
// public front was cut into src/routes/public.js, not during it — the same
// order src/routes/pages.js records for VIEWS_DIR and xmlEscape(). It has four
// callers and they end up in two files: /api/apply, /api/contact and
// /api/public/feedback are in the plugin, and the auth sign-in POST is not.
//
// ONE MAP, DELIBERATELY, and that is why this is a module rather than a factory.
// The counter is per process and per IP, and a second instance of it would give
// a caller a fresh twenty requests by choosing a different route file.
//
// Nothing evicted from this map until 2026-08-19, so it grew one entry per
// distinct client address for the life of the process — slow memory exhaustion
// (technical-audit_2026-08-19 S3). Two bounds now, belt and braces: a periodic
// sweep of entries whose window has closed, and a hard cap that clears the lot
// the way inlineCache already does. Clearing wholesale only forgives in-flight
// counts, so the failure mode is a moment's extra leniency, never a lockout.
const hits = new Map();
const HITS_MAX = 20_000;
function sweepHits(windowMs = 60_000) {
  const now = Date.now();
  if (hits.size > HITS_MAX) { hits.clear(); return; }
  for (const [ip, rec] of hits) if (now - rec.t > windowMs) hits.delete(ip);
}
function rateLimited(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  hits.set(ip, rec);
  if (hits.size > HITS_MAX) sweepHits(windowMs);
  return rec.n > max;
}

export {
  ORG_TYPES, MSG_KINDS, MSG_STATUSES, MAP_KINDS, DEV_LINKS, str, isEmail, isHttps, parseOutputs, slugify, parseJson, BASE_URL, baseUrl, authLink, requireUser, requireAdmin, requireApprover, stepUpDeadline, requireStepUp, tokenMatches, bearerToken, opsAuthorised, operatorRead, xmlEscape, rateLimited,
};
