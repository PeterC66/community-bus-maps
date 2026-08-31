/*
 * refresh-place-fixture.mjs — regenerate a place fixture's reference SVG/JPG.
 *
 * scripts/verify-reproduce-place.mjs compares a fixture's SHIPPED internal.svg
 * against what the vendored engine produces right now. When an engine change moves
 * those bytes on purpose, the reference has to be recut or the gate stays red for
 * ever — and a red gate nobody can clear is a gate that gets muted.
 *
 * This reuses the verifier's OWN scratch/vendor/generate path so the reference it
 * writes is by construction what the gate will regenerate, rather than something
 * built a slightly different way that happens to look right.
 *
 * WHAT `unchanged` DOES NOT MEAN (buses-data OA-188). This script copies the fixture
 * into scratch and re-runs the generator against the fixture's OWN stored data, exactly
 * as the byte gate does — so it answers "does the current engine redraw this fixture
 * from what the fixture holds", and it cannot answer "is what the fixture holds still
 * what the derivation scripts would produce". It reported a boarding fixture
 * `unchanged` while that fixture was 924 bytes behind the sheet being shipped, and it
 * had to be re-staged by hand (buses-data `b9adaa5`). The DERIVED files carry the
 * version of the script that wrote them, so the stamps are printed below alongside the
 * byte verdict rather than left for a reader to assume. Neither Python script is
 * vendored here, so the version they are compared AGAINST is a question only the buses
 * repo can answer — `status.js` gates it there, on the fixtures as well as on the
 * places, and this line is the pointer to it.
 *
 * Run from the portal root, with no placeholders:
 *     node scripts/refresh-place-fixture.mjs "<absolute path to the fixture folder>"
 * Add --apply to write; without it nothing is touched.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE_DIR, generateSvg, rasterise } from '../src/render/renderMap.js';

const PLACE_GENS = ['gen_internal.js', 'gen_internal_place.js', 'gen_external_places.js'];
const PLACE_ENGINE_DIR = path.join(ENGINE_DIR, 'place');
const EXPERT = path.join(ENGINE_DIR, 'expert');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FIXTURE = args.find(a => !a.startsWith('--'));
if (!FIXTURE || !existsSync(FIXTURE)) {
  console.error('usage: node scripts/refresh-place-fixture.mjs "<fixture dir>" [--apply]');
  process.exit(2);
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-refresh-place-'));
cpSync(FIXTURE, scratch, { recursive: true });
for (const g of PLACE_GENS) cpSync(path.join(PLACE_ENGINE_DIR, g), path.join(scratch, g));
writeFileSync(path.join(scratch, 'package.json'), '{ "type": "commonjs" }\n');

const baseOvPath = [path.join(scratch, 'base-overrides.json'), path.join(scratch, 'overrides.json')].find(existsSync);
const base = baseOvPath ? JSON.parse(readFileSync(baseOvPath, 'utf8')) : {};
const ovTmp = path.join(scratch, '_baseline-overrides.json');
writeFileSync(ovTmp, JSON.stringify(base));

const routesJson = JSON.parse(readFileSync(path.join(FIXTURE, 'routes.json'), 'utf8'));
const targets = [
  ['gen_internal_place.js', 'internal.svg', 'internal.jpg'],
  ['gen_external_places.js', 'external.svg', 'external.jpg'],
];
if (routesJson.internalSchematic) targets.push([path.join(EXPERT, 'gen_internal_schematic.js'), 'internal-schematic.svg', 'internal-schematic.jpg']);
if (routesJson.internalDiagram) targets.push([path.join(EXPERT, 'gen_internal_diagram.js'), 'internal-diagram.svg', 'internal-diagram.jpg']);
if (routesJson.boardingPlan) targets.push([path.join(EXPERT, 'gen_boarding.js'), 'boarding.svg', 'boarding.jpg']);

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${FIXTURE}\n`);

// The stored data this whole run reproduces FROM, and the script version that wrote
// it. A byte verdict below is a statement about the engine; these two lines are the
// input it is a statement about, and nothing else here reads them.
for (const derived of ['boarding_index.json', 'stands.json']) {
  const dp = path.join(FIXTURE, derived);
  if (!existsSync(dp)) continue;
  let by = null;
  try { by = JSON.parse(readFileSync(dp, 'utf8')).generatedBy || null; } catch { by = null; }
  console.log(`  stored data  ${derived.padEnd(22)} ${by || '(no generatedBy stamp)'}`);
}
console.log('  (a byte verdict below says the engine redraws this data; it says nothing about');
console.log('   whether the data is current — buses-data status.js gates that.)\n');
for (const [generator, svgName, jpgName] of targets) {
  const ref = path.join(FIXTURE, svgName);
  if (!existsSync(ref)) continue;
  // stamp:false for the same reason the gate passes it — the pilot stamp is applied
  // after generation and is not part of the generator's bytes.
  const { svgPath } = generateSvg({ dataDir: scratch, generator, iconsDir: ENGINE_DIR, overridesFile: ovTmp, stamp: false });
  const before = readFileSync(ref).length, after = readFileSync(svgPath).length;
  const same = readFileSync(ref).equals(readFileSync(svgPath));
  console.log(`  ${svgName.padEnd(24)} ${before} B -> ${after} B  ${same ? 'unchanged' : 'RECUT'}`);
  if (APPLY && !same) {
    copyFileSync(svgPath, ref);
    const outJpg = path.join(scratch, 're_' + jpgName);
    await rasterise(readFileSync(svgPath), outJpg);
    if (existsSync(path.join(FIXTURE, jpgName))) copyFileSync(outJpg, path.join(FIXTURE, jpgName));
  }
}
rmSync(scratch, { recursive: true, force: true });
console.log(APPLY ? '\ndone — now run: npm run verify:place' : '\nnothing written (pass --apply)');
