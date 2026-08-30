// prove-red-engine-source.mjs — falsify the external-generator provenance work.
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-engine-source
//
// WHY THIS EXISTS. Everything OA-143 added is a REFUSAL: the tracker refuses to
// guess which of two vendored generators a pack's `gen_external.js` came from,
// and the backfill refuses to settle a pack whose two signals disagree. A
// refusal is the hardest thing to test green, because code that has quietly
// stopped refusing passes every "it tracks the declared one" assertion in
// `test-engine-source.mjs` while silently overwriting a busway map with the
// radial generator — the exact corruption this row exists to prevent, arriving
// under a full row of ticks.
//
// So each guard is broken ON PURPOSE and required to go red BY ITSELF, and the
// harness checks WHICH assertion objected rather than that something did. A
// mutation caught by the wrong test is reported as such: it would mean the suite
// is sensitive to the damage but not for the reason claimed.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `scripts/` is copied into a
// scratch tree and the copy is damaged. Nothing is moved aside and restored,
// because a harness that restores in a `finally` still leaves the repository
// broken if it is killed between the two.
//
// EIGHT RUNS. One control and seven mutations, and the control is not decoration:
// every arm going red at once would mean the copy is broken, not the guards.

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* The scratch tree is a copy of `scripts/` ONLY, and `test-engine-source.mjs`
 * reaches for its subjects relative to its own location — so a copy of the suite
 * runs the copied, damaged scripts. `import-map.mjs` additionally imports
 * `../src/db` and checks that `engine/` is vendored, neither of which is copied,
 * so the scratch tree is given a symlink (or a copy) to the real `src/`,
 * `node_modules/` and `engine/`. Those are never damaged; only files under the
 * copied `scripts/` are. */
function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-engine-source-'));
  cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  for (const dir of ['src', 'node_modules', 'engine']) {
    const from = path.join(ROOT, dir), to = path.join(tmp, dir);
    try { symlinkSync(from, to, 'junction'); }
    catch { cpSync(from, to, { recursive: true }); }
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-engine-source.mjs')], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** Which assertions failed in that run.
 *
 *  NOT split on ' — ': the suite uses an em dash both as its name/detail
 *  separator AND inside several test names, so splitting truncated every
 *  expected name at its first dash and reported two genuine catches as WRONG
 *  CAUSE. A harness that misreads its own subject's output is the same fault it
 *  is here to catch, one level up. Match on the whole line instead. */
const failedLines = (out) => out.split('\n').filter((l) => l.includes('✗ ') && !/✗ map /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

let problems = 0;
const results = [];

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guards', failedLines(r.out).map((l) => l.trim()).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', '']);
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'the tracker GUESSES radial when the pack declares nothing',
    why: 'this is the corruption the row refuses: a busway map silently given the radial generator',
    file: 'scripts/track-engine.mjs',
    find: "    const rel = declared && typeof declared.generators[name] === 'string' ? declared.generators[name] : null;",
    to: "    const rel = (declared && typeof declared.generators[name] === 'string' ? declared.generators[name] : null) || 'area/gen_external_radial.js';",
    expect: 'a pack that declares NOTHING is still skipped — the tracker never guesses',
  },
  {
    what: 'the tracker ignores the declaration and always uses the radial file',
    file: 'scripts/track-engine.mjs',
    why: 'a declaration that is read and then discarded looks identical on a radial-only board',
    find: "    const vendored = path.join(ENGINE, rel);\n    if (!existsSync(vendored)) {",
    to: "    const vendored = path.join(ENGINE, 'area/gen_external_radial.js');\n    if (!existsSync(vendored)) {",
    expect: 'a busway pack is given the BUSWAY generator, not the radial one',
  },
  {
    what: 'the importer stops recording what it staged',
    why: 'this is the state the row found: the answer known at import and thrown away, so every future pack arrives undeclared',
    file: 'scripts/import-map.mjs',
    find: '    if (as !== path.basename(from)) generators[as] = rel;   // only the renamed, ambiguous ones',
    to: '    if (false) generators[as] = rel;',
    expect: 'importing a generator-free area payload records the external generator it staged',
  },
  {
    what: 'the importer records the style it was NOT asked for',
    why: 'a field that is always radial is decorative on a board where every town is radial',
    file: 'scripts/import-map.mjs',
    find: "    const rel = path.relative(ENGINE_ROOT, from).split(path.sep).join('/');",
    to: "    const rel = 'area/gen_external_radial.js';",
    expect: '--external-style busway is recorded as busway, not as the default',
  },
  {
    what: 'the importer declares a pack that brought its OWN generator',
    why: 'declaring a hand-edited generator invites the tracker to overwrite it at the next re-vendor',
    file: 'scripts/import-map.mjs',
    find: 'console.log(`· copied ${copied} payload files → ${dest}`);',
    to: "console.log(`· copied ${copied} payload files → ${dest}`); if (!isPlace) writeEngineSource(dest, { 'gen_external.js': 'area/gen_external_radial.js' }, 'import');",
    expect: 'a payload carrying its OWN generator is left undeclared',
  },
  {
    what: 'the backfill settles a disagreement instead of refusing',
    why: 'one signal overruling the other is a coin toss with extra steps',
    file: 'scripts/backfill-engine-source.mjs',
    find: '  if (byData !== byCode) {',
    to: '  if (false) {',
    expect: 'when the two signals DISAGREE nothing is written',
  },
  {
    what: 'the backfill hardcodes radial',
    why: 'every town on the board IS radial, so a hardcoded answer is right about all of them and wrong in principle',
    file: 'scripts/backfill-engine-source.mjs',
    find: '  const rel = CANDIDATES[byData];',
    to: '  const rel = CANDIDATES.radial;',
    expect: 'a genuine busway pack is recorded as BUSWAY — the answer is not hardcoded',
  },
];

for (const m of MUTATIONS) {
  const tmp = scratch();
  let r;
  try {
    damage(tmp, m.file, m.find, m.to);
    r = runSuite(tmp);
  } catch (e) {
    problems++; results.push(['✗ STALE', m.what, e.message.split('\n')[0]]);
    rmSync(tmp, { recursive: true, force: true });
    continue;
  }
  if (r.code === 0) { problems++; results.push(['✗ SURVIVED', m.what, 'the suite stayed green']); }
  else if (!caughtBy(r.out, m.expect)) {
    // Red, wrong cause. Reported as its own verdict: the suite is sensitive to
    // the damage but not for the reason claimed, which is a hole of its own.
    problems++; results.push(['✗ WRONG CAUSE', m.what, `expected "${m.expect}", got: ${failedLines(r.out).map((l) => l.trim()).join(' | ')}`]);
  } else results.push(['ok caught', m.what, m.expect]);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\n== prove-red: the external-generator provenance guards (OA-143) ==\n');
for (const [mark, what, extra] of results) {
  console.log(`  ${mark.padEnd(14)} ${what}`);
  if (extra) console.log(`  ${''.padEnd(14)}   ${extra}`);
}
console.log(`\n${MUTATIONS.length} mutations, ${MUTATIONS.length - results.filter((r) => r[0].startsWith('✗') && r[0] !== '✗ CONTROL').length} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-engine-source.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.\n');
process.exit(problems ? 1 : 0);
