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
// A KEY MAY NEED MORE THAN ONE FIXTURE, and FIXTURE_DIR is therefore a LIST
// (`;`-separated — not `:`, because these are Windows absolute paths). A key
// passes when it changes at least one sheet on at least ONE fixture: "this
// escape hatch is live code" is a property of the ENGINE, not of any one town,
// and no single town can exercise all thirteen.
//
// That is not a convenience, it is the difference between a real gate and an
// exclusion list. Measured 2026-08-18 across all eight towns: `legendPlace`
// bites on Huntingdon alone, `badgeFit` on five towns but not Huntingdon,
// `hubFit` on seven but not March. Pick any single fixture and at least one key
// reports dead. The precedent for the alternative is the `hubFit` exclusion on
// the PLACE side, which was correct there (one four-character place name makes
// two codepaths provably identical) but is a cost every time: an excluded key is
// a key nothing tests. `legendPlace` in particular is the key whose absence let
// design.spokeSpread bury 62 pieces of artwork across six towns while every
// defect metric went down — the last one to leave untested.
//
// Why the fixtures stopped agreeing, for the record: the 2026-08-18 legend
// measurement fix made the panel 5mm narrower on Beaconsfield and St Ives, which
// let it FIT where those towns configure it, so the placement search no longer
// moves it and forcing the search off changes nothing. The key did not die; the
// sheets stopped needing it.
//
// FIXTURES. Resolved by scripts/lib/fixtures.mjs: $FIXTURE_DIR if it points at
// anything real, otherwise the COMMITTED fixture at Areas/_portal-fixture/.
// It FAILS rather than skips when there is nothing at all — see that file's
// header (technical-audit_2026-08-19 V2).
//
// Measured 2026-08-20 against the committed fixture: St Ives ALONE exercises all
// thirteen keys. That was not true two days earlier and may stop being true
// again, which is the whole reason FIXTURES is still a list — if a key reports
// dead, ask first whether this town stopped exercising it, and prefer adding a
// second fixture to excluding the key.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE_DIR, generateSvg } from '../src/render/renderMap.js';
import { resolveFixtures, reportNoFixture } from './lib/fixtures.mjs';

const { fixtures: FIXTURES } = resolveFixtures('area');
const ICONS = process.env.SKILL_ASSETS || ENGINE_DIR;
const n = (x) => Number(x).toLocaleString('en-GB');

if (!FIXTURES.length) {
  reportNoFixture('area');
  process.exit(0); // only reached under --allow-skip
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

console.log('Escape-hatch reproduce test — proves EACH design:{key:false} / labels:{engine:"v1"} still changes the output on its own');
for (const f of FIXTURES) console.log('  fixture :', f);
console.log('');

// One fixture's verdict per key: the sheets it changed, or [] for none.
function runFixture(fixture) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-verify-defaults-'));
  cpSync(fixture, scratch, { recursive: true });
  const routesPath = path.join(scratch, 'routes.json');
  const baseRoutesJson = JSON.parse(readFileSync(routesPath, 'utf8'));

  const targets = [
    ['gen_internal.js', 'internal.svg'],
    ['gen_external.js', 'external.svg'],
  ];
  const EXPERT = path.join(ENGINE_DIR, 'expert');
  if (baseRoutesJson.internalSchematic) targets.push([path.join(EXPERT, 'gen_internal_schematic.js'), 'internal-schematic.svg']);
  if (baseRoutesJson.internalDiagram) targets.push([path.join(EXPERT, 'gen_internal_diagram.js'), 'internal-diagram.svg']);

  const buildAll = () => {
    const out = {};
    for (const [gen] of targets) {
      const { svgPath, svgName } = generateSvg({ dataDir: scratch, generator: gen, iconsDir: ICONS, stamp: false });
      out[svgName] = readFileSync(svgPath);
    }
    return out;
  };

  const result = {};
  let asIs;
  try {
    asIs = buildAll();
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error(`building as-is from ${fixture}: ${e.message}`);
  }

  for (const [keyName, patch] of KEYS) {
    const forced = {
      ...baseRoutesJson,
      design: { ...(baseRoutesJson.design || {}), ...(patch.design || {}) },
      labels: { ...(baseRoutesJson.labels || {}), ...(patch.labels || {}) },
    };
    writeFileSync(routesPath, JSON.stringify(forced, null, 2));
    try {
      const built = buildAll();
      result[keyName] = targets.map(([, s]) => s).filter((s) => !asIs[s].equals(built[s]));
    } catch (e) {
      result[keyName] = { error: e.message };
    }
    writeFileSync(routesPath, JSON.stringify(baseRoutesJson, null, 2));
  }
  rmSync(scratch, { recursive: true, force: true });
  return result;
}

const perFixture = [];
for (const f of FIXTURES) {
  try {
    perFixture.push([f, runFixture(f)]);
  } catch (e) {
    console.log(`ERROR ${e.message}`);
    process.exit(1);
  }
}

let headlineOK = true;
for (const [keyName] of KEYS) {
  // A key is live if ANY fixture saw it move ink. Name the fixture that did, so a
  // future reader knows which town carries the proof and does not "tidy" it away.
  const wins = perFixture
    .map(([f, r]) => [f, r[keyName]])
    .filter(([, v]) => Array.isArray(v) && v.length);
  const errs = perFixture.filter(([, r]) => r[keyName] && r[keyName].error);
  if (wins.length) {
    const [f, sheets] = wins[0];
    const via = FIXTURES.length > 1 ? `  [via ${path.basename(path.dirname(f))}/${path.basename(f)}${wins.length > 1 ? ` +${wins.length - 1} more` : ''}]` : '';
    console.log(`— ${keyName}  ->  DIFFERS on ${sheets.join(', ')} ✓${via}`);
  } else if (errs.length) {
    console.log(`— ${keyName}\n   ERROR: ${errs[0][1][keyName].error}`);
    headlineOK = false;
  } else {
    console.log(`— ${keyName}  ->  IDENTICAL on every sheet of every fixture ✗ — this key's escape hatch changed nothing`);
    headlineOK = false;
  }
}

console.log('');
console.log(
  headlineOK
    ? `RESULT: PASS — all ${KEYS.length} escape hatches change at least one sheet; none are dead code.`
    : "RESULT: FAIL — see above. At least one key's design:{key:false} (or labels:{engine:\"v1\"}) no longer changes anything on ANY fixture.",
);

process.exit(headlineOK ? 0 : 1);
