// P0 acceptance test: prove the portal reproduces an already-shipped leaflet.
//
// Given FIXTURE_DIR = one staged town render folder from the separate Buses repo
// (containing a generator + its data + the shipped SVG/JPG), this:
//   1. copies it to a scratch dir (never touching the originals),
//   2. re-runs the generator and checks the regenerated SVG is BYTE-IDENTICAL
//      to the shipped SVG  (the determinism proof — the headline result),
//   3. rasterises the shipped SVG and compares to the shipped JPG
//      (render-parity — byte / pixel / near, reported for information).
//
// Skips cleanly (exit 0) when FIXTURE_DIR is unset or missing, so a fresh clone
// without the data repo still passes `npm run verify`.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ENGINE_DIR, generateSvg, rasterise } from '../src/render/renderMap.js';
import { warnIfStaleSibling } from './lib/fixture-freshness.mjs';

const FIXTURE = process.env.FIXTURE_DIR;
const ICONS = process.env.SKILL_ASSETS || ENGINE_DIR;
const n = (x) => Number(x).toLocaleString('en-GB');

if (!FIXTURE || !existsSync(FIXTURE)) {
  console.log('· verify-reproduce: FIXTURE_DIR not set or missing — skipping.');
  console.log('  Point FIXTURE_DIR at a staged town render folder to run it (see .env.example).');
  process.exit(0);
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
  for (let i = 0; i < A.length; i++) {
    const d = Math.abs(A[i] - B[i]);
    if (d > maxDiff) maxDiff = d;
    sum += d;
  }
  return { dims, sameDims: true, identical: maxDiff === 0, maxDiff, meanDiff: sum / A.length };
}

async function checkOne(scratch, shippedDir, generator, svgName, jpgName) {
  const shippedSvgPath = path.join(shippedDir, svgName);
  if (!existsSync(shippedSvgPath)) return null;
  const r = { generator, svgName, jpgName };

  // (1) SVG determinism
  const shippedSvg = readFileSync(shippedSvgPath);
  // PILOT: stamp: false — this gate compares the GENERATOR's bytes against a shipped
  // fixture, so the pilot stamp (which is applied after generation) must not be
  // added here. See src/render/pilotStamp.js.
  const { svgPath } = generateSvg({ dataDir: scratch, generator, iconsDir: ICONS, stamp: false });
  const reproSvg = readFileSync(svgPath);
  r.svgShipped = shippedSvg.length;
  r.svgRepro = reproSvg.length;
  r.svgIdentical = shippedSvg.equals(reproSvg);

  // (2) render parity vs shipped JPG (informational)
  const shippedJpgPath = path.join(shippedDir, jpgName);
  if (existsSync(shippedJpgPath)) {
    const outJpg = path.join(scratch, 're_' + jpgName);
    await rasterise(shippedSvg, outJpg);
    const shippedJpg = readFileSync(shippedJpgPath);
    const reproJpg = readFileSync(outJpg);
    r.jpgShipped = shippedJpg.length;
    r.jpgRepro = reproJpg.length;
    r.jpgByteIdentical = shippedJpg.equals(reproJpg);
    r.pix = await pixelCompare(shippedJpg, reproJpg);
  }
  return r;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-verify-'));
cpSync(FIXTURE, scratch, { recursive: true });

console.log('Byte-identical reproduce test');
console.log('  fixture :', FIXTURE);
console.log('  icons   :', ICONS);
console.log('');
warnIfStaleSibling(FIXTURE);

const targets = [
  ['gen_internal.js', 'internal.svg', 'internal.jpg'],
  ['gen_external.js', 'external.svg', 'external.jpg'],
];

// P7 expert styles. They are portal-owned (engine/expert/, passed as an absolute
// path) and opt-in per map, so they are only checked when this fixture's
// routes.json asks for them — and then they must be byte-identical too, since
// they re-run the map's own gen_internal.js on schematised geometry.
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

let headlineOK = true;
let ran = 0;
for (const [gen, svg, jpg] of targets) {
  let r;
  try {
    r = await checkOne(scratch, FIXTURE, gen, svg, jpg);
  } catch (e) {
    console.log(`— ${gen}\n   ERROR: ${e.message}\n`);
    headlineOK = false;
    continue;
  }
  if (!r) continue;
  ran++;
  console.log(`— ${path.basename(gen)}`);
  console.log(
    `   SVG  shipped ${n(r.svgShipped)} B  vs  regenerated ${n(r.svgRepro)} B  ->  ` +
      (r.svgIdentical ? 'BYTE-IDENTICAL ✓' : 'DIFFERS ✗'),
  );
  if (!r.svgIdentical) headlineOK = false;
  if (r.jpgShipped != null) {
    const verdict = r.jpgByteIdentical
      ? 'BYTE-IDENTICAL ✓'
      : r.pix.identical
        ? 'pixel-identical (metadata bytes differ) ✓'
        : r.pix.sameDims
          ? `same size, max pixel Δ ${r.pix.maxDiff}, mean Δ ${r.pix.meanDiff.toFixed(3)}`
          : 'DIFFERENT DIMENSIONS ✗';
    console.log(
      `   JPG  shipped ${n(r.jpgShipped)} B  vs  re-rendered ${n(r.jpgRepro)} B  [${r.pix.dims}]  ->  ${verdict}`,
    );
  }
  console.log('');
}

if (ran === 0) {
  console.log('No matching generators/SVGs found in the fixture — nothing to check.');
}
console.log(
  headlineOK && ran > 0
    ? 'RESULT: PASS — the generator is deterministic and the portal reproduces the shipped SVG byte-for-byte.'
    : 'RESULT: see above.',
);

rmSync(scratch, { recursive: true, force: true });
process.exit(headlineOK && ran > 0 ? 0 : 1);
