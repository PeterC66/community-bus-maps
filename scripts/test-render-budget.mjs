// The per-USER budget on the routes that run a generator — technical-audit
// _2026-08-19 O7's second half, via buses-data OA-039, as assertions.
//
//   node scripts/test-render-budget.mjs        (or: npm run test:render-budget)
//
// WHY THIS FILE EXISTS. O7 asked for two things and shipped one and a half. The
// per-IP limit went on the five public POSTs and the bounded-caches half was
// answered three different ways; the routes that spawn a GENERATOR got neither,
// and the audit's sentence for them is that "any authenticated editor can
// saturate the single VM". `withMapLock()` looks like it covers this and does
// not: it serialises per MAP, so one editor cannot stack requests on one map and
// can still run every map they own at once. Nothing anywhere asserted a bound.
//
// WHAT WOULD MAKE THE FIX LOOK DONE WHILE IT WAS NOT, and therefore what these
// cases are shaped to catch:
//
//   1. A limit that is really per IP. One organisation behind one office NAT
//      would share a bucket and one editor changing network would get a fresh
//      one. Case: two DIFFERENT users from the SAME address, and the second is
//      not refused by the first's spending.
//   2. A per-ROUTE counter. Four routes an editor can reach run a generator, so
//      four counters would let a caller alternate and spend four times the CPU
//      while obeying each. Case: the budget is spent on /preview and the refusal
//      is then observed on /save.
//   3. A limit that collides with the PUBLIC per-address counter, which lives in
//      the same map by design. Case: a user spends the whole render budget and a
//      public POST from the same address still gets through.
//   4. A limit in front of the authorisation check, which would let one editor
//      exhaust ANOTHER's budget by aiming requests at a map they do not own.
//      Case: a non-owner hammers the route and the owner is still served.
//
// The refusals are read by STATUS AND SENTENCE. A 403 from the CSRF hook or a
// 409 from the publication freeze would satisfy a code-only assertion and prove
// nothing about a budget.
//
// Runs against a throwaway DATA_DIR; no network, no email, no real portal data.
// The maps have no built data, so a request that gets PAST the budget fails in
// the generator — which is exactly what makes the two outcomes distinguishable
// here: past the budget is 4xx-that-is-not-429 or 500, refused is 429.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-render-budget-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1'; // build the app, bind no socket
process.env.NODE_ENV = 'test';
delete process.env.OPERATOR_TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const { RENDER_BUDGET, RENDER_BUDGET_MESSAGE } = await import('../src/http/helpers.js');
const { app } = await import('../src/server.js');
await app.ready();

const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

// One customer with two editors, and a second customer whose editor owns
// nothing here — case 4 needs somebody the guard will turn away.
const cust = db.insertCustomer({ name: 'Owner Council', type: 'council', quota_areas: 2, quota_places: 2 });
const otherCust = db.insertCustomer({ name: 'Other Council', type: 'council', quota_areas: 2, quota_places: 2 });
const alice = db.insertUser({ email: 'alice@example.com', name: 'Alice', role: 'editor', customer_id: cust });
const bob = db.insertUser({ email: 'bob@example.com', name: 'Bob', role: 'editor', customer_id: cust });
const mallory = db.insertUser({ email: 'mallory@example.com', name: 'Mallory', role: 'editor', customer_id: otherCust });
const mapId = db.insertMap({ customer_id: cust, slug: 'owned-town', name: 'Owned Town', kind: 'area', status: 'draft' });

let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const aliceTok = openSession(alice), bobTok = openSession(bob), malloryTok = openSession(mallory);

const CSRF = 'test-csrf-token-value';

// ONE ADDRESS FOR EVERYBODY, deliberately. If the limit were per IP rather than
// per user, every case below would still be reachable and cases 1 and 3 would be
// the only ones that could tell — which is why they exist.
const OFFICE = '203.0.113.9';

const post = (url, token, body) => app.inject({
  method: 'POST',
  url,
  remoteAddress: '127.0.0.1',
  headers: {
    'x-forwarded-for': OFFICE,
    cookie: `cbm_session=${token}; cbm_csrf=${CSRF}`,
    'x-csrf-token': CSRF,
    'content-type': 'application/json',
  },
  payload: JSON.stringify(body || {}),
});

const preview = (token) => post(`/api/maps/${mapId}/preview`, token, { overrides: {} });
const save = (token) => post(`/api/maps/${mapId}/save`, token, { overrides: {}, note: 'x' });

const refused = (res) => {
  if (res.statusCode !== 429) return false;
  let body = {};
  try { body = JSON.parse(res.body); } catch { /* a 429 with an unreadable body is not the refusal we mean */ }
  return body.error === RENDER_BUDGET_MESSAGE;
};

console.log('\nthe budget exists, and it is spent by a generator route:');

check('RENDER_BUDGET is a positive finite number the routes can share',
  Number.isFinite(RENDER_BUDGET) && RENDER_BUDGET > 0, `RENDER_BUDGET is ${JSON.stringify(RENDER_BUDGET)}`);

// Spend exactly the budget, then one more. Asserting WHERE the first refusal
// falls — and not merely that one eventually does — is what holds the figure to
// the constant rather than to whatever the code happens to do.
let firstRefusal = null;
for (let i = 1; i <= RENDER_BUDGET + 1; i++) {
  const res = await preview(aliceTok);
  if (refused(res) && firstRefusal === null) firstRefusal = i;
}
eq(`Alice is refused on render ${RENDER_BUDGET + 1}, not before`, firstRefusal, RENDER_BUDGET + 1);

console.log('\ncase 2 — ONE budget across the routes, not one each:');

// Alice's budget is already gone, spent entirely on /preview. If /save carried a
// counter of its own she would have a fresh twenty here.
check('a save is refused on a budget spent entirely on previews',
  refused(await save(aliceTok)),
  'the save was allowed, so /preview and /save are counting separately and a caller can alternate');

console.log('\ncase 1 — PER USER, not per address:');

// Same office, same forwarded address, different person.
check('Bob is served from the SAME address that has just exhausted Alice',
  !refused(await preview(bobTok)),
  'Bob was refused, so the bucket is keyed by address and one NAT shares one budget');

console.log('\ncase 3 — the render budget does not consume the PUBLIC per-address limit:');

// The honeypot arm of /api/public/feedback costs a rate-limit hit and writes
// nothing — the same arm scripts/test-trust-proxy.mjs spends twenty of.
const publicKnock = await app.inject({
  method: 'POST',
  url: '/api/public/feedback',
  remoteAddress: '127.0.0.1',
  headers: { 'x-forwarded-for': OFFICE, 'content-type': 'application/json' },
  payload: { website_hp: 'a-bot-filled-this-in' },
});
check('a public POST from that address is still served',
  publicKnock.statusCode !== 429,
  `got ${publicKnock.statusCode}; the render key is colliding with the address key in the shared counter map`);

console.log('\ncase 4 — the budget is spent by the OWNER, never by a stranger:');

// Mallory owns nothing here: loadOwnedMap() turns her away before the budget is
// consulted, so her requests must cost Bob nothing.
let malloryRefused = false;
for (let i = 0; i < RENDER_BUDGET + 5; i++) {
  if (refused(await preview(malloryTok))) malloryRefused = true;
}
check('a non-owner is refused by the guard and never by the budget',
  !malloryRefused,
  'a stranger got a 429, which means the budget is checked BEFORE ownership');
check('and Bob, who owns the map, is still served after all of that',
  !refused(await preview(bobTok)),
  "a stranger's requests spent the owner's budget");

await app.close();

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
