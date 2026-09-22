// Where a prove-red scratch copy borrows node_modules from (buses-data OA-440).
//
//   node scripts/test-scratch-deps.mjs      (part of `npm test`)
//
// WHY THIS EXISTS, AND WHY IT IS A TEST RATHER THAN A PROVE-RED HARNESS.
// Seventeen `prove-red-*` harnesses spent an unknown length of time reporting
// *0 caught, control RED* in a git worktree, because each junctioned
// `path.join(ROOT, 'node_modules')` into its temp copy and a worktree has no
// `node_modules` of its own. The copy then ran with no dependencies and died on
// ERR_MODULE_NOT_FOUND before asking its first question — so the tally it
// printed was not a weak suite, it was a suite that never ran.
//
// CI CANNOT SEE THAT FAULT and never will: `actions/checkout` produces one
// checkout with `node_modules` at its root and no worktree anywhere, so the
// broken line is correct on the only machine CI owns. That is the same shape as
// the mixed-line-endings case in buses-data's rules — CI is not a weaker place
// to put such a check, CI is a place where it is green for ever. What CAN be
// checked anywhere is the two halves below: the resolver's own behaviour,
// including on a REAL worktree this test builds in a temp directory, and the
// JOIN that says every harness goes through it.
//
// The join half matters more than it looks. The fault was never in one file; it
// was one line copied into eighteen, and a fix applied to seventeen of them
// would look exactly as green as a fix applied to all eighteen.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { depsRoot, depsFrom } from './lib/scratch-deps.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SCRIPTS, '..');

/** Two paths naming the same directory. String equality is not enough: the
 *  temp dir can arrive as an 8.3 short name on Windows and as a symlink on
 *  macOS, and git answers with the resolved form either way. */
function same(a, b) {
  try { return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase(); }
  catch { return false; }
}

let failures = 0;
function check(label, ok, extra) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failures++; if (extra) console.log(`      ${extra}`); }
}

// --- 1. the resolver, against a real worktree ------------------------------

console.log('depsRoot answers about this checkout:');
check('it returns a directory that has node_modules',
  existsSync(path.join(depsRoot(ROOT), 'node_modules')),
  'if this fails, run `npm ci` in the main checkout — every arm below assumes it');
check('depsFrom sends everything but node_modules to the checkout itself',
  depsFrom(ROOT, 'engine') === path.join(ROOT, 'engine'),
  'the harness is testing THIS checkout\'s content and must not reach into another for it');

