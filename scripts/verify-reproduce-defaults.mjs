// Acceptance test for the "design/labels keys still DO something" invariant —
// specifically, that EACH of the twelve G5-promoted keys' escape hatch
// (`design:{key:false}`, `labels:{engine:"v1"}`) is still live code, not dead
// code a later edit silently stopped reaching.
//
// WHY THIS SHAPE, IN TWO CORRECTIONS FROM THE FIRST DRAFT.
//
// Draft 1 built AS-IS, deleted `design`/`labels` entirely, rebuilt, and
// asserted byte-identity. Wrong: every real committed routes.json now carries
// `design:{}` (G5 emptied it, did not remove the key), and `RJ.design || {}`
// treats an empty object and a missing key identically — so "as-is" and
// "stripped" were the SAME INPUT before this file touched anything. Proven
// empirically: breaking the iconSet DEFAULT (the `: 'grid'` fallback, not the
// `=== false` branch) left draft 1 reporting PASS, because both builds fell
// through the same broken fallback.
//
// Draft 2 built AS-IS against ALL TWELVE keys forced to `false` at once and
// asserted the two DIFFER. Better — non-vacuous, catches "the whole escape
// hatch mechanism is dead" — but ALSO proven wrong empirically: hardcoding
// ICON_SET's value (deleting its `=== false` check entirely) still left this
// version reporting PASS, because the OTHER eleven keys still changed the
// output enough to make the two builds differ regardless. One key's escape
// hatch dying is invisible against eleven live ones.
//
// So: build AS-IS once, then build ONE VARIANT PER KEY with ONLY that key
// forced off, and assert EACH variant differs from AS-IS on its own. Slower
// (13 builds instead of 2) but this is the granularity the other eleven
// keys were hiding — confirmed by deliberately deleting ICON_SET's escape
// hatch and watching only the iconSet row go red while the other eleven stay
// green, then reverting.
//
// What this still does NOT prove: that any key's default renders the "right"
// geometry (that's verify-reproduce.mjs, against the shipped fixture), or
// that the absent path and an explicit-true path agree (no fixture anywhere
// carries explicit `true` any more, on purpose — see gotchas.md).
//
// Skips cleanly (exit 0) when FIXTURE_DIR is unset or missing.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE_DIR, generateSvg } from '../src/render/renderMap.js';

const FIXTURE = process.env.FIXTURE_DIR;
const ICONS = process.env.SKILL_ASSETS || ENGINE_DIR;
const n = (x) => Number(x).toLocaleString('en-GB');

if (!FIXTURE || !existsSync(FIXTURE)) {
  console.log('· verify-reproduce-defaults: FIXTURE_DIR not set or missing — skipping.');
  process.exit(0);
}

// Every key promoted to a default by the label-and-design-quality-plan.md G5
// rollout (2026-08-17), each named with the ONE `design`/`labels` change that
// forces it off. legendPlace lives only on gen_external_radial.js — harmless
// to force on a fixture whose generator doesn't read it, and worth keeping in
// the list for a town fixture where it does.
const KEYS = [
  ['footerSafe', { design: { footerSafe: false } }],
  ['spreadIcons', { design: { spreadIcons: false } }],
  ['iconInk', { design: { iconInk: false } }],
  ['panelScale', { design: { panelScale: false } }],
  ['scaleBar', { design: { scaleBar: false } }],
  ['routeCasing', { design: { routeCasing: false } }],
  ['cornerRadius', { design: { cornerRadius: false } }],
  ['badgeFit', { design: { badgeFit: false } }],
  ['hubFit', { design: { hubFit: false } }],
  ['legendPlace', { design: { legendPlace: false } }],
  ['iconSet', { design: { iconSet: false } }],
  ['printSafe', { design: { printSafe: false } }],
  ['labels.engine', { labels: { engine: 'v1' } }],
];

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-verify-defaults-'));
cpSync(FIXTURE, scratch, { recursive: true });
const routesPath = path.join(scratch, 'routes.json');
const baseRoutesJson = JSON.parse(readFileSync(routesPath, 'utf8'));

console.log('Escape-hatch reproduce test — proves EACH design:{key:false} / labels:{engine:"v1"} still changes the output on its own');
console.log('  fixture :', FIXTURE);
console.log('');

const targets = [
  ['gen_internal.js', 'internal.svg'],
  ['gen_external.js', 'external.svg'],
];
const EXPERT = path.join(ENGINE_DIR, 'expert');
if (baseRoutesJson.internalSchematic) targets.push([path.join(EXPERT, 'gen_internal_schematic.js'), 'internal-schematic.svg']);
if (baseRoutesJson.internalDiagram) targets.push([path.join(EXPERT, 'gen_internal_diagram.js'), 'internal-diagram.svg']);

function buildAll() {
  const out = {};
  for (const [gen] of targets) {
    const { svgPath, svgName } = generateSvg({ dataDir: scratch, generator: gen, iconsDir: ICONS, stamp: false });
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
    : 'RESULT: FAIL — see above. At least one key\'s design:{key:false} (or labels:{engine:"v1"}) no longer changes anything.',
);

rmSync(scratch, { recursive: true, force: true });
process.exit(headlineOK ? 0 : 1);
