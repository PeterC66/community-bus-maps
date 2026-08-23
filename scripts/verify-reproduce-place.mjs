// Acceptance test for the VENDORED PLACE ENGINE: prove the portal reproduces a
// skill-rendered place leaflet byte-for-byte.
//
// Given PLACE_FIXTURE_DIR = a self-consistent place fixture (the *.json payload,
// an optional base-overrides.json of expert framing, and the reference
// internal/external SVG+JPG rendered by the make-place-bus-leaflet skill from that
// same payload), this:
//   1. copies it to a scratch dir (never touching the originals),
//   2. copies in the vendored place engine (engine/place/) exactly as the importer
//      would, and renders the baseline (customer overrides {} => the framing only),
//   3. checks each regenerated SVG is BYTE-IDENTICAL to the reference (headline),
//   4. rasterises + compares the JPG (render parity — informational).
//
// FIXTURES. Same rule as the area gate since 2026-08-20: resolved by
// scripts/lib/fixtures.mjs — $PLACE_FIXTURE_DIR if it points at anything real,
// otherwise the committed fixture at Places/_portal-fixture/ — and it FAILS
// rather than skips when there is nothing (technical-audit_2026-08-19 V2). The
// place fixture was already committed; what was missing was the refusal to
// pass without it.

import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ENGINE_DIR, generateSvg, rasterise } from '../src/render/renderMap.js';
import { warnIfFileSkew } from './lib/fixture-freshness.mjs';
import { resolveFixtures, reportNoFixture } from './lib/fixtures.mjs';

// EVERY committed fixture, not just the first. It took [0] from the day the
// list existed, which was harmless while there was one place fixture and quietly
// wrong the moment there were two: a second fixture — the one carrying the sheet
// a change is actually about — would sit in the repo being skipped, and the gate
// would go green having never opened it.
const { fixtures: FIXTURES } = resolveFixtures('place');
const PLACE_ENGINE_DIR = fileURLToPath(new URL('../engine/place', import.meta.url));
const PLACE_GENS = ['gen_internal.js', 'gen_internal_place.js', 'gen_external_places.js'];
const n = (x) => Number(x).toLocaleString('en-GB');

if (!FIXTURES.length) {
  reportNoFixture('place');
  process.exit(0); // only reached under --allow-skip
}

async function pixelCompare(aBuf, bBuf) {
  const [a, b] = await Promise.all([
    sharp(aBuf).raw().toBuffer({ resolveWithObject: true }),
    sharp(bBuf).raw().toBuffer({ resolveWithObject: true }),
  ]);
  const dims = `${a.info.width}x${a.info.height}`;
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { dims, sameDims: false, identical: false, maxDiff: 255, meanDiff: 255 };
  }
  let maxDiff = 0, sum = 0;
  const A = a.data, B = b.data;
  for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); if (d > maxDiff) maxDiff = d; sum += d; }
  return { dims, sameDims: true, identical: maxDiff === 0, maxDiff, meanDiff: sum / A.length };
}

async function checkOne(scratch, refDir, generator, svgName, jpgName, overridesFile) {
  const refSvgPath = path.join(refDir, svgName);
  if (!existsSync(refSvgPath)) return null;
  const r = { generator, svgName, jpgName };

  const refSvg = readFileSync(refSvgPath);
  // PILOT: stamp: false — this gate compares the GENERATOR's bytes against a shipped
  // fixture, so the pilot stamp (which is applied after generation) must not be
  // added here. See src/render/pilotStamp.js.
  const { svgPath } = generateSvg({ dataDir: scratch, generator, iconsDir: ENGINE_DIR, overridesFile, stamp: false });
  const reproSvg = readFileSync(svgPath);
  r.svgRef = refSvg.length;
  r.svgRepro = reproSvg.length;
  r.svgIdentical = refSvg.equals(reproSvg);

  const refJpgPath = path.join(refDir, jpgName);
  if (existsSync(refJpgPath)) {
    const outJpg = path.join(scratch, 're_' + jpgName);
    // Rasterise the REGENERATED svg, not the reference one. Rasterising the
    // reference only ever proves the rasteriser is deterministic, so it reported
    // "pixel-identical" even on a run where the SVG genuinely DIFFERED — which is
    // exactly the run where you need the JPG line to be believable.
    await rasterise(reproSvg, outJpg);
    r.pix = await pixelCompare(readFileSync(refJpgPath), readFileSync(outJpg));
  }
  return r;
}

