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
import { existsSync, cpSync } from 'node:fs';

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
const { sheetsInPayloadDir, writeSheetDeclaration, readSheetDeclaration, SHEETS_FILE } = await import('../src/maps/store.js');

// --- 1. the expert engine is vendored ---------------------------------------
console.log('\nvendored expert engine');
for (const f of ['gen_internal_schematic.js', 'gen_internal_diagram.js', 'schematize_internal.js', 'diagram_internal.js', 'gen_boarding.js']) {
  check(`${f} present in engine/expert`, existsSync(path.join(EXPERT_DIR, f)));
}

// --- 2. availability + enablement rules -------------------------------------
console.log('\noutput availability');
// A data folder that carries the area generators but does NOT opt into the styles.
const plain = path.join(scratch, 'plain');
mkdirSync(plain, { recursive: true });
writeFileSync(path.join(plain, 'routes.json'), JSON.stringify({ palette: { 1: '#000' }, internalRoads: true }));
for (const g of ['gen_internal.js', 'gen_external.js']) writeFileSync(path.join(plain, g), '// stub\n');
// `internal_geographic` gained `requiresFiles: ['routes_paths.json']` on 2026-08-24,
// so a synthetic payload now has to carry one to stand in for a real map. All 23
// payload directories under data/maps do, and so do both non-boarding fixtures; the
// only payload in the system without one is the boarding-only fixture, which is the
// case the requirement exists for (asserted below).
writeFileSync(path.join(plain, 'routes_paths.json'), '{}');

// The same, opted into both expert styles.
const styled = path.join(scratch, 'styled');
mkdirSync(styled, { recursive: true });
writeFileSync(path.join(styled, 'routes.json'), JSON.stringify({
  palette: { 1: '#000' }, internalRoads: true, internalSchematic: {}, internalDiagram: { edgeMin: 8 },
}));
for (const g of ['gen_internal.js', 'gen_external.js']) writeFileSync(path.join(styled, g), '// stub\n');
writeFileSync(path.join(styled, 'routes_paths.json'), '{}');

// A PLACE that opts into the boarding plan. `requiresConfig` is only half of its
// gate: the generator also reads a stand register and a destination index, and
// exits non-zero without them — which would fail the whole map's render rather
// than this one sheet. `requiresFiles` is what turns that into "unavailable".
const boarding = path.join(scratch, 'boarding');
mkdirSync(boarding, { recursive: true });
writeFileSync(path.join(boarding, 'routes.json'), JSON.stringify({ palette: { 1: '#000' }, boardingPlan: { frameRadiusM: 200 } }));

check('schematic unavailable without internalSchematic', resolveGen(OUTPUTS.internal_schematic, plain) === null);
check('diagram unavailable without internalDiagram', resolveGen(OUTPUTS.internal_diagram, plain) === null);
check('schematic resolves from engine/expert when opted in', String(resolveGen(OUTPUTS.internal_schematic, styled)).startsWith(EXPERT_DIR));
check('diagram resolves from engine/expert when opted in', String(resolveGen(OUTPUTS.internal_diagram, styled)).startsWith(EXPERT_DIR));
check('hasRoutesKey reads the opt-in', hasRoutesKey(styled, 'internalDiagram') && !hasRoutesKey(plain, 'internalDiagram'));
// `internalSchematic: false` is an explicit opt-OUT, not a config.
writeFileSync(path.join(plain, 'routes.json'), JSON.stringify({ palette: { 1: '#000' }, internalSchematic: false }));
check('a falsy config key does not enable the style', resolveGen(OUTPUTS.internal_schematic, plain) === null);
check('boarding plan unavailable without boardingPlan', resolveGen(OUTPUTS.boarding_plan, plain) === null);
check('boarding plan unavailable with the config but no stand register',
  resolveGen(OUTPUTS.boarding_plan, boarding) === null);
writeFileSync(path.join(boarding, 'stands.json'), '{"verdict":"OK","stands":[]}');
check('…still unavailable with only half the data', resolveGen(OUTPUTS.boarding_plan, boarding) === null);
writeFileSync(path.join(boarding, 'boarding_index.json'), '{"destinations":[],"stands":[]}');
check('boarding plan resolves from engine/expert once the config AND the data are there',
  String(resolveGen(OUTPUTS.boarding_plan, boarding)).startsWith(EXPERT_DIR));

// A BOARDING-ONLY PLACE HAS NO ROUTE GEOMETRY AND MUST NOT BE OFFERED AN INTERNAL
// SHEET. `import-map.mjs` copies the vendored place engine into every place map, so
// `gen_internal_place.js` is present and the output LOOKED renderable; it then died
// on the missing `routes_paths.json` (ENOENT, exit 1) and took the whole import down
// with it, leaving a half-built map row. Two of the four boarding sheets we hold
// could not reach the portal at all. Measured on the real fixture 2026-08-24.
// The generator is written here deliberately: it proves the FILE is what decides,
// not the generator simply being absent from a bare fixture.
writeFileSync(path.join(boarding, 'gen_internal_place.js'), '// stub\n');
check('a boarding-only payload is not offered an internal sheet',
  resolveGen(OUTPUTS.internal_geographic, boarding) === null);
