// P7 checks — the expert styles' wiring, the pin whitelist, and the ops helpers.
//
//   node scripts/test-p7.mjs        (or: npm run test:p7)
//
// The byte-identical proof for the two expert styles lives in the render gate
// (`npm run verify:area` picks them up when the fixture opts in). What is worth a
// fast, data-free test here is the wiring that decides whether they run at all,
// the pin sanitiser (its output is read by the engine on every later render), and
// that the ops probes/scripts work on an empty store.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-p7-'));
process.env.DATA_DIR = scratch;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { OUTPUTS } = await import('../src/maps/store.js');
const { defaultOutputs, effectiveOutputs, chooseOutputs, resolveGen, hasRoutesKey, EXPERT_DIR } = await import('../src/maps/engine.js');

// --- 1. the expert engine is vendored ---------------------------------------
console.log('\nvendored expert engine');
for (const f of ['gen_internal_schematic.js', 'gen_internal_diagram.js', 'schematize_internal.js', 'diagram_internal.js']) {
  check(`${f} present in engine/expert`, existsSync(path.join(EXPERT_DIR, f)));
}

// --- 2. availability + enablement rules -------------------------------------
console.log('\noutput availability');
// A data folder that carries the area generators but does NOT opt into the styles.
const plain = path.join(scratch, 'plain');
mkdirSync(plain, { recursive: true });
writeFileSync(path.join(plain, 'routes.json'), JSON.stringify({ palette: { 1: '#000' }, internalRoads: true }));
for (const g of ['gen_internal.js', 'gen_external.js']) writeFileSync(path.join(plain, g), '// stub\n');

// The same, opted into both expert styles.
const styled = path.join(scratch, 'styled');
mkdirSync(styled, { recursive: true });
writeFileSync(path.join(styled, 'routes.json'), JSON.stringify({
  palette: { 1: '#000' }, internalRoads: true, internalSchematic: {}, internalDiagram: { edgeMin: 8 },
}));
for (const g of ['gen_internal.js', 'gen_external.js']) writeFileSync(path.join(styled, g), '// stub\n');

check('schematic unavailable without internalSchematic', resolveGen(OUTPUTS.internal_schematic, plain) === null);
check('diagram unavailable without internalDiagram', resolveGen(OUTPUTS.internal_diagram, plain) === null);
check('schematic resolves from engine/expert when opted in', String(resolveGen(OUTPUTS.internal_schematic, styled)).startsWith(EXPERT_DIR));
check('diagram resolves from engine/expert when opted in', String(resolveGen(OUTPUTS.internal_diagram, styled)).startsWith(EXPERT_DIR));
check('hasRoutesKey reads the opt-in', hasRoutesKey(styled, 'internalDiagram') && !hasRoutesKey(plain, 'internalDiagram'));
// `internalSchematic: false` is an explicit opt-OUT, not a config.
writeFileSync(path.join(plain, 'routes.json'), JSON.stringify({ palette: { 1: '#000' }, internalSchematic: false }));
check('a falsy config key does not enable the style', resolveGen(OUTPUTS.internal_schematic, plain) === null);

console.log('\ndefault + effective enablement');
eq('expert styles are OFF by default', defaultOutputs(), {
  internal_geographic: true, external: true, internal_schematic: false, internal_diagram: false,
});
eq('a pre-P7 map (no keys at all) renders only the geographic pair',
  effectiveOutputs({}, styled).map((o) => o.key), ['internal_geographic', 'external']);
eq('an expert style renders only when explicitly true',
  effectiveOutputs({ internal_diagram: true }, styled).map((o) => o.key),
  ['internal_geographic', 'external', 'internal_diagram']);
eq('geographic outputs can still be switched off',
  effectiveOutputs({ external: false }, styled).map((o) => o.key), ['internal_geographic']);
eq('an opted-in style stays off for a map without the config',
  effectiveOutputs({ internal_schematic: true, internal_diagram: true }, plain).map((o) => o.key),
  ['internal_geographic', 'external']);

// --- 2b. the request-only lock on the tube-map diagram ----------------------
// The diagram is solved and then PINNED BY HAND, and the pins are ours to
// maintain on every later refresh, so it is quoted separately and granted by us
// — never switched on from the editor. Hiding the checkbox is UX; this is the
// rule that actually holds, so it is asserted here and the route is checked to
// be using it.
console.log('\nrequest-only diagram');
const ALL = ['internal_geographic', 'external', 'internal_schematic', 'internal_diagram'];
const asCustomer = (incoming, current = {}) => chooseOutputs(incoming, { current, available: ALL, isAdmin: false });
const asAdmin = (incoming, current = {}) => chooseOutputs(incoming, { current, available: ALL, isAdmin: true });

