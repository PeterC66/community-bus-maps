// The version rule for an accepted update (buses-data OA-510, agreed by Peter
// on 2026-09-29): isMajorChange(), transformedRoutes(), the two counts
// diffRouteData() now records for them, and acceptedVersionNumber() in
// src/routes/proposed.js, which is the choice the accept route makes.
//
//   node scripts/test-version-rule.mjs
//
// THE RULE. Accepting takes a MAJOR only when at least half the routes on the
// map, and at least two, are TRANSFORMED — new, withdrawn, or with at least a
// quarter of their stops added or removed. Everything else takes a minor.
// `--major` on propose-update.mjs forces a MAJOR for a redesign. Until this rule
// every accept took a MAJOR, changed or not: of 19 live maps only one had a minor
// above 0, and Wisbech had reached v12.0.
//
// Every threshold is tested on BOTH sides — the exact boundary that takes a
// MAJOR and the case one short of it that does not — because a rule whose `>=`
// became `>` would pass every test that sits comfortably inside one side.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-version-rule-'));
process.env.DATA_DIR = scratch;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { diffRouteData, isMajorChange, transformedRoutes } = await import('../src/refresh/index.js');

// A summary as diffRouteData() writes it, with only the fields the rule reads.
const summary = (extra) => ({ routesAdded: [], routesRemoved: [], stopsChanged: [], ...extra });
// n stops named s0..s(n-1), and a data payload from { route: stopCount }.
const stops = (n, prefix = 's') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const data = (routes) => ({
  routes: { palette: Object.fromEntries(Object.keys(routes).map((r) => [r, '#000000'])) },
  atco: Object.fromEntries(Object.entries(routes).map(([r, s]) => [r, Array.isArray(s) ? s : stops(s)])),
});

console.log('\ndiffRouteData records what the rule needs');
{
  const d = diffRouteData(data({ 1: 8, 2: 4, 3: 4 }), data({ 1: [...stops(8).slice(2), 'n0'], 2: 4, 4: 4 }));
  eq('routeCount is every route on EITHER side (1, 2, 3, 4)', d.routeCount, 4);
  eq('a changed route carries its stop count BEFORE the change', d.stopsChanged, [{ id: '1', added: 1, removed: 2, before: 8 }]);
  eq('an unchanged map still counts its routes', diffRouteData(data({ 1: 3, 2: 3 }), data({ 1: 3, 2: 3 })).routeCount, 2);
}

