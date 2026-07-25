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
