// The P1 block of technical-audit_2026-08-19, as assertions.
//
//   node scripts/test-audit-p1.mjs        (or: npm run test:audit-p1)
//
// Five findings landed together and each one is a rule that a later edit could
// silently undo without breaking anything visible:
//
//   S4  an anonymous /health must not disclose counts, versions or paths
//   S5  seven-day sliding sessions, step-up freshness, non-secret session handles
//   S6  the submitter of a version cannot approve it
//   S7  the app's HTML shells are not inside the static root
//   O4  a configured-but-broken email provider is a FAULT, not a silent success
//
// The route-level halves of S4, S6 and S7 are exercised here against a real
// Fastify instance rather than by reasoning about the source, because every one
// of them is a claim about what an HTTP response contains — and the whole point
// of the S7 finding was that reading the route code told you the opposite of
// what the server did.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-audit-p1-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.METRICS_TOKEN = 'test-metrics-token';
process.env.CBM_NO_LISTEN = '1'; // build the app, bind no socket — every request goes through app.inject
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// ===========================================================================
// S7 — the app shells are not in the static root
// ===========================================================================
console.log('\nS7 — app shells outside public/');

const SHELLS = ['admin.html', 'branding.html', 'diagram.html', 'editor.html', 'index.html', 'login.html', 'review-services.html', 'review.html'];
for (const f of SHELLS) {
  check(`views/app/${f} exists`, existsSync(path.join(ROOT, 'views', 'app', f)));
}
const strays = existsSync(path.join(ROOT, 'public', 'app'))
  ? readdirSync(path.join(ROOT, 'public', 'app')).filter((f) => f.endsWith('.html'))
  : [];
// The finding in one line. If someone adds a page under public/app/ this goes
// red the same day rather than after the next audit.
eq('no .html left under public/app/', strays, []);

// ===========================================================================
// O4 + S5 — pure modules, before anything boots
// ===========================================================================
console.log('\nO4 — email health');

const { configStatus, signInSendable, recordSendFailure, recordSendSuccess, emailHealth, resetEmailHealth, FAILURE_THRESHOLD } =
  await import('../src/email/health.js');