console.log('\na route is transformed at a quarter of its stops, and not one stop short');
{
  eq('2 of 8 stops added: exactly a quarter — transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 2, removed: 0, before: 8 }] })), ['A']);
  eq('1 of 8 stops added: under a quarter — not transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 1, removed: 0, before: 8 }] })), []);
  eq('1 added + 1 removed of 8 counts as 2 — transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 1, removed: 1, before: 8 }] })), ['A']);
  eq('3 of 13 changed (23%) — not transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 3, removed: 0, before: 13 }] })), []);
  eq('4 of 13 changed (31%) — transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 0, removed: 4, before: 13 }] })), ['A']);
  eq('no `before` (a summary stored before this rule) — not transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 9, removed: 9 }] })), []);
  eq('an empty old stop list — not transformed', transformedRoutes(summary({ stopsChanged: [{ id: 'A', added: 5, removed: 0, before: 0 }] })), []);
  eq('new and withdrawn routes are transformed, once each, sorted', transformedRoutes(summary({ routesAdded: ['10', '2'], routesRemoved: ['9'], stopsChanged: [{ id: '2', added: 4, removed: 0, before: 4 }] })), ['2', '9', '10']);
}

console.log('\nhalf the routes takes a MAJOR, one short of half does not');
{
  check('2 of 4 transformed: exactly half — MAJOR', isMajorChange(summary({ routeCount: 4, routesRemoved: ['1', '2'] })) === true);
  check('1 of 4 transformed — minor', isMajorChange(summary({ routeCount: 4, routesRemoved: ['1'] })) === false);
  check('3 of 6 transformed: exactly half — MAJOR', isMajorChange(summary({ routeCount: 6, routesAdded: ['7'], routesRemoved: ['1', '2'] })) === true);
  check('2 of 5 transformed: under half — minor', isMajorChange(summary({ routeCount: 5, routesRemoved: ['1', '2'] })) === false);
  check('3 of 5 transformed — MAJOR', isMajorChange(summary({ routeCount: 5, routesRemoved: ['1', '2', '3'] })) === true);
}

console.log('\nat least two routes, however small the map');
{
  check('2 of 2 transformed — MAJOR', isMajorChange(summary({ routeCount: 2, routesAdded: ['2'], routesRemoved: ['1'] })) === true);
  check('1 of 2 transformed: half, but only one route — minor', isMajorChange(summary({ routeCount: 2, routesRemoved: ['1'] })) === false);
  check('1 of 1 transformed: all of it, but only one route — minor', isMajorChange(summary({ routeCount: 1, stopsChanged: [{ id: '1', added: 9, removed: 9, before: 10 }] })) === false);
}

console.log('\nstop changes count toward the half only once a route is transformed');
{
  const q = (added) => ({ id: 'x', added, removed: 0, before: 8 });
  check('2 of 4 routes each a quarter re-stopped — MAJOR', isMajorChange(summary({ routeCount: 4, stopsChanged: [{ ...q(2), id: '1' }, { ...q(2), id: '2' }] })) === true);
  check('2 of 4 routes each one stop short of a quarter — minor', isMajorChange(summary({ routeCount: 4, stopsChanged: [{ ...q(1), id: '1' }, { ...q(1), id: '2' }] })) === false);
  check('every route re-stopped a little — minor', isMajorChange(summary({ routeCount: 4, stopsChanged: ['1', '2', '3', '4'].map((id) => ({ ...q(1), id })) })) === false);
}

console.log('\neverything else is a minor');
{
  check('no summary — minor', isMajorChange(null) === false);
  check('an unchanged summary — minor', isMajorChange(summary({ routeCount: 4, unchanged: true })) === false);
  check('a new operator, a new timetable date, reworded destinations, new landmarks — minor', isMajorChange(summary({
    routeCount: 4, operatorsAdded: ['Stagecoach'], operatorsRemoved: ['Whippet'],
    validity: { from: 'June 2026', to: 'September 2026' },
    descChanged: [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'a', to: 'b' }, { id: '3', from: 'a', to: 'b' }],
    landmarksAdded: [{ key: 'pub:The Swan', cat: 'pub', name: 'The Swan' }],
  })) === false);
  check('a summary stored before this rule (no routeCount), every route withdrawn — minor', isMajorChange(summary({ routesRemoved: ['1', '2', '3'] })) === false);
}

console.log('\n--major forces a MAJOR for a redesign');
{
  check('forceMajor with nothing changed — MAJOR', isMajorChange(summary({ routeCount: 4, unchanged: true, forceMajor: true })) === true);
  check('forceMajor on a summary with no routeCount — MAJOR', isMajorChange({ forceMajor: true }) === true);
  check('forceMajor must be true, not merely truthy', isMajorChange(summary({ routeCount: 4, forceMajor: 'yes' })) === false);
}

console.log('\nend to end: two data payloads through diffRouteData, then the rule');
{
  const four = { 1: 8, 2: 8, 3: 8, 4: 8 };
  check('withdraw 2 of 4 — MAJOR', isMajorChange(diffRouteData(data(four), data({ 1: 8, 2: 8 }))) === true);
  check('withdraw 1 of 4 — minor', isMajorChange(diffRouteData(data(four), data({ 1: 8, 2: 8, 3: 8 }))) === false);
  check('add 2 to 4 (2 of 6) — minor', isMajorChange(diffRouteData(data(four), data({ ...four, 5: 8, 6: 8 }))) === false);
  check('add 3 to 3 (3 of 6) — MAJOR', isMajorChange(diffRouteData(data({ 1: 8, 2: 8, 3: 8 }), data({ 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 }))) === true);
  const reStop = (n) => [...stops(8).slice(n), ...stops(n, 'new')];      // n removed, n added
  check('re-stop 2 of 4 by a quarter — MAJOR', isMajorChange(diffRouteData(data(four), data({ 1: reStop(1), 2: reStop(1), 3: 8, 4: 8 }))) === true);
  check('re-stop 2 of 4 by one stop (1 of 8) — minor', isMajorChange(diffRouteData(data(four), data({ 1: [...stops(8), 'new0'], 2: [...stops(8), 'new0'], 3: 8, 4: 8 }))) === false);
}

console.log('\nacceptedVersionNumber: the number the accept route actually takes');
{
  const db = await import('../src/db/index.js');
  const { acceptedVersionNumber } = await import('../src/routes/proposed.js');
  const customerId = db.insertCustomer({ name: 'Testshire Parish Council', type: 'council' });
  const mapId = db.insertMap({ customer_id: customerId, slug: 'teston', name: 'Teston', kind: 'area', status: 'draft' });
  db.insertVersion({ map_id: mapId, major: 3, minor: 0, storage_key: 'v3.0', note: 'baseline' });
  db.insertVersion({ map_id: mapId, major: 3, minor: 1, storage_key: 'v3.1', note: 'a save' });
  eq('a small update after v3.1 takes v3.2', acceptedVersionNumber(mapId, summary({ routeCount: 4, routesRemoved: ['1'] })), { major: 3, minor: 2 });
  eq('a big update after v3.1 takes v4.0', acceptedVersionNumber(mapId, summary({ routeCount: 4, routesRemoved: ['1', '2'] })), { major: 4, minor: 0 });
  eq('--major after v3.1 takes v4.0', acceptedVersionNumber(mapId, { forceMajor: true }), { major: 4, minor: 0 });
  eq('a summary stored before this rule takes v3.2', acceptedVersionNumber(mapId, summary({ routesRemoved: ['1', '2', '3'] })), { major: 3, minor: 2 });
}

console.log(failures ? `\n✗ ${failures} failure(s)` : '\n✓ the version rule holds on both sides of every threshold');
process.exit(failures ? 1 : 0);
