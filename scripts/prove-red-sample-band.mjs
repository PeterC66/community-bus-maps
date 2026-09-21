// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// prove-red-sample-band.mjs — falsify test-sample-band.mjs (buses-data OA-320).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-sample-band
//
// WHY THIS EXISTS, AND WHY IT MATTERS MORE HERE THAN USUAL. The suite it breaks
// is green today for a reason that has nothing to do with the code being right:
// every customer on the live site is a sample customer, so a band on every sheet
// is the correct output whatever the mechanism does. `sample` also defaults to
// TRUE, which means a render path that forgets to ask behaves identically to one
// that asked and was told yes. A suite over that population, with that default,
// would stay green with the entire change reverted — so it means nothing until
// it has been watched go red.
//
// Each arm is broken ON PURPOSE and required to go red BY ITSELF, and the
// harness checks WHICH assertion objected rather than that something did: a
// mutation caught by the wrong assertion is reported as WRONG CAUSE, because the
// suite would be sensitive to the damage but not for the reason claimed.
//
// THE ARM THAT MATTERS MOST is "the reconciler ignores its answer", because that
// mutation restores the EXACT code that shipped before OA-320 — one global
// question asked of PILOT.on. If the suite cannot tell that apart from the fix,
// the fix is not tested; it is merely present.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `scripts/` and `src/` are copied
// into a scratch tree and the copy is damaged. Nothing is moved aside and
// restored, because a harness that restores in a `finally` still leaves the
// repository broken if it is killed between the two.

import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-sample-band-'));
  for (const dir of ['scripts', 'src']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  // Linked, not copied: large, and nothing here damages them. NEVER point
  // damage() at a path under one of these — a junction leads back into the real
  // checkout, so an edit "to the copy" would vandalise the repository this
  // harness exists to protect.
  for (const dir of ['node_modules', 'engine']) {
    const from = path.join(ROOT, dir);
    if (!existsSync(from)) continue;
    try { symlinkSync(from, path.join(tmp, dir), 'junction'); } catch { cpSync(from, path.join(tmp, dir), { recursive: true }); }
  }
  writeFileSync(path.join(tmp, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));
  return tmp;
}

/** Edit one file in the scratch copy. Fails loudly if the anchor has moved — a
 *  mutation whose anchor no longer matches is a STALE harness, not a pass. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

function runSuite(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-sample-band.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// Anchored on the suite's own two-space indent: assertion names carry em dashes,
// so an unanchored '✗' would misread this.
const failedLines = (out) => out.split('\n').filter((l) => /^ {2}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

let problems = 0;

/**
 * @param {string} what   what is being broken
 * @param {(tmp:string)=>void} mutate
 * @param {string} expect a distinctive fragment of the assertion that must object
 */
function arm(what, mutate, expect) {
  const tmp = scratch();
  mutate(tmp);
  const { code, out } = runSuite(tmp);
  if (code === 0) {
    problems += 1;
    console.error(`  ✗ SURVIVED  ${what}\n      the suite passed with this broken — it is not testing it`);
    return;
  }
  if (!caughtBy(out, expect)) {
    problems += 1;
    console.error(`  ✗ WRONG CAUSE  ${what}\n      went red, but not on "${expect}"\n      red on: ${failedLines(out).map((l) => l.trim()).join('\n              ') || '(nothing matched the ✗ shape)'}`);
    return;
  }
  console.log(`  ✓ RED       ${what}`);
}

console.log('\nBreaking the sample band on purpose, one thing at a time:\n');

arm('the predicate stops exempting demo organisations',
  (t) => damage(t, 'src/render/pilotStamp.js', '  if (c.is_demo) return true;', '  // mutated'),
  'a demo organisation is a sample whatever is_sample says');

arm('the predicate treats an unjoined column as a real organisation',
  (t) => damage(t, 'src/render/pilotStamp.js',
    '  if (c.is_sample === 0 || c.is_sample === false) return false;\n  return true;',
    '  return c.is_sample === 1 || c.is_sample === true;'),
  'so is a row with no columns joined');

