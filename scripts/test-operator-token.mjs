// OPERATOR_TOKEN — the read-only operator credential, as assertions (OA-203, 2026-08-31).
//
//   node scripts/test-operator-token.mjs        (or: npm run test:operator-token)
//
// WHAT THE TOKEN IS FOR. `bus-work/assets/worklist.mjs` prints the BusMaps
// worklist in a terminal by reading two admin GETs — `/api/admin/worklist` and
// `/api/maps`. Both were behind a signed-in admin, and the only credential this
// portal issues for a PERSON is a magic-link session, so the laptop borrowed
// one: a live `cbm_session` value pasted into .env and left there. Only four
// routes sit behind step-up, so that stored cookie could also approve an
// organisation application, create a user, revoke anyone's sessions and mail
// every customer. OPERATOR_TOKEN replaces it with a credential that can read
// those two lists and do nothing else at all.
//
// SO THE SUBJECT OF THIS SUITE IS THE WORD "ONLY", AND THAT IS WHY MOST OF IT IS
// REFUSALS. Asserting that the two reads work proves the token exists; it says
// nothing about the claim the change is actually making. Every refusal below is
// therefore paired with a CONTROL that makes the same request and is allowed
// through — an admin session on the same route, or the token on a route it may
// have — because a suite of refusals alone passes just as well when the whole
// route table is broken. `prove-red-operator-token.mjs` breaks each guard on
// purpose and requires the named assertion to be the one that objects.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-optoken-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';

// Set BEFORE the server module is imported, and deliberately a different length
// from the near-miss below so the constant-time comparison's length branch is
// exercised by something other than the happy path.
const TOKEN = 'operator-token-for-the-test-suite';
process.env.OPERATOR_TOKEN = TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');

const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};

const CSRF = 'test-csrf-token-value';
/** A request carrying whichever credential is asked for, and no other. */
async function call(method, url, { bearer, session, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (session) { headers.cookie = `cbm_session=${session}; cbm_csrf=${CSRF}`; headers['x-csrf-token'] = CSRF; }
  const r = await app.inject({ method, url, headers, ...(method === 'GET' ? {} : { payload: body || {} }) });
  let json = null; try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json };
}
const get = (url, opts) => call('GET', url, opts);

const custId = db.insertCustomer({ name: 'Test Council', type: 'council', quota_areas: 4, quota_places: 4 });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: custId });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: custId });
const otherCust = db.insertCustomer({ name: 'Other Council', type: 'council', quota_areas: 1, quota_places: 1 });
db.insertMap({ customer_id: custId, slug: 'ours', name: 'Ours', kind: 'area', subject: 'Ours' });
db.insertMap({ customer_id: otherCust, slug: 'theirs', name: 'Theirs', kind: 'area', subject: 'Theirs' });
const adminTok = openSession(adminId);
const editorTok = openSession(editorId);

// ===========================================================================
console.log('\nThe two reads the worklist needs');
// ===========================================================================

const wlToken = await get('/api/admin/worklist', { bearer: TOKEN });
eq('the token reads /api/admin/worklist', wlToken.status, 200);
check('…and gets the worklist itself, not an empty envelope',
  !!(wlToken.json && wlToken.json.ok && wlToken.json.worklist && Array.isArray(wlToken.json.worklist.items)),
  JSON.stringify(wlToken.json).slice(0, 200));

// The CONTROL for both: an admin session on the same route. Taken from a real
// request rather than assumed, so that "the token sees what an admin sees" is a
// comparison and not an assertion about one side.
const wlAdmin = await get('/api/admin/worklist', { session: adminTok });
eq('an admin session still reads it', wlAdmin.status, 200);
eq('…and the token sees the same list', (wlToken.json.worklist.items || []).length, (wlAdmin.json.worklist.items || []).length);

const mapsToken = await get('/api/maps', { bearer: TOKEN });
eq('the token reads /api/maps', mapsToken.status, 200);
eq('…at ADMIN scope — both customers’ maps, not one', (mapsToken.json.maps || []).length, 2);
eq('…and says so, because worklist.mjs and the app shells read this field', mapsToken.json.isAdmin, true);

// The scope control. Without it, "the token sees both maps" passes just as well
// if the route stopped scoping for EVERYBODY — which would be a data leak to
// every editor, found by nothing here.
const mapsEditor = await get('/api/maps', { session: editorTok });
eq('an editor session still sees only its own', (mapsEditor.json.maps || []).length, 1);
eq('…and is told it is not an admin', mapsEditor.json.isAdmin, false);

// ===========================================================================
console.log('\nAnd nothing else — the token is READ-ONLY');
// ===========================================================================

// The claim under test. Each row is a route an admin session CAN reach; the
// token must not, and the reason must be that it is not a session at all.
// `/api/me` is in here because it is the cheapest thing an attacker would try
// with a stolen bearer to find out whose credential they hold.
const FORBIDDEN_GETS = [
  '/api/me',
  '/api/admin/applications',
  '/api/admin/sessions',
  '/api/admin/audit',
];
for (const url of FORBIDDEN_GETS) {
  const withToken = await get(url, { bearer: TOKEN });
  const withAdmin = await get(url, { session: adminTok });
  check(`GET ${url} refuses the token (${withToken.status})`, withToken.status === 401 || withToken.status === 403,
    `got ${withToken.status}`);
  // The paired control, on the same URL in the same run: if this route were
  // simply broken or renamed, the refusal above would be meaningless.
  eq(`…while an admin session reaches ${url}`, withAdmin.status, 200);
}