writeFileSync(path.join(boarding, 'routes_paths.json'), '{}');
check('…and is offered one as soon as route geometry is there',
  resolveGen(OUTPUTS.internal_geographic, boarding) === 'gen_internal_place.js');

// --- 2c. what the PAYLOAD declares it has (OA-009) ---------------------------
//
// Renderability used to be decided by whether a GENERATOR resolved, and that got
// both possible answers wrong. St Ives Bus Station has no external radial — the
// solver cannot fan its eight spokes without putting Cambridge in the wrong
// direction — and the portal rendered a 20,563-byte external.svg with real
// spokes anyway. An S5-render folder holds one `<base>.svg` per sheet the skill
// actually built, which is the same set the S4 manifest lists and, unlike the
// manifest, travels with the folder a delivery scps to the host.
//
// MEASURED ACROSS THE WHOLE ESTATE before making it, because it changes what a
// map is offered: of the 20 payloads under Areas/ and Places/, the declaration
// changes the answer on exactly ONE — St Ives Bus Station, which loses its
// external. Every other map is offered precisely what it is offered today.
console.log('\ndeclared sheets');
{
  // A source folder shaped like a real S5-render dir: the sheets, the payload,
  // and the incidental files that must not be mistaken for sheets.
  const src = path.join(scratch, 'src-declares');
  mkdirSync(src, { recursive: true });
  for (const f of ['internal.svg', 'boarding.svg', 'internal.jpg', 'unplaced.json', 'notes.svg']) {
    writeFileSync(path.join(src, f), 'x');
  }
  eq('only known output bases are read as sheets, in OUTPUTS order',
    sheetsInPayloadDir(src), ['internal', 'boarding']);
  eq('a folder with no sheets declares nothing', sheetsInPayloadDir(plain), []);

  // The declaration is written beside the payload, and read back.
  const declared = path.join(scratch, 'declared');
  mkdirSync(declared, { recursive: true });
  for (const f of ['routes.json', 'routes_paths.json', 'gen_internal.js', 'gen_external.js']) {
    cpSync(path.join(styled, f), path.join(declared, f));
  }
  check('with no declaration, both geographic sheets resolve as before',
    !!resolveGen(OUTPUTS.internal_geographic, declared) && !!resolveGen(OUTPUTS.external, declared));
  check('…and readSheetDeclaration says it does not know', readSheetDeclaration(declared) === null);

  eq('writing one records exactly what the source held', writeSheetDeclaration(declared, src), ['internal', 'boarding']);
  eq('…and it reads back', readSheetDeclaration(declared), ['internal', 'boarding']);
  check('the declaration lives beside the payload', existsSync(path.join(declared, SHEETS_FILE)));

  // THE DEFECT, in one assertion: a generator that resolves is no longer enough.
  check('a sheet the payload did not build is NOT offered, even though its generator resolves',
    resolveGen(OUTPUTS.external, declared) === null);
  check('…while a sheet it did build still is',
    resolveGen(OUTPUTS.internal_geographic, declared) === 'gen_internal.js');
  eq('effectiveOutputs drops it too, so nothing renders a sheet nobody declared',
    effectiveOutputs({}, declared).map((o) => o.key), ['internal_geographic']);
  // The schematic goes with it, and that is deliberate rather than collateral:
  // this payload opts into `internalSchematic` and is `buildAlways`, so it would
  // have rendered one — but the folder it was delivered from built no
  // internal-schematic.svg, and the declaration is the more specific answer. In
  // practice this never bites, which was measured too: every one of the eight
  // town S5 folders and every place that carries a schematic declares one.
  check('a buildAlways output is not exempt from the declaration',
    resolveGen(OUTPUTS.internal_schematic, declared) === null);

  // A SOURCE WE CANNOT READ MUST NOT BECOME "NOTHING IS AVAILABLE". Absent means
  // "don't know", which is what keeps every map imported before this unchanged.
  const undeclared = path.join(scratch, 'undeclared');
  mkdirSync(undeclared, { recursive: true });
  for (const f of ['routes.json', 'routes_paths.json', 'gen_internal.js', 'gen_external.js']) {
    cpSync(path.join(styled, f), path.join(undeclared, f));
  }
  eq('an empty source writes no declaration at all', writeSheetDeclaration(undeclared, plain), null);
  check('…and the map keeps every output it had', !!resolveGen(OUTPUTS.external, undeclared));
}