arm('the inverse becomes approximate — the band comes off but the wrapper stays',
  (t) => damage(t, 'src/render/pilotStamp.js',
    "    .replace(/<g id=\"pilot-content\"[^>]*>\\n?/, '')\n", ''),
  'unstampPilot(stampPilot(s)) === s, byte for byte');

arm('generateSvg stops honouring sample — the one line the change turns on',
  (t) => damage(t, 'src/render/renderMap.js', 'if (sample) out = stampPilot(out);', 'out = stampPilot(out);'),
  'sample: false leaves it alone');

arm('stamp: false stops beating everything else',
  (t) => damage(t, 'src/render/renderMap.js',
    '  if (stamp) {\n    let out = fixBadgeContrast(readFileSync(svgPath, \'utf8\'));\n    if (sample) out = stampPilot(out);',
    '  if (true) {\n    let out = fixBadgeContrast(readFileSync(svgPath, \'utf8\'));\n    if (sample) out = stampPilot(out);'),
  'stamp: false still beats sample: true');

arm('a shippable render path stops asking (renderVersion drops it)',
  (t) => damage(t, 'src/maps/engine.js',
    '        // mean the watermark\'s caching duplicated across four more surfaces.\n        sample,\n',
    '        // mean the watermark\'s caching duplicated across four more surfaces.\n'),
  'src/maps/engine.js');

arm('THE REGRESSION ITSELF — the reconciler goes back to one global question',
  (t) => damage(t, 'src/render/pilotReconcile.js', '  const want = PILOT.on && !!isSample;', '  const want = PILOT.on;'),
  'a sample sheet under a REAL customer would change');

// BOTH no-op guards, because either one alone absorbs the damage and the
// mutation is then unobservable — which the first version of this arm reported
// as SURVIVED until the difference was measured rather than assumed. The fast
// path (`hasPilotBand(before) === want`) and the belt-and-braces one
// (`after === before`) are independently sufficient, so neither is separately
// falsifiable and demanding that the suite catch one of them on its own would be
// demanding it notice a difference that does not exist. Together they are the
// property that matters: a reconcile of a store already in the right state must
// not rewrite and re-rasterise artwork an approver signed off.
arm('the reconciler stops being idempotent (it rewrites what is already right)',
  (t) => {
    damage(t, 'src/render/pilotReconcile.js', '      if (hasPilotBand(before) === want) continue;', '');
    damage(t, 'src/render/pilotReconcile.js', '      if (after === before) continue;', '');
  },
  'running it again is a no-op');

arm('a dry run starts writing',
  (t) => damage(t, 'src/render/pilotReconcile.js', "      if (!apply) { log?.(`· would ${want ? 'stamp' : 'unstamp'}: ${label}`); continue; }", '      if (!apply) { /* mutated: falls through and writes */ }'),
  'and a dry run wrote nothing');

arm('an exemption is left behind after its call site has gone',
  (t) => damage(t, 'scripts/test-sample-band.mjs',
    "  { file: 'src/expert/index.js', match: 'DIAGRAM_GEN',",
    "  { file: 'src/expert/index.js', match: 'A_CALL_THAT_IS_NOT_THERE',"),
  'still matches a real call');

// THE CONTROL. Without it every arm above would pass with the suite hard-wired
// to exit 1, and the harness would be proving nothing but its own plumbing.
{
  const tmp = scratch();
  const { code, out } = runSuite(tmp);
  if (code !== 0) {
    problems += 1;
    console.error(`  ✗ CONTROL   an UNDAMAGED copy went red — the harness cannot tell damage from the ordinary state\n      ${failedLines(out).map((l) => l.trim()).join('\n      ')}`);
  } else {
    console.log('  ✓ CONTROL   an undamaged copy stays green');
  }
}

if (problems) {
  console.error(`\n✗ ${problems} arm(s) of the sample-band suite are not doing their job`);
  process.exit(1);
}
console.log('\n✓ every arm of the sample-band suite was watched go red, and the control stayed green');
