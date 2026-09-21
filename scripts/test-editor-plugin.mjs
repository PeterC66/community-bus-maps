// The editor spine's API plugin: its door, and the checks the door cannot make
// (OA-231, Tier 4.4).
//
// The fourth and largest cut along server.js's banners — 14 routes under
// /api/maps at the cut, 15 since GET /api/maps/:id/poi-tiers (OA-233) —
// /api/maps — and it is the same shape as src/routes/proposed.js rather than the
// admin or review ones: the plugin's `requireUser` hook establishes only that
// somebody is signed in. Everything that matters is decided per request, because
// it needs the map:
//
//   loadOwnedMap()    the map's own customer, or an admin        — 11 routes
//   loadReadableMap() the same PLUS any platform approver        —  2 routes
//
// SO THE ASSERTION THAT EARNS THIS FILE IS NOT THE DOOR. A cut that hoisted the
// cheap guard and lost the per-map one would pass every "anonymous is refused"
// test ever written, while letting any signed-in customer read, save over,
// publish, unlist or re-render another organisation's map. Three of these routes
// write a new version; one takes a map off the public site.
//
// AND THE TWO GUARDS ARE NOT INTERCHANGEABLE, which is the second thing only a
// test can hold. An approver has no customer of their own and must reach the two
// READ routes — that is how a submitted map's print-ready files get reviewed at
// all (P4) — and must be refused by the other eleven, because reviewing a map is
// not editing it. Swap one call for the other and both directions still look
// fine from an anonymous request. The readable pair is enumerated below rather
// than derived: which route uses which guard IS the fact under test, so reading
// it out of the source would be the assertion checking its own subject.
//
// The refusals are read by their SENTENCE, not only by their status code: a 403
// from the CSRF hook would satisfy a code assertion and prove nothing about
// either guard.
//
// GET /api/poi-glyphs is checked here too, because it is the route the cut left
// BEHIND in server.js — same audience, same guard, outside the subtree — and the
// thing worth knowing about a route nobody moved is that it still has its guard.
//
// Usage, from the repository root:  node scripts/test-editor-plugin.mjs
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-editor-'));
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

// Two customers, so "signed in" and "allowed" are different questions, and an
// approver with no customer of their own, so "allowed to read" is a third.
const ownerCust = db.insertCustomer({ name: 'Owner Council', type: 'council', quota_areas: 2, quota_places: 2 });
const otherCust = db.insertCustomer({ name: 'Other Council', type: 'council', quota_areas: 2, quota_places: 2 });
const ownerEditor = db.insertUser({ email: 'owner@example.com', name: 'Owner', role: 'editor', customer_id: ownerCust });
const otherEditor = db.insertUser({ email: 'other@example.com', name: 'Other', role: 'editor', customer_id: otherCust });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'approver', customer_id: null });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: ownerCust });
const mapId = db.insertMap({ customer_id: ownerCust, slug: 'owned-town', name: 'Owned Town', kind: 'area', status: 'draft' });
db.insertMap({ customer_id: otherCust, slug: 'other-town', name: 'Other Town', kind: 'area', status: 'draft' });

let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const ownerTok = openSession(ownerEditor), otherTok = openSession(otherEditor);
const approverTok = openSession(approverId), adminTok = openSession(adminId);
const CSRF = 'test-csrf-token-value';
const send = (method, url, token, body) => app.inject({
  method, url,
  headers: {
    ...(token ? { cookie: `cbm_session=${token}; cbm_csrf=${CSRF}` } : { cookie: `cbm_csrf=${CSRF}` }),
    'x-csrf-token': CSRF, 'content-type': 'application/json',
  },
  payload: body === undefined ? undefined : JSON.stringify(body),
});

// Enumerated from the LIVE table so the fifteenth route is checked like the
// first. The monthly-acceptance subtree sits below /api/maps and is a plugin of
// its own with its own test, so it is excluded here rather than tested twice.
const editorRoutes = table
  .map((r) => r.split(' '))
  .filter(([m, u]) => m !== 'HEAD' && u.startsWith('/api/maps') && !u.includes('/proposed/'));

console.log('\nthe plugin door');
check('the table holds the editor spine', editorRoutes.length === 15,
  `${editorRoutes.length}: ${editorRoutes.map(([m, u]) => m + ' ' + u).join(', ')}`);
// Fastify's default for a route path of '/' inside a prefixed plugin is
// prefixTrailingSlash:'both', which registers /api/maps/ as well — a route the
// unsplit server never had. MEASURED rather than assumed, and the measurement
// changed this assertion: with the option removed the twin appears as
// `HEAD /api/maps/` and NOT as `GET /api/maps/`, so the obvious spelling of this
// check would have passed while the table had grown. Ask about the path, not the
// method.
check('the prefix did not add a trailing-slash twin of /api/maps',
  !table.some((r) => r.endsWith(' /api/maps/')), table.filter((r) => r.includes('/api/maps/')).slice(0, 4).join(' | '));