// --- 2d. a requirement that belongs to ONE generator, not to the output ------
//
// `gen_external_places.js` aggregates `destinations` from routes.json. Handed a
// payload with none it exits 0 and draws a radial with no spokes — a blank sheet
// offered as "Where those buses go", which is worse than an error. But putting
// `requiresConfig: 'destinations'` on the OUTPUT would blank the external on
// every live town map, because an AREA payload is fed by `gen_external.js` and
// carries no such key. MEASURED: 10 of the 20 payloads have no usable
// `destinations`, and 8 of those are town maps drawing an external today. On the
// candidate, the guard reaches exactly the two boarding-only places.
console.log('\na per-generator requirement');
{
  const areaLike = path.join(scratch, 'area-like');
  mkdirSync(areaLike, { recursive: true });
  writeFileSync(path.join(areaLike, 'routes.json'), JSON.stringify({ palette: { 1: '#000' } }));
  writeFileSync(path.join(areaLike, 'gen_external.js'), '// stub\n');
  check('an AREA payload with no destinations key still gets its external',
    resolveGen(OUTPUTS.external, areaLike) === 'gen_external.js');

  const placeNoDest = path.join(scratch, 'place-no-dest');
  mkdirSync(placeNoDest, { recursive: true });
  writeFileSync(path.join(placeNoDest, 'routes.json'), JSON.stringify({ place: 'Somewhere', palette: { 1: '#000' } }));
  writeFileSync(path.join(placeNoDest, 'gen_external_places.js'), '// stub\n');
  check('a PLACE payload with no destinations is not offered a blank radial',
    resolveGen(OUTPUTS.external, placeNoDest) === null);

  writeFileSync(path.join(placeNoDest, 'routes.json'), JSON.stringify({ place: 'Somewhere', palette: { 1: '#000' }, destinations: [] }));
  check('an EMPTY destinations list is not a declaration either — [] is truthy and means nothing',
    resolveGen(OUTPUTS.external, placeNoDest) === null);

  writeFileSync(path.join(placeNoDest, 'routes.json'), JSON.stringify({ place: 'Somewhere', palette: { 1: '#000' }, destinations: [{ name: 'Elsewhere', routes: ['1'] }] }));
  check('…and it is offered as soon as there is somewhere to draw a spoke to',
    resolveGen(OUTPUTS.external, placeNoDest) === 'gen_external_places.js');
}

console.log('\ndefault + effective enablement');
eq('expert styles are OFF by default (visibility, not build)', defaultOutputs(), {
  internal_geographic: true, external: true, internal_schematic: false, internal_diagram: false,
  boarding_plan: false,
});
eq('the schematic is a buildAlways output — it renders once the config is present, before any enablement',
  effectiveOutputs({}, styled).map((o) => o.key), ['internal_geographic', 'external', 'internal_schematic']);
eq('a plain map (no expert config at all) renders only the geographic pair',
  effectiveOutputs({}, plain).map((o) => o.key), ['internal_geographic', 'external']);
eq('the diagram (not buildAlways) still renders only when explicitly true',
  effectiveOutputs({ internal_diagram: true }, styled).map((o) => o.key),
  ['internal_geographic', 'external', 'internal_schematic', 'internal_diagram']);
eq('an explicit false does not stop a buildAlways output from rendering — it only hides it from the customer',
  effectiveOutputs({ internal_schematic: false }, styled).map((o) => o.key),
  ['internal_geographic', 'external', 'internal_schematic']);
eq('geographic outputs can still be switched off',
  effectiveOutputs({ external: false }, styled).map((o) => o.key), ['internal_geographic', 'internal_schematic']);
eq('the diagram opt-in stays off for a map without the config; buildAlways does not apply to it',
  effectiveOutputs({ internal_schematic: true, internal_diagram: true }, plain).map((o) => o.key),
  ['internal_geographic', 'external']);

// --- 2b. the request-only lock on the tube-map diagram ----------------------
// The diagram is solved and then PINNED BY HAND, and the pins are ours to
// maintain on every later refresh, so it is quoted separately and granted by us
// — never switched on from the editor. Hiding the checkbox is UX; this is the
// rule that actually holds, so it is asserted here and the route is checked to
// be using it.
console.log('\nrequest-only diagram');
const ALL = ['internal_geographic', 'external', 'internal_schematic', 'internal_diagram', 'boarding_plan'];
const asCustomer = (incoming, current = {}) => chooseOutputs(incoming, { current, available: ALL, isAdmin: false });
const asAdmin = (incoming, current = {}) => chooseOutputs(incoming, { current, available: ALL, isAdmin: true });

check('the diagram is marked request-only', OUTPUTS.internal_diagram.requestOnly === true);
// The boarding plan joined it on 2026-08-23, for a related but not identical
// reason: not hand-placed pins, but a frame radius, an empty-stand rule and a
// locator's landmarks that are decided per place and then maintained.
check('the boarding plan is request-only too', OUTPUTS.boarding_plan.requestOnly === true);
eq('and those two are the only ones', ALL.filter((k) => OUTPUTS[k].requestOnly),
  ['internal_diagram', 'boarding_plan']);
{
  const r = asCustomer({ internal_geographic: true, external: true, boarding_plan: true });
  check('a customer posting boarding_plan:true does not get it', r.outputs.boarding_plan === false, JSON.stringify(r));
  eq('…and is told', r.refused, ['boarding_plan']);
  check('an admin CAN grant the boarding plan',
    asAdmin({ internal_geographic: true, external: true, boarding_plan: true }).outputs.boarding_plan === true);
}
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
