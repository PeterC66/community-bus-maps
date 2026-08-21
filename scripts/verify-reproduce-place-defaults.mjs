// Place-engine sibling of verify-reproduce-defaults.mjs — see that file's header
// for the full design history (two wrong drafts, both proven wrong empirically,
// before landing on "build one variant per key, forced off, and assert each
// differs from as-is on its own"). Given PLACE_FIXTURE_DIR, this builds every
// applicable sheet as-is, then once per key with ONLY that key forced to its
// off value, and asserts each variant differs from as-is on at least one sheet.
//
// legendPlace is deliberately EXCLUDED from the key list here — it is not
// among the keys promoted to a default on the PLACE engine (plan Phase 8 item
// 3b: measured no better than the search gen_external_places.js already had),
// so it stays real per-fixture config, not something this gate should force.
//
// FIXTURES: resolved by ./lib/fixtures.mjs, and it FAILS rather than skips when
// there is nothing to run against (technical-audit_2026-08-19 V2).

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_DIR, generateSvg } from '../src/render/renderMap.js';
import { resolveFixtures, reportNoFixture } from './lib/fixtures.mjs';

// Fixture resolution and the no-skip rule live in ./lib/fixtures.mjs
// (technical-audit_2026-08-19 V2).
const FIXTURE = resolveFixtures('place').fixtures[0];
const PLACE_ENGINE_DIR = fileURLToPath(new URL('../engine/place', import.meta.url));
const PLACE_GENS = ['gen_internal.js', 'gen_internal_place.js', 'gen_external_places.js'];

if (!FIXTURE) {
  reportNoFixture('place');
  process.exit(0); // only reached under --allow-skip
}

const KEYS = [
  ['footerSafe', { design: { footerSafe: false } }],
  ['spreadIcons', { design: { spreadIcons: false } }],
  ['iconInk', { design: { iconInk: false } }],
  ['panelScale', { design: { panelScale: false } }],
  ['scaleBar', { design: { scaleBar: false } }],
  ['routeCasing', { design: { routeCasing: false } }],
  ['cornerRadius', { design: { cornerRadius: false } }],
  ['badgeFit', { design: { badgeFit: false } }],
  // hubFit excluded: untestable by the High Wycombe Aldi fixture, not dead code. Both the
  // hubFit-on and legacy-off HUB_W formulas in gen_external_places.js are `Math.max(26, ...)`,
  // and "Aldi" is short enough that the 26mm floor wins under both, so the two codepaths are
  // byte-identical for this one place regardless of what hubFit does. Confirmed 2026-08-18 by
  // isolated re-run against the unmutated engine (still IDENTICAL, all other 11 keys DIFFER) and
  // by reading HUB_W's two branches directly. See design-quality.md, "The PLACE external" section.
  // A fixture with a longer place name would need to cover this key; none is available yet.
  ['iconSet', { design: { iconSet: false } }],
  ['printSafe', { design: { printSafe: false } }],
  ['labels.engine', { labels: { engine: 'v1' } }],
];

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-verify-place-defaults-'));
cpSync(FIXTURE, scratch, { recursive: true });
for (const g of PLACE_GENS) cpSync(path.join(PLACE_ENGINE_DIR, g), path.join(scratch, g));
writeFileSync(path.join(scratch, 'package.json'), '{ "type": "commonjs" }\n');
const routesPath = path.join(scratch, 'routes.json');
const baseRoutesJson = JSON.parse(readFileSync(routesPath, 'utf8'));

// Baseline overrides stay fixed across every build, same as verify-reproduce-place.mjs.
const baseOvPath = [path.join(scratch, 'base-overrides.json'), path.join(scratch, 'overrides.json')].find(existsSync);
const base = baseOvPath ? JSON.parse(readFileSync(baseOvPath, 'utf8')) : {};
const ovTmp = path.join(scratch, '_baseline-overrides.json');
writeFileSync(ovTmp, JSON.stringify(base));

console.log('Escape-hatch reproduce test — PLACE engine — proves EACH design:{key:false} / labels:{engine:"v1"} still changes the output on its own');
console.log('  fixture :', FIXTURE);
console.log('');

const targets = [
  ['gen_internal_place.js', 'internal.svg'],
  ['gen_external_places.js', 'external.svg'],
];
const EXPERT = path.join(ENGINE_DIR, 'expert');
if (baseRoutesJson.internalSchematic) targets.push([path.join(EXPERT, 'gen_internal_schematic.js'), 'internal-schematic.svg']);
if (baseRoutesJson.internalDiagram) targets.push([path.join(EXPERT, 'gen_internal_diagram.js'), 'internal-diagram.svg']);

function buildAll() {
  const out = {};
  for (const [gen] of targets) {
    const { svgPath, svgName } = generateSvg({ dataDir: scratch, generator: gen, iconsDir: ENGINE_DIR, overridesFile: ovTmp, stamp: false });
    out[svgName] = readFileSync(svgPath);
  }
  return out;
}

let asIs;
try {
  asIs = buildAll();
} catch (e) {
  console.log(`ERROR building as-is: ${e.message}`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

let headlineOK = true;
for (const [keyName, patch] of KEYS) {
  const forced = {
    ...baseRoutesJson,
    design: { ...(baseRoutesJson.design || {}), ...(patch.design || {}) },
    labels: { ...(baseRoutesJson.labels || {}), ...(patch.labels || {}) },
  };
  writeFileSync(routesPath, JSON.stringify(forced, null, 2));
  let built;
  try {
    built = buildAll();
  } catch (e) {
    console.log(`— ${keyName}\n   ERROR: ${e.message}`);
    headlineOK = false;
    continue;
  }
  const changedSheets = targets.map(([, svgName]) => svgName).filter((svgName) => !asIs[svgName].equals(built[svgName]));
  const ok = changedSheets.length > 0;
  if (!ok) headlineOK = false;
  console.log(`— ${keyName}  ->  ${ok ? `DIFFERS on ${changedSheets.join(', ')} ✓` : 'IDENTICAL on every sheet ✗ — this key\'s escape hatch changed nothing'}`);
}

console.log('');
console.log(
  headlineOK
    ? `RESULT: PASS — all ${KEYS.length} escape hatches change at least one sheet; none are dead code.`
    : 'RESULT: FAIL — see above.',
);

rmSync(scratch, { recursive: true, force: true });
process.exit(headlineOK ? 0 : 1);
