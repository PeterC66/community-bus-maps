// prove-red-carry-forward.mjs — falsify the carry-forward guards (OA-199).
//
//     npm run test:prove-red-carry-forward
//
// `test-carry-forward.mjs` is green. That is worth nothing on its own: the list it
// tests had exactly one entry for months, was never tested at all, and was wrong
// about the second entry the day one was added. This harness breaks the fix on
// purpose, six ways, and requires the suite to go red FOR THE NAMED REASON each
// time — a red for some other reason is reported as its own verdict, because a
// suite that notices the damage through an assertion that is not about it has a
// hole exactly where it looks strongest.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `src/` and `scripts/` are copied
// into a scratch tree and the copy is damaged; nothing is moved aside and
// restored, because a harness that restores in a `finally` still leaves the
// repository broken if it is killed between the two.
//
// SEVEN RUNS. One control and six mutations, and the control is not decoration:
// every arm going red at once would mean the copy is broken, not the guards.

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* Unlike prove-red-engine-source.mjs, `src/` is COPIED rather than symlinked:
 * every mutation below damages a file under src/maps/, and a symlink would damage
 * the repository. `node_modules/` and `engine/` are linked and never touched. */
function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-carry-'));
  for (const dir of ['scripts', 'src']) cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  for (const dir of ['node_modules', 'engine']) {
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-carry-forward.mjs')], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/* Matched on the WHOLE line, not split on ' — ': the suite uses an em dash as its
 * own name/detail separator, so splitting truncates an expected name at its first
 * dash and reports a genuine catch as WRONG CAUSE. */
const failedLines = (out) => out.split('\n').filter((l) => l.includes('✗ '));
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
    what: 'the swap stops carrying the declaration at all',
    why: 'this is the state the row found — the file simply dies with the archived data directory',
    file: 'src/maps/engine.js',
    find: '  const declFrom = path.join(archived, ENGINE_SOURCE);',
    to: '  const declFrom = path.join(archived, ENGINE_SOURCE + \'.never\');',
    expect: 'the engine-source declaration survives',
  },
  {
    what: 'the swap carries the declaration unconditionally, ignoring the verdict',
    why: 'the obvious two-line fix, and it INTRODUCES the corruption the design exists to refuse',
    file: 'src/maps/engine.js',
    find: '    if (verdict.keep) { cpSync(declFrom, path.join(live, ENGINE_SOURCE)); carried.push(ENGINE_SOURCE); }',
    to: '    if (true) { cpSync(declFrom, path.join(live, ENGINE_SOURCE)); carried.push(ENGINE_SOURCE); }',
    expect: 'a stale radial declaration is NOT carried onto a busway pack',
  },
  {
    what: 'the swap overwrites a declaration the fresh payload brought with it',
    why: 'a carried-forward answer shadowing a correct fresh one is the failure mode this guard is for',
    file: 'src/maps/engine.js',
    find: '  if (existsSync(declFrom) && !existsSync(path.join(live, ENGINE_SOURCE))) {',
    to: '  if (existsSync(declFrom)) {',
    expect: 'the payload\'s own declaration is NOT overwritten by the archived one',
  },
  {
    what: 'the verdict reads every generator as radial',
    why: 'every live pack IS radial, so a hardcoded answer is right about all of them and wrong in principle',
    file: 'src/maps/engine.js',
    find: "const externalKind = (src) => (/D\\.busway\\[/.test(src) ? 'busway' : 'radial');",
    to: "const externalKind = (src) => (src ? 'radial' : 'radial');",
    expect: 'radial declared, busway on disk → dropped',
  },
  {
    what: 'the verdict treats an ABSENT declared file as a disagreement',
    why: 'moot is not wrong, and a place pack that carries a stray declaration must not be punished for it',
    file: 'src/maps/engine.js',
    find: '    if (!existsSync(onDisk)) continue;                 // moot, not wrong',
    to: '    if (!existsSync(onDisk)) return { keep: false, why: packFile + \' is not in the pack\' };',
    expect: 'the declared file is absent → moot, still kept',
  },
  {
    what: 'src/ and scripts/ drift apart on the filename',
    why: 'the constant is duplicated because neither module can import the other; nothing but this assertion holds them together',
    file: 'src/maps/store.js',
    find: "export const ENGINE_SOURCE = 'engine-source.json';",
    to: "export const ENGINE_SOURCE = 'engine_source.json';",
    expect: 'name the SAME file',
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
    problems++; results.push(['✗ WRONG CAUSE', m.what, `expected "${m.expect}", got: ${failedLines(r.out).map((l) => l.trim()).join(' | ')}`]);
  } else results.push(['ok caught', m.what, m.expect]);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\n== prove-red: what survives a data refresh (OA-199) ==\n');
for (const [mark, what, extra] of results) {
  console.log(`  ${mark.padEnd(14)} ${what}`);
  if (extra) console.log(`  ${''.padEnd(14)}   ${extra}`);
}
const bad = results.filter((r) => r[0].startsWith('✗')).length;
console.log(`\n${MUTATIONS.length} mutations, ${MUTATIONS.length - results.filter((r) => r[0].startsWith('✗') && r[0] !== '✗ CONTROL').length} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-carry-forward.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.\n');
process.exit(bad ? 1 : 0);