// The METHOD guard, which is what makes read-only a property of operatorRead()
// rather than of its two call sites. A POST carrying the token is refused even
// on a route the token can GET.
const postWorklist = await call('POST', '/api/admin/status', { bearer: TOKEN, body: { towns: [] } });
check('POST /api/admin/status refuses the operator token', postWorklist.status === 404 || postWorklist.status === 401,
  `got ${postWorklist.status}`);
const approveApp = await call('POST', '/api/admin/applications/1/approve', { bearer: TOKEN });
check('POST an application approval refuses it too', approveApp.status === 401 || approveApp.status === 403,
  `got ${approveApp.status}`);
const makeUser = await call('POST', '/api/admin/users', { bearer: TOKEN, body: { email: 'x@example.com', role: 'admin' } });
check('POST a new admin user refuses it too', makeUser.status === 401 || makeUser.status === 403,
  `got ${makeUser.status}`);
eq('…and no user was created', db.getUserByEmail('x@example.com') || null, null);

// ===========================================================================
console.log('\nWhere the token is consulted at all');
// ===========================================================================

// THE ROUTE LIST ABOVE IS AN ENUMERATION, and this project's own house rule is
// that a rule applied by enumeration is right on the day it is written and
// silent about the eighty-sixth route added next year (see the CSRF hook's
// comment in src/server.js, which states it best). The forbidden-GET list can
// only ever cover the routes somebody remembered. So the real claim - the token
// is consulted in TWO PLACES and nowhere else - is asserted against the source
// instead, where it is a closed question rather than a sample.
// Since OA-231 (2026-09-02) the source is three files, not one: the guards and
// operatorRead() itself are src/http/helpers.js, the admin console is
// src/routes/admin.js, and the rest is still src/server.js. So the closed
// question is asked of EVERY file under src/, which is also the stronger form --
// a third call site in a new route file is exactly what the old one-file read
// would have missed.
const srcFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
const SRC = Object.fromEntries(srcFiles(path.join(ROOT, 'src')).map((f) => [path.relative(path.join(ROOT, 'src'), f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
const allSrc = Object.values(SRC).join('\n');
eq('operatorRead is defined once and called exactly twice, across the whole of src/', allSrc.split('operatorRead(').length - 1, 3);
check('…defined in src/http/helpers.js', SRC['http/helpers.js'].includes('function operatorRead(req) {'));
check('…once by the guard of the admin plugin, for the route that declares the exception',
  SRC['routes/admin.js'].includes('if (req.routeOptions.config.operatorRead && operatorRead(req)) return;')
  && SRC['routes/admin.js'].includes("app.get('/worklist', { config: { operatorRead: true } }, async (req, reply) => {"));
check('…and once by GET /api/maps',
  SRC['server.js'].includes('const viaToken = operatorRead(req);'));

// ===========================================================================
console.log('\nThe credential itself');
// ===========================================================================

eq('a wrong token of the SAME length is refused',
  (await get('/api/admin/worklist', { bearer: 'x'.repeat(TOKEN.length) })).status, 401);
eq('a wrong token of a different length is refused',
  (await get('/api/admin/worklist', { bearer: 'short' })).status, 401);
eq('no credential at all is still refused', (await get('/api/admin/worklist')).status, 401);

// THE QUERY FORM IS NOT ACCEPTED — technical-audit_2026-08-25 N7. Caddy logs the
// full request URI, so a token in a query string is a live credential written in
// clear into a file under no retention rule. The other two ops tokens had this
// removed on 2026-08-25; this one must never acquire it.
eq('?token= is not a way in', (await get(`/api/admin/worklist?token=${TOKEN}`)).status, 401);

// UNSET MUST MEAN NOBODY, not everybody. tokenMatches() returns false on an
// empty `expected`, so an unconfigured portal admits no operator at all — the
// same failure direction as METRICS_TOKEN and STATUS_TOKEN. This is the arm that
// catches a refactor turning a missing secret into an open door.
const saved = process.env.OPERATOR_TOKEN;
delete process.env.OPERATOR_TOKEN;
eq('with OPERATOR_TOKEN unset, the token stops working', (await get('/api/admin/worklist', { bearer: TOKEN })).status, 401);
eq('…and an empty Bearer does not slip through the gap', (await get('/api/admin/worklist', { bearer: '' })).status, 401);
// The control: an admin session is unaffected by the variable's absence, so the
// two assertions above are about the token and not about the route.
eq('…while an admin session is unaffected', (await get('/api/admin/worklist', { session: adminTok })).status, 200);
process.env.OPERATOR_TOKEN = saved;
eq('…and it works again once the variable is back', (await get('/api/admin/worklist', { bearer: TOKEN })).status, 200);

// ===========================================================================
console.log(failures ? `\n${failures} FAILED\n` : '\nAll operator-token assertions pass.\n');
process.exit(failures ? 1 : 0);
