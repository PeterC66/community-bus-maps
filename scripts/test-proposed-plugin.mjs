// The monthly-acceptance plugin: its door, and the check the door cannot make
// (OA-231, Tier 4.4).
//
// The third cut along server.js's banners, and the first where the plugin guard
// is NOT the interesting one. /api/admin is admin-only and /api/review is
// approver-only, so in both a plugin-level preHandler is the whole access
// decision. Here the hook is `requireUser` — it establishes only that somebody is
// signed in. The decision that matters is `loadOwnedMap()`, which admits the map's
// own customer or an admin, and it is per-request because it needs the map. It
// STAYS in the handlers.
//
// SO THE ASSERTION THAT EARNS THIS FILE IS THE SECOND ONE. A cut that hoisted the
// cheap guard and lost the ownership check would still pass every "anonymous is
// refused" test, while letting any signed-in customer preview, accept or decline
// somebody else's monthly refresh — reading another organisation's staged data and
// writing a version into their map. That is the fault worth a test, and it is
// exactly the fault a plugin-level guard invites you to think you have covered.
//
// Three roles are exercised against ONE map: the owner's editor (must reach), a
// DIFFERENT customer's editor (must be refused by the ownership check, not by the
// door), and an admin (must reach). The refusals are checked by their sentences,
// because a 403 from the CSRF hook would satisfy a status-code assertion and prove
// nothing about either guard.
//
// Usage, from the repository root:  node scripts/test-proposed-plugin.mjs
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-proposed-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
delete process.env.OPERATOR_TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const db = await import('../src/db/index.js');
const { app, ROUTE_TABLE } = await import('../src/server.js');
await app.ready();

const table = [...new Set(ROUTE_TABLE)].sort();
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

// Two customers, so "signed in" and "allowed" are different questions.
const ownerCust = db.insertCustomer({ name: 'Owner Council', type: 'council', quota_areas: 2, quota_places: 2 });
const otherCust = db.insertCustomer({ name: 'Other Council', type: 'council', quota_areas: 2, quota_places: 2 });
const ownerEditor = db.insertUser({ email: 'owner@example.com', name: 'Owner', role: 'editor', customer_id: ownerCust });
const otherEditor = db.insertUser({ email: 'other@example.com', name: 'Other', role: 'editor', customer_id: otherCust });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: ownerCust });
const mapId = db.insertMap({ customer_id: ownerCust, slug: 'owned-town', name: 'Owned Town', kind: 'area', status: 'draft' });

let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const ownerTok = openSession(ownerEditor), otherTok = openSession(otherEditor), adminTok = openSession(adminId);
const CSRF = 'test-csrf-token-value';
const send = (method, url, token, body) => app.inject({
  method, url,
  headers: {
    ...(token ? { cookie: `cbm_session=${token}; cbm_csrf=${CSRF}` } : { cookie: `cbm_csrf=${CSRF}` }),
    'x-csrf-token': CSRF, 'content-type': 'application/json',
  },
  payload: body === undefined ? undefined : JSON.stringify(body),
});

// Enumerated from the LIVE table, not written out here, so a fourth route added to
// the plugin is checked the same way as the first three.
const proposedRoutes = table
  .map((r) => r.split(' '))
  .filter(([m, u]) => m !== 'HEAD' && /^\/api\/maps\/:id\/proposed\/:pid\//.test(u));

console.log('\nthe plugin door');
check('the table holds the monthly-acceptance routes', proposedRoutes.length === 3,
  `${proposedRoutes.length}: ${proposedRoutes.map(([m, u]) => m + ' ' + u).join(', ')}`);

// :pid points at nothing, so a handler that is REACHED answers 400/404 rather than
// 401/403 — which is what separates "the door let me in" from "the door refused".
const fill = (u) => u.replace(':id', String(mapId)).replace(':pid', '999999');
const reached = (r) => r.statusCode !== 401 && r.statusCode !== 403;

for (const [method, url] of proposedRoutes) {
  const anon = await send(method, fill(url), null, {});
  check(`${method} ${url}: anonymous is refused by the plugin hook`,
    anon.statusCode === 401 && (anon.json() || {}).error === 'Please sign in.',
    `${anon.statusCode} ${anon.body.slice(0, 80)}`);
}

console.log('\nownership, which the plugin hook CANNOT check');
for (const [method, url] of proposedRoutes) {
  const stranger = await send(method, fill(url), otherTok, {});
  check(`${method} ${url}: another customer's editor is refused by loadOwnedMap`,
    stranger.statusCode === 403 && (stranger.json() || {}).error === 'You do not have access to this map.',
    `${stranger.statusCode} ${stranger.body.slice(0, 80)}`);

  const owner = await send(method, fill(url), ownerTok, {});
  check(`${method} ${url}: the owning customer's editor gets past both guards`,
    reached(owner), `${owner.statusCode} ${owner.body.slice(0, 80)}`);

  const admin = await send(method, fill(url), adminTok, {});
  check(`${method} ${url}: an admin gets past both guards`,
    reached(admin), `${admin.statusCode} ${admin.body.slice(0, 80)}`);
}

console.log('\nthe prefix owns its subtree and nothing else');
// The editor spine's /api/maps/* routes are NOT in this plugin and must not have
// acquired its hook. GET /api/maps is an editor route: an anonymous caller is
// still refused, but by the route's own guard — this asserts the parametric
// prefix did not widen into the namespace above it.
const editorRoute = table.find((r) => r === 'GET /api/maps');
check('the editor spine still owns GET /api/maps', !!editorRoute, table.filter((r) => r.includes('/api/maps')).slice(0, 5).join(' | '));

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all proposed-plugin checks passed');
process.exit(failures ? 1 : 0);