const fill = (u) => u.replace(':id', String(mapId)).replace(':key', 'v9.9').replace(':file', 'internal.svg');
const reached = (r) => r.statusCode !== 401 && r.statusCode !== 403;

for (const [method, url] of editorRoutes) {
  const anon = await send(method, fill(url), null, {});
  check(`${method} ${url}: anonymous is refused by the plugin hook`,
    anon.statusCode === 401 && (anon.json() || {}).error === 'Please sign in.',
    `${anon.statusCode} ${anon.body.slice(0, 80)}`);
}

console.log('\nthe per-map guards, which the plugin hook CANNOT make');
// The two routes with no :id answer for the WHOLE account rather than for one
// map, so they are asserted separately below.
const perMap = editorRoutes.filter(([, u]) => u.includes(':id'));
// Reaching a handler is cheap on all but these two, which render — a positive
// arm there would be test-lifecycle's job and a generator subprocess here. Their
// refusals are still asserted, and a refusal happens before any of that work.
const RENDERS = new Set(['POST /api/maps/:id/preview', 'POST /api/maps/:id/save']);
// Which routes read rather than own. An enumeration on purpose — see the header.
const READABLE = new Set(['GET /api/maps/:id', 'GET /api/maps/:id/versions/:key/:file']);
check('every readable route named here is really in the table',
  [...READABLE].every((r) => table.includes(r)), [...READABLE].join(' | '));

for (const [method, url] of perMap) {
  const key = `${method} ${url}`;
  const stranger = await send(method, fill(url), otherTok, {});
  check(`${key}: another customer's editor is refused by the per-map guard`,
    stranger.statusCode === 403 && (stranger.json() || {}).error === 'You do not have access to this map.',
    `${stranger.statusCode} ${stranger.body.slice(0, 80)}`);

  const approver = await send(method, fill(url), approverTok, {});
  if (READABLE.has(key)) {
    check(`${key}: an approver reaches it — loadReadableMap, so a submitted map can be reviewed`,
      reached(approver), `${approver.statusCode} ${approver.body.slice(0, 80)}`);
  } else {
    check(`${key}: an approver is refused — loadOwnedMap, because reviewing is not editing`,
      approver.statusCode === 403 && (approver.json() || {}).error === 'You do not have access to this map.',
      `${approver.statusCode} ${approver.body.slice(0, 80)}`);
  }

  if (RENDERS.has(key)) continue;
  const owner = await send(method, fill(url), ownerTok, {});
  check(`${key}: the owning customer's editor gets past both guards`,
    reached(owner), `${owner.statusCode} ${owner.body.slice(0, 80)}`);
  const admin = await send(method, fill(url), adminTok, {});
  check(`${key}: an admin gets past both guards`,
    reached(admin), `${admin.statusCode} ${admin.body.slice(0, 80)}`);
}

console.log('\nthe list route scopes its answer, which is the same decision without an :id');
const asOwner = await send('GET', '/api/maps', ownerTok);
const asOther = await send('GET', '/api/maps', otherTok);
const asAdmin = await send('GET', '/api/maps', adminTok);
const slugs = (r) => ((r.json() || {}).maps || []).map((m) => m.slug).sort();
check('the owning customer sees only its own map', JSON.stringify(slugs(asOwner)) === JSON.stringify(['owned-town']), asOwner.body.slice(0, 120));
check('the other customer sees only its own map', JSON.stringify(slugs(asOther)) === JSON.stringify(['other-town']), asOther.body.slice(0, 120));
check('an admin sees both', JSON.stringify(slugs(asAdmin)) === JSON.stringify(['other-town', 'owned-town']), asAdmin.body.slice(0, 120));
check('…and says so, because the app shells read isAdmin',
  (asAdmin.json() || {}).isAdmin === true && (asOwner.json() || {}).isAdmin === false);

console.log('\nthe route the cut left behind');
// Same audience and same guard as the plugin, but not in the /api/maps subtree,
// so it stayed in server.js with its own requireUser() call. The point of
// checking it here is that leaving a route behind is exactly how one ends up
// with a guard nobody is now responsible for.
check('GET /api/poi-glyphs is still in the table', table.includes('GET /api/poi-glyphs'));
const glyphAnon = await send('GET', '/api/poi-glyphs', null);
check('…and still refuses an anonymous caller by its own guard',
  glyphAnon.statusCode === 401 && (glyphAnon.json() || {}).error === 'Please sign in.',
  `${glyphAnon.statusCode} ${glyphAnon.body.slice(0, 80)}`);
check('…and a signed-in editor reaches it', reached(await send('GET', '/api/poi-glyphs', ownerTok)));

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all editor-plugin checks passed');
process.exit(failures ? 1 : 0);
