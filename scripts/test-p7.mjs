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
const { defaultOutputs, effectiveOutputs, resolveGen, hasRoutesKey, EXPERT_DIR } = await import('../src/maps/engine.js');

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