console.log('depsRoot answers about a real git worktree:');
// Built rather than simulated. A hand-made `.git` file would test this test's
// idea of a worktree; `git worktree add` tests git's.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-scratch-deps-'));
try {
  const main = path.join(tmp, 'main');
  mkdirSync(main);
  const git = (...args) => execFileSync('git', ['-C', main, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '-b', 'main', main], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(main, 'package.json'), '{"name":"x","private":true}\n');
  git('add', 'package.json');
  git('commit', '-qm', 'first');
  // `npm ci` installs here and only here — which is the whole point.
  mkdirSync(path.join(main, 'node_modules'));

  // Both shapes this estate actually uses: one INSIDE the checkout, one beside
  // it. Walking up finds the first and not the second; git finds both.
  const inside = path.join(main, '.claude', 'worktrees', 'w1');
  const beside = path.join(tmp, 'w2');
  git('worktree', 'add', '-q', '-b', 'w1', inside);
  git('worktree', 'add', '-q', '-b', 'w2', beside);

  check('a worktree INSIDE the checkout borrows the main checkout', same(depsRoot(inside), main),
    `it said ${JSON.stringify(depsRoot(inside))}`);
  check('a worktree BESIDE the checkout borrows it too', same(depsRoot(beside), main),
    'this is the shape walking up cannot answer — C:\\Claude\\cbm-* are all like this');
  check('depsFrom routes node_modules there and nothing else',
    same(depsFrom(beside, 'node_modules'), path.join(main, 'node_modules'))
    && depsFrom(beside, 'engine') === path.join(beside, 'engine'));

  console.log('depsRoot REFUSES rather than skipping when there is none:');
  // The half worth having. Three harnesses guarded the junction with
  // `if (!existsSync(from)) continue`, so a missing node_modules was not an
  // error at all — it was a silent skip, and what followed it looked like a test.
  rmSync(path.join(main, 'node_modules'), { recursive: true });
  let threw = null;
  try { depsRoot(beside); } catch (e) { threw = e; }
  check('it throws', threw !== null, 'a resolver that returns a path to nothing is the original bug');
  const said = (threw?.message ?? '').toLowerCase();
  check('the message names both places it looked',
    said.includes(beside.toLowerCase()) && said.includes(main.toLowerCase()),
    threw ? threw.message : '(it did not throw)');
  check('the message says what to do about it',
    !!threw && /npm ci/.test(threw.message));

  // A plain directory that is no repository at all: git cannot even name a main
  // checkout, and the message has to survive that.
  const loose = path.join(tmp, 'loose');
  mkdirSync(loose);
  let threw2 = null;
  try { depsRoot(loose); } catch (e) { threw2 = e; }
  check('it throws outside a repository too', threw2 !== null);
  check('and says git could not say, rather than printing undefined',
    !!threw2 && threw2.message.includes('(git could not say)'),
    threw2 ? threw2.message : '(it did not throw)');
} finally {
  // Worktrees hold a lock on their administrative files; prune before removing.
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir, best effort */ }
}

// --- 2. the join: every harness goes through it ----------------------------

console.log('every prove-red harness that links node_modules uses the resolver:');
const harnesses = readdirSync(SCRIPTS).filter((f) => /^prove-red-.*\.mjs$/.test(f)).sort();
check('there are harnesses to check at all', harnesses.length > 0);

const DEAD = "path.join(ROOT, 'node_modules')";
const LINKERS = [];
for (const file of harnesses) {
  const src = readFileSync(path.join(SCRIPTS, file), 'utf8');
  // Code only: three harnesses discuss node_modules in prose while excluding it
  // from a copy, and a comment is not a call.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const links = code.includes(DEAD)
    || /\[[^\]]*'node_modules'[^\]]*\]/.test(code)
    || code.includes("depsFrom(ROOT, 'node_modules')");
  if (links) LINKERS.push({ file, code });
}
check(`${LINKERS.length} harness(es) link node_modules`, LINKERS.length >= 18,
  'the count is read off the disk; if it has fallen, a harness stopped linking rather than this rule stopping applying');

// `path.join(ROOT, dir)` is CORRECT for the other loops — `scripts`, `src`,
// `views`, `public` are the content under test and must come from this checkout.
// Only the loop that lists `node_modules` is in scope, so the rule reads the
// body that follows that array rather than the whole file.
const BODY = 300;
for (const { file, code } of LINKERS) {
  check(`${file} imports the resolver`, /from '\.\/lib\/scratch-deps\.mjs'/.test(code),
    'add `import { depsFrom } from \'./lib/scratch-deps.mjs\';`');
  check(`${file} does not name node_modules under its own ROOT`, !code.includes(DEAD),
    `${DEAD} is the exact expression that was vacuously red in a worktree`);

  const bodies = [];
  const arrays = /\[[^\]]*'node_modules'[^\]]*\]/g;
  for (let m = arrays.exec(code); m; m = arrays.exec(code)) {
    bodies.push(code.slice(m.index + m[0].length, m.index + m[0].length + BODY));
  }
  for (const [i, body] of bodies.entries()) {
    const where = bodies.length > 1 ? ` (loop ${i + 1})` : '';
    check(`${file} links that loop's dirs through depsFrom${where}`,
      body.includes('depsFrom(ROOT, dir)') && !body.includes('path.join(ROOT, dir)'),
      'the loop that lists node_modules must resolve its source, not assume ROOT has one');
  }
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll scratch-deps checks passed.');