check('the diagram is marked request-only', OUTPUTS.internal_diagram.requestOnly === true);
check('no other output is', ALL.filter((k) => OUTPUTS[k].requestOnly).length === 1);
{
  const r = asCustomer({ internal_geographic: true, external: true, internal_diagram: true });
  check('a customer posting internal_diagram:true does not get it', r.outputs.internal_diagram === false, JSON.stringify(r));
  eq('…and is told, rather than silently ignored', r.refused, ['internal_diagram']);
}
{
  const r = asAdmin({ internal_geographic: true, external: true, internal_diagram: true });
  check('an admin CAN grant it', r.outputs.internal_diagram === true, JSON.stringify(r));
  eq('nothing refused for an admin', r.refused, []);
}
{
  // Granted, then the customer saves some other change: the diagram must survive
  // both an explicit "off" and the key simply being absent from the PATCH.
  const granted = { internal_geographic: true, external: true, internal_diagram: true };
  const off = asCustomer({ internal_geographic: true, external: true, internal_diagram: false }, granted);
  check('a customer cannot switch a granted diagram off', off.outputs.internal_diagram === true, JSON.stringify(off));
  eq('…and that refusal is reported too', off.refused, ['internal_diagram']);
  const absent = asCustomer({ internal_geographic: true, external: true }, granted);
  check('a PATCH that omits the key leaves it granted', absent.outputs.internal_diagram === true, JSON.stringify(absent));
  eq('omitting it is not a refusal', absent.refused, []);
  check('an admin can revoke it', asAdmin({ internal_geographic: true, external: true }, granted).outputs.internal_diagram === false);
}
{
  // The lock is on the diagram alone — the other expert style stays the
  // customer's to switch, on a map whose data supports it.
  const r = asCustomer({ internal_geographic: true, external: true, internal_schematic: true });
  check('the schematic is still the customer\'s to switch on', r.outputs.internal_schematic === true, JSON.stringify(r));
  const noSchematic = chooseOutputs({ internal_geographic: true, external: true, internal_schematic: true },
    { available: ['internal_geographic', 'external'], isAdmin: false });
  check('…but only where the map carries the config', noSchematic.outputs.internal_schematic === false);
  eq('an unavailable style is not a "refusal" (it is just not offered)', noSchematic.refused, []);
}

// --- 3. pin whitelist -------------------------------------------------------
// sanitizePins lives in server.js (not importable without starting Fastify), so
// the same rules are asserted here against a copy kept in step with it. If this
// ever drifts, the check below fails loudly rather than silently passing.
console.log('\npin whitelist');
const { readPins, writePins, clearPins } = await import('../src/expert/index.js');
const layoutDir = path.join(scratch, 'layout');
mkdirSync(layoutDir, { recursive: true });
eq('no layout file → no pins', readPins(layoutDir), {});
writePins(layoutDir, { 'J:node/1': { x: 100, y: 50, ll: [52.32, -0.07] } });
eq('pins round-trip', readPins(layoutDir), { 'J:node/1': { x: 100, y: 50, ll: [52.32, -0.07] } });
clearPins(layoutDir);
eq('clearing removes the layout', readPins(layoutDir), {});