/** Run the whole gate against ONE fixture. @returns {{ok:boolean, ran:number}} */
async function runFixture(FIXTURE) {
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-verify-place-'));
cpSync(FIXTURE, scratch, { recursive: true });
// Vendor the place engine into the payload, exactly as scripts/import-map.mjs does.
for (const g of PLACE_GENS) cpSync(path.join(PLACE_ENGINE_DIR, g), path.join(scratch, g));
writeFileSync(path.join(scratch, 'package.json'), '{ "type": "commonjs" }\n');

// Baseline overrides = the expert framing (base-overrides.json) with an empty
// customer layer merged on top — which is just the framing itself. Passing it as
// OVERRIDES_FILE reproduces exactly what renderVersion(id, {}) does for v1.0.
//
// Filename: accept either base-overrides.json OR overrides.json, matching
// import-map.mjs's own fallback (its comment: "a fresh skill payload carries
// it as overrides.json; a live-derived payload already has it split out as
// base-overrides.json"). Checking only the split-out name meant this gate
// reported a false DIFFERS on every fresh, not-yet-portal-staged place
// fixture — caught 2026-08-09 on Beaconsfield Simpson Centre's first real
// delivery, which ships overrides.json, not base-overrides.json.
const baseOvPath = [path.join(scratch, 'base-overrides.json'), path.join(scratch, 'overrides.json')].find(existsSync);
const base = baseOvPath ? JSON.parse(readFileSync(baseOvPath, 'utf8')) : {};
const ovTmp = path.join(scratch, '_baseline-overrides.json');
writeFileSync(ovTmp, JSON.stringify(base));

console.log('Byte-identical reproduce test — PLACE engine');
console.log('  fixture :', FIXTURE);
console.log('  icons   :', ENGINE_DIR);
console.log('  framing :', baseOvPath ? `${path.basename(baseOvPath)} present (merged)` : 'none');
console.log('');

const targets = [
  ['gen_internal_place.js', 'internal.svg', 'internal.jpg'],
  ['gen_external_places.js', 'external.svg', 'external.jpg'],
];

// P7 expert styles, place-aware (2026-08-08 fix). Portal-owned (engine/expert/,
// passed as an absolute path) and opt-in per map — checked here only when this
// fixture's routes.json asks for them, same as verify-reproduce.mjs's area
// version. schematize_internal.js/diagram_internal.js detect the place case
// themselves (gen_internal_place.js present in the payload, vendored above) and
// apply the place's title/version-stamp fix, so this is also the regression
// gate for that fix — DIFFERS here would mean the place branch broke.
const routesJson = (() => {
  try { return JSON.parse(readFileSync(path.join(FIXTURE, 'routes.json'), 'utf8')); } catch { return {}; }
})();
const EXPERT = path.join(ENGINE_DIR, 'expert');
if (routesJson.internalSchematic) {
  targets.push([path.join(EXPERT, 'gen_internal_schematic.js'), 'internal-schematic.svg', 'internal-schematic.jpg']);
}
if (routesJson.internalDiagram) {
  targets.push([path.join(EXPERT, 'gen_internal_diagram.js'), 'internal-diagram.svg', 'internal-diagram.jpg']);
}
// The boarding plan (2026-08-23). Portal-owned like the two expert styles above,
// opt-in on the same `requiresConfig` pattern, and the only output whose
// generator is run by the portal against inputs no other sheet reads
// (stands.json, boarding_index.json). checkOne() returns null when the fixture
// carries no reference SVG, so a place without one is silently skipped.
if (routesJson.boardingPlan) {
  targets.push([path.join(EXPERT, 'gen_boarding.js'), 'boarding.svg', 'boarding.jpg']);
}

warnIfFileSkew(FIXTURE, targets.flatMap(([, svg, jpg]) => [svg, jpg]));

let headlineOK = true;
let ran = 0;
for (const [gen, svg, jpg] of targets) {
  let r;
  try {
    r = await checkOne(scratch, FIXTURE, gen, svg, jpg, ovTmp);
  } catch (e) {
    console.log(`— ${gen}\n   ERROR: ${e.message}\n`);
    headlineOK = false;
    continue;
  }
  if (!r) continue;
  ran++;
  console.log(`— ${gen}`);
  console.log(`   SVG  reference ${n(r.svgRef)} B  vs  regenerated ${n(r.svgRepro)} B  ->  ${r.svgIdentical ? 'BYTE-IDENTICAL ✓' : 'DIFFERS ✗'}`);
  if (!r.svgIdentical) headlineOK = false;
  if (r.pix) {
    const verdict = r.pix.identical
      ? 'pixel-identical ✓'
      : r.pix.sameDims ? `same size, max pixel Δ ${r.pix.maxDiff}, mean Δ ${r.pix.meanDiff.toFixed(3)}` : 'DIFFERENT DIMENSIONS ✗';
    console.log(`   JPG  [${r.pix.dims}]  ->  ${verdict}`);
  }
  console.log('');
}

if (ran === 0) console.log('No matching generators/SVGs found in the fixture — nothing to check.');
rmSync(scratch, { recursive: true, force: true });
return { ok: headlineOK, ran };
}

let allOK = true;
let totalRan = 0;
for (const f of FIXTURES) {
  const r = await runFixture(f);
  if (!r.ok) allOK = false;
  totalRan += r.ran;
}
console.log(
  allOK && totalRan > 0
    ? `RESULT: PASS — the vendored place engine reproduces ${totalRan} skill-rendered sheet(s) byte-for-byte, across ${FIXTURES.length} fixture(s).`
    : 'RESULT: see above.',
);
process.exit(allOK && totalRan > 0 ? 0 : 1);