resetEmailHealth();
eq('no provider in development is fine', configStatus({ env: {} }).ok, true);
eq('…and reports the dev-console mode', configStatus({ env: {} }).mode, 'dev-console');
// THE finding: in production, "no provider" means nobody can sign in, and the
// old code called that healthy.
eq('no provider in PRODUCTION is a fault', configStatus({ env: { NODE_ENV: 'production' } }).ok, false);
eq('provider with no key is a fault', configStatus({ env: { EMAIL_PROVIDER: 'resend' } }).ok, false);
eq('provider with its key is healthy', configStatus({ env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' } }).ok, true);
eq('an unknown provider is a fault', configStatus({ env: { EMAIL_PROVIDER: 'nope' } }).ok, false);

const GOOD = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' };
eq('a healthy provider is sendable', signInSendable({ env: GOOD }).ok, true);
for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) recordSendFailure(new Error('boom'));
eq(`${FAILURE_THRESHOLD - 1} failures still sendable`, signInSendable({ env: GOOD }).ok, true);
recordSendFailure(new Error('boom'));
eq(`${FAILURE_THRESHOLD} failures refuses`, signInSendable({ env: GOOD }).ok, false);
eq('…and the worklist can see it', emailHealth({ env: GOOD }).failing, true);
recordSendSuccess();
eq('one success clears the run', signInSendable({ env: GOOD }).ok, true);
eq('…and the counter with it', emailHealth({ env: GOOD }).consecutiveFailures, 0);
// The refusal must not depend on the address — that is what keeps it free of
// user enumeration. signInSendable takes no address at all, which is the
// structural version of that promise; assert the signature stays that way.
eq('signInSendable never sees an address', signInSendable.length <= 1, true);
resetEmailHealth();

console.log('\nS5 — sessions');
const { sessionHandle, stepUpFresh, STEP_UP_MINUTES, SESSION_DAYS } = await import('../src/auth/index.js');

eq('sessions last 7 days, not 30', SESSION_DAYS, 7);
check('step-up window is well under a day', STEP_UP_MINUTES > 0 && STEP_UP_MINUTES <= 60);
const h = sessionHandle('a-secret-session-token');
eq('a handle is 12 hex characters', /^[0-9a-f]{12}$/.test(h), true);
eq('…stable for the same token', sessionHandle('a-secret-session-token'), h);
check('…different for a different token', sessionHandle('another-token') !== h);
// The handle exists so the token never leaves the server. If it ever became a
// prefix of the token itself, that promise would be quietly gone.
check('…and is not derived by truncating the token', !'a-secret-session-token'.startsWith(h));

const sqlNow = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
eq('a session opened just now is step-up fresh', stepUpFresh({ sessionCreatedAt: sqlNow(-60_000) }), true);
eq('…one opened yesterday is not', stepUpFresh({ sessionCreatedAt: sqlNow(-25 * 3600_000) }), false);
eq('…and neither is one with no timestamp', stepUpFresh({}), false);
// The whole value of anchoring on creation: staying signed in must never
// re-earn step-up. An old session is stale however recently it was used.
eq('an old session is stale regardless of expiry', stepUpFresh({ sessionCreatedAt: sqlNow(-40 * 24 * 3600_000), sessionExpiresAt: sqlNow(7 * 24 * 3600_000) }), false);

// ===========================================================================
// S4 / S6 / S7 over real HTTP
// ===========================================================================
console.log('\nS4 — what /health tells a stranger');

const { app } = await import('../src/server.js');
await app.ready();

const get = async (url, headers) => {
  const r = await app.inject({ method: 'GET', url, headers });
  let json = null;
  try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json, body: r.body, headers: r.headers };
};

const anon = await get('/health');
eq('anonymous /health is exactly four fields', Object.keys(anon.json).sort(), ['service', 'status', 'time', 'version']);
// Name them individually: this is the disclosure the audit measured, and a
// future edit that re-adds one should say which one it re-added.
for (const leak of ['gitSha', 'builtAt', 'maps', 'users', 'customers', 'applications', 'messages', 'auditEvents', 'publishRequests', 'proposedUpdates', 'pilotMode']) {
  eq(`…no ${leak}`, leak in anon.json, false);
}

const anonDeep = await get('/health?deep=1');
// The verdict stays public — the uptime monitor and the container HEALTHCHECK
// both need it, and gating it would have turned every poll into a 401.
check('anonymous ?deep=1 still answers', anonDeep.status === 200 || anonDeep.status === 503);
eq('…but discloses no per-check detail', 'checks' in anonDeep.json, false);
eq('…and still carries a verdict', typeof anonDeep.json.status, 'string');

const priv = await get('/health?deep=1', { authorization: 'Bearer test-metrics-token' });
eq('with the metrics token, the checks come back', 'checks' in priv.json, true);
eq('…including the email check added for O4', 'email' in priv.json.checks, true);
eq('…and the counts', 'maps' in priv.json, true);

const badTok = await get('/health?deep=1', { authorization: 'Bearer wrong' });
eq('a wrong token discloses nothing', 'checks' in badTok.json, false);

eq('/metrics is still hidden from a stranger', (await get('/metrics')).status, 404);
eq('…and open to the token', (await get('/metrics', { authorization: 'Bearer test-metrics-token' })).status, 200);

console.log('\nS7 — the shells over HTTP');
for (const f of ['admin', 'editor', 'index', 'review', 'branding', 'diagram']) {
  eq(`/app/${f}.html is not served statically`, (await get(`/app/${f}.html`)).status, 404);
}
// login.html is anonymous BY DESIGN — it is the sign-in page — and keeps its URL
// so every existing redirect and bookmark still works.
eq('/app/login.html is still served', (await get('/app/login.html')).status, 200);
// …and this one was the clearest instance of the finding: a static file with no
// route, holding a reviewer's view of an unpublished map.
eq('/app/review-services.html now redirects an anonymous visitor', (await get('/app/review-services.html')).status, 302);
eq('the app CSS is still public', (await get('/app/app.css')).status, 200);
eq('…and so is the app JS', (await get('/app/admin.js')).status, 200);
eq('the guarded pretty URL still redirects', (await get('/app/admin')).status, 302);

console.log('\nS6 — separation of duties, and S5 step-up, over real HTTP');

// Stand up the smallest thing that can be approved: one customer, two admins,
// one map, one version, one pending publish request submitted by ADMIN A.
//
// Asserted through the ROUTE rather than by reading the source, because the
// finding was precisely that the source said one thing (a documented separation
// of duties) and the running server did another. A regex over server.js would
// reproduce that mistake in test form.
const db = await import('../src/db/index.js');
const { CHECKLIST } = await import('../src/publish/index.js');

const custId = db.insertCustomer({ name: 'Test Council', type: 'authority-council' });
const submitterId = db.insertUser({ email: 'submitter@example.com', name: 'Submitter', role: 'admin', customer_id: custId });
const otherId = db.insertUser({ email: 'other@example.com', name: 'Other approver', role: 'admin', customer_id: custId });

const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
const openSession = (userId, ageMs = 0) => {
  const token = `tok-${userId}-${ageMs}-${Math.random().toString(36).slice(2)}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};

const mapId = db.insertMap({ customer_id: custId, slug: 'test-town', name: 'Test Town', kind: 'area', status: 'draft' });
const versionId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
const requestId = db.insertPublishRequest({ map_id: mapId, version_id: versionId, requested_by: submitterId });

const post = async (url, token, body) => {
  const r = await app.inject({
    method: 'POST', url, payload: body || {},
    headers: { cookie: `cbm_session=${token}`, 'content-type': 'application/json' },
  });
  let json = null;
  try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json };
};

const ticked = { checklist: Object.fromEntries(CHECKLIST.map((c) => [c.id, true])) };

// 1. The submitter, with a fresh session, cannot approve their own submission.
const selfTok = openSession(submitterId);
const self = await post(`/api/review/${requestId}/approve`, selfTok, ticked);
eq('the submitter is refused (409)', self.status, 409);
eq('…with a code the UI can act on', self.json.code, 'self-approval');

// 2. …and the refusal is about WHO, not about the checklist: a different
//    approver, same request, same body, goes through. Without this the test
//    would pass just as well if approve were broken for everyone.
const otherTok = openSession(otherId);
const other = await post(`/api/review/${requestId}/approve`, otherTok, ticked);
eq('a different approver publishes it', other.status, 200);
eq('…and it is not marked as a self-approval', 'selfApproved' in (other.json || {}), false);

// 3. The audit row is the point of the exercise — the control has to be legible
//    afterwards, not only at the moment it fires.
const audit = db.listAudit({ limit: 20 });
check('the publication is in the audit trail', audit.some((a) => a.action === 'version.publish'));

// 4. S5 step-up: the same approver, on a session opened over an hour ago, is
//    refused a publish. Seeded by writing the row directly, because the whole
//    property under test is that AGE decides it.
const map2 = db.insertMap({ customer_id: custId, slug: 'test-town-2', name: 'Test Town 2', kind: 'area', status: 'draft' });
const version2 = db.insertVersion({ map_id: map2, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
const request2 = db.insertPublishRequest({ map_id: map2, version_id: version2, requested_by: submitterId });
const staleTok = `tok-stale-${Math.random().toString(36).slice(2)}`;
db.insertSession(staleTok, otherId, sqlPlus(7 * 86_400_000));
db.db.prepare('UPDATE session SET created_at = ? WHERE token = ?').run(sqlPlus(-3 * 3600_000), staleTok);
const stale = await post(`/api/review/${request2}/approve`, staleTok, ticked);
eq('a three-hour-old session cannot publish', stale.status, 403);
eq('…and says why', stale.json.code, 'step-up-required');

// 5. Sessions view + revocation.
const sess = await app.inject({ method: 'GET', url: '/api/admin/sessions', headers: { cookie: `cbm_session=${otherTok}` } });
const sessions = sess.json().sessions;
check('the sessions view lists live sessions', sessions.length >= 3);
eq('…and never returns a token', sessions.some((x) => 'token' in x), false);
check('…and marks the caller\'s own', sessions.some((x) => x.current === true));

const target = sessions.find((x) => !x.current);
const revoked = await post(`/api/admin/sessions/${target.handle}/revoke`, otherTok);
eq('a session can be revoked by handle', revoked.status, 200);
const after = (await app.inject({ method: 'GET', url: '/api/admin/sessions', headers: { cookie: `cbm_session=${otherTok}` } })).json().sessions;
eq('…and it is gone', after.some((x) => x.handle === target.handle), false);
check('…while the others remain', after.length === sessions.length - 1);

eq('the self-approval override is OFF by default', process.env.ALLOW_SELF_APPROVAL === '1', false);

await app.close();

console.log(failures ? `\n✗ ${failures} audit-P1 check(s) failed` : '\n✓ all audit-P1 checks passed');
process.exit(failures ? 1 : 0);