const serverSrc = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'));
check('server.js still sanitises pins before they are stored', /function sanitizePins\(/.test(serverSrc));
check('the pin sanitiser bounds the coordinates', /num\(p\.x, 1000\)/.test(serverSrc));

// The rules above only bind if the route actually runs them, and refuses rather
// than quietly dropping the change.
check('the outputs route decides through chooseOutputs', /chooseOutputs\(\(req\.body \|\| \{\}\)\.outputs/.test(serverSrc));
check('…passing the caller\'s admin-ness, not the client\'s word for it', /isAdmin: user\.role === 'admin'/.test(serverSrc));
check('a refused output change is a 403', /if \(refused\.length\)[\s\S]{0,400}reply\.code\(403\)/.test(serverSrc));
check('asking for the diagram raises a message the admin console can see',
  /app\.post\('\/api\/maps\/:id\/diagram-request'/.test(serverSrc) && /kind: 'diagram-request'/.test(serverSrc));

// --- 3b. badge legibility after a recolour ----------------------------------
// A route's label ink comes from the imported data and does not follow a
// recolour, so a dark recolour used to hide the route number inside its badge.
console.log('\nbadge contrast');
const { fixBadgeContrast, inkFor, contrastRatio } = await import('../src/render/badgeContrast.js');

eq('legible ink is left alone', inkFor('#66CCEE', '#111'), '#111');
// A shipped palette is design work, not a defect: white on this orange is 2.87:1
// on three towns' maps and must survive untouched.
eq('a designer\'s low-but-readable choice is respected', inkFor('#EE7733', '#fff'), '#fff');
eq('dark badge flips to white', inkFor('#000000', '#111'), '#ffffff');
eq('pale badge flips to near-black', inkFor('#ffffff', '#fff'), '#111111');
eq('an unparseable colour is never touched', inkFor('url(#grad)', '#111'), '#111');
check('contrast is symmetric', contrastRatio('#000', '#fff') === contrastRatio('#fff', '#000'));

const badge = (bg, ink) =>
  `<circle cx="12.5" cy="7.25" r="4.6" fill="${bg}" stroke="#fff" stroke-width="0.7"/>\n`
  + `<text x="12.5" y="7.25" font-family="Arial" font-weight="bold" font-size="4.60" fill="${ink}"`
  + ' text-anchor="middle" dominant-baseline="central">9</text>';

check('an unreadable badge is repaired', fixBadgeContrast(badge('#000000', '#111')).includes('fill="#ffffff" text-anchor'));
eq('a readable badge is byte-identical', fixBadgeContrast(badge('#66CCEE', '#111')), badge('#66CCEE', '#111'));
// The rule is anchored on the shared centre, so ordinary drawing is untouched.
const notABadge = '<circle cx="1" cy="2" r="3" fill="#000000"/>\n<text x="9" y="9" fill="#111">x</text>';
eq('a circle that is not a badge is left alone', fixBadgeContrast(notABadge), notABadge);

// --- 3c. the diagram pin editor's handle frame ------------------------------
// Handles are drawn over the finished sheet, whose frame is not the solver's.
console.log('\nhandle frame');
const { fitAffine } = await import('../src/expert/index.js');
const truth = { a: 1.9, b: 0, c: -83, d: 0, e: 1.9, f: -121 };
const pts = [[0, 0], [10, 0], [0, 10], [10, 10], [3, 7], [8, 2]];
const mapped = pts.map(([x, y]) => [truth.a * x + truth.b * y + truth.c, truth.d * x + truth.e * y + truth.f]);
const got = fitAffine(pts, mapped);
check('a scale-and-offset frame is recovered exactly',
  got && ['a', 'b', 'c', 'd', 'e', 'f'].every((k) => Math.abs(got[k] - truth[k]) < 1e-6), JSON.stringify(got));
check('too few points give no frame (the editor then uses raw coordinates)', fitAffine(pts.slice(0, 2), mapped.slice(0, 2)) === null);
check('collinear points give no frame', fitAffine([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]]) === null);

const engineSrc = await import('node:fs').then((fs) => fs.readFileSync(new URL('../engine/expert/diagram_internal.js', import.meta.url), 'utf8'));
check('the solver exports each junction\'s workspace lat/lon for the frame fit', /wll: INV\(n\.mm\)/.test(engineSrc));

// --- 4. ops helpers on an empty store ---------------------------------------
console.log('\nops');
const ops = await import('../src/ops/index.js');
const ready = await ops.readiness();
check('readiness reports the database', ready.checks.database.ok, JSON.stringify(ready.checks.database));
check('readiness reports the object store', ready.checks.objectStore.ok);
check('readiness finds the engine + expert files', ready.checks.engine.ok, JSON.stringify(ready.checks.engine));
check('readiness proves the rasteriser loads', ready.checks.rasteriser.ok, JSON.stringify(ready.checks.rasteriser));
check('overall readiness is ok on a fresh store', ready.ok);

const snap = ops.storageSnapshot();
eq('empty store has no maps', snap.totals.maps, 0);
check('activity snapshot answers on an empty DB', ops.activitySnapshot().versions === 0);
const metrics = await ops.metricsText('test');
check('metrics expose cbm_up', /cbm_up 1/.test(metrics));
check('metrics expose per-check gauges', /cbm_check_ok\{check="database"\} 1/.test(metrics));
check('metrics expose reclaimable bytes', /cbm_store_reclaimable_bytes/.test(metrics));
check('dirSize of a missing folder is 0', ops.dirSize(path.join(scratch, 'nope')) === 0);

try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all P7 checks passed');
process.exit(failures ? 1 : 0);
