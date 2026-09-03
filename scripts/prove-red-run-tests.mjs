// prove-red-run-tests.mjs — falsify the test runner (OA-224 Tier 2.2).
//
// Run from the repository root (`C:\Claude\community-bus-maps`, no placeholders):
//     npm run test:prove-red-run-tests
//
// WHY THIS EXISTS. `run-tests.mjs` is the thing that decides whether `npm test`
// is green, so a bug in it does not make one test wrong — it makes the whole
// suite's verdict wrong, silently and in the reassuring direction. It replaced a
// 36-command `&&` chain, and the chain's own faults are the ones to prove gone:
// the chain stopped at the first failure, and it named each test a second time
// so a file could sit on disk untested (four did) or be run with different flags
// under the same name.
//
// Six cases, each of which must produce ITS OWN outcome, plus an intact control.
// Every one runs against a scratch repository under os.tmpdir() built from a
// handful of one-line files: the real suite is never invoked, so this costs ~3 s
// rather than the 95 s the real one takes, and it cannot be turned green or red
// by anything in this checkout.
//
//   0  control: three passing tests           -> exit 0, "0 failed"
//   1  one failing test                       -> exit 1, and it is NAMED
//   2  a failure in the MIDDLE                -> the tests AFTER it still ran.
//                                                This is the property a verdict
//                                                cannot express and the exact
//                                                thing the `&&` chain got wrong
//   3  an exclusion with an empty reason      -> exit 2, and nothing runs
//   4  an exclusion naming an absent file     -> exit 2 (a stale exclusion reads
//                                                as coverage; it hides nothing
//                                                and must be deleted)
//   5  a test file with NO npm script         -> still run, and reported as
//                                                unowned. This is what makes the
//                                                suite widen by itself when a
//                                                test lands
//   6  a test whose npm script carries a flag -> run WITH the flag. The scratch
//                                                test passes only if the .env
//                                                that `--env-file-if-exists`
//                                                loads reached it, so a runner
//                                                that rebuilt the command as a
//                                                bare `node scripts/<file>`
//                                                turns this red
//
// Case 6 is the one worth the most: `test:svg` really does carry that flag in
// this repository, and a chain entry that forgot it would have run a different
// command under the same name and reported it under the right one.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNNER = path.join(ROOT, 'scripts', 'run-tests.mjs');

let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

/**
 * The scripts the real runner runs BEFORE the tests, read out of its own
 * PREFLIGHT array.
 *
 * This was a typed list of three until 2026-09-03, sitting eight lines above a
 * comment explaining why the EXCLUDED list is READ and not copied -- and it went
 * stale the moment OA-232 Tier 2.3 added `check-vendored.mjs --no-skills` as a
 * fourth: six of this harness's assertions failed with MODULE_NOT_FOUND against
 * a scratch tree that had no such file. The same lesson, applied to one list and
 * not to its sibling. The entries carry arguments, so the filename is the first
 * word.
 */
function preflightInRunner() {
  const block = readFileSync(RUNNER, 'utf8').match(/const PREFLIGHT = \[([\s\S]*?)\n\];/);
  if (!block) {
    console.error('Could not find PREFLIGHT in run-tests.mjs -- this harness has gone stale.');
    process.exit(2);
  }
  // Array ENTRIES only — a whole line that is a quoted string. The block also
  // holds `//` comments naming other `.mjs` files, and a looser pattern happily
  // pulled a filename out of one of those.
  const names = [...block[1].matchAll(/^\s*'([^']+\.mjs)[^']*',\s*$/gm)].map((m) => m[1]);
  if (!names.length) {
    console.error('PREFLIGHT in run-tests.mjs parsed to nothing -- this harness has gone stale.');
    process.exit(2);
  }
  return names;
}

/** The filenames the real runner excludes, read out of its own EXCLUDED map. */
function excludedInRunner() {
  const block = readFileSync(RUNNER, 'utf8').match(/const EXCLUDED = \{([\s\S]*?)\n\};/);
  if (!block) {
    console.error('Could not find EXCLUDED in run-tests.mjs — this harness has gone stale.');
    process.exit(2);
  }
  return [...block[1].matchAll(/'([^']+\.mjs)'\s*:/g)].map((m) => m[1]);
}

/**
 * A scratch repository: package.json, a stub for every preflight the runner
 * always runs, and whatever test files the case asks for.
 *
 * files:   { 'test-a.mjs': 0 | 1 | <source string> }   0 = passes, 1 = fails
 * scripts: extra package.json scripts, name -> command
 * patch:   (runnerSource) => runnerSource, to break the runner on purpose
 */
function tree({ files = {}, scripts = {}, patch = null, env = null } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'prove-runner-'));
  mkdirSync(path.join(tmp, 'scripts'));
  // The runner's real PREFLIGHT entries, read off the runner for the same reason
  // as EXCLUDED below. Each becomes a stub that passes.
  for (const stub of preflightInRunner()) {
    writeFileSync(path.join(tmp, 'scripts', stub), 'process.exit(0);\n');
  }
  // The runner's real EXCLUDED entries, read off the runner rather than copied,
  // so this harness cannot go stale when one is added or removed. Each becomes a
  // stub that FAILS if it is run — so the control proves the SKIP path works,
  // instead of the scratch tree being red because those files are not here.
  for (const name of excludedInRunner()) {
    writeFileSync(path.join(tmp, 'scripts', name),
      `console.error('${name} was RUN — it is supposed to be excluded'); process.exit(1);\n`);
  }
  for (const [name, spec] of Object.entries(files)) {
    const src = typeof spec === 'number'
      ? `console.log('${name} ran'); process.exit(${spec});\n`
      : spec;
    writeFileSync(path.join(tmp, 'scripts', name), src);
  }
  writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'scratch', version: '0.0.0', scripts: { test: 'node scripts/run-tests.mjs', ...scripts },
  }, null, 2));
  if (env) writeFileSync(path.join(tmp, '.env'), env);
  let runner = readFileSync(RUNNER, 'utf8');
  if (patch) runner = patch(runner);
  writeFileSync(path.join(tmp, 'scripts', 'run-tests.mjs'), runner);
  return tmp;
}

/** Run the scratch runner. Strips the ambient vars the cases rely on. */
function runIn(tmp) {
  const env = { ...process.env };
  delete env.PROVE_RUNNER_FLAG;
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'run-tests.mjs')],
    { cwd: tmp, encoding: 'utf8', env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const trees = [];
function withTree(spec, fn) {
  const tmp = tree(spec);
  trees.push(tmp);
  fn(runIn(tmp));
}

console.log('prove-red-run-tests — falsifying the portal test runner\n');

// 0 — control ---------------------------------------------------------------
withTree({ files: { 'test-a.mjs': 0, 'test-b.mjs': 0, 'test-c.mjs': 0 } }, ({ code, out }) => {
  if (code === 0) ok('control: three passing tests exit 0');
  else fail(`control: three passing tests exited ${code}\n${out}`);
  if (/0 failed/.test(out)) ok('control: the summary says 0 failed');
  else fail('control: the summary did not say "0 failed"');
  // Derived, not typed, for the reason the stub list above is derived: this said
  // "6 run" and went red when the runner gained a fourth preflight.
  const expected = preflightInRunner().length + 3;
  if (new RegExp(`${expected} run`).test(out)) ok(`control: ${preflightInRunner().length} preflight + 3 tests = ${expected} run`);
  else fail(`control: expected "${expected} run" in the summary\n${out}`);
  // The excluded files ARE present in the scratch tree and fail if run, so a
  // green control is also proof that the SKIP path skips.
  if (!/is supposed to be excluded/.test(out)) ok('control: the excluded files were skipped, not run');
  else fail('control: an excluded file was run');
  if (/SKIP/.test(out) && /verify\.yml/.test(out)) ok('control: each exclusion prints its reason on every run');
  else fail('control: the exclusions did not announce themselves');
});

// 1 — a failing test --------------------------------------------------------
withTree({ files: { 'test-a.mjs': 0, 'test-bad.mjs': 1 } }, ({ code, out }) => {
  if (code === 1) ok('a failing test exits 1');
  else fail(`a failing test exited ${code}, expected 1`);
  if (/FAIL.*test-bad\.mjs/.test(out)) ok('the failing test is NAMED in the summary');
  else fail('the failing test was not named');
});

// 2 — the chain's bug: a failure must not stop the rest ---------------------
withTree({ files: { 'test-a.mjs': 0, 'test-bad.mjs': 1, 'test-z.mjs': 0 } }, ({ code, out }) => {
  // test-bad sorts before test-z, so the chain would have stopped short of it.
  if (/test-z\.mjs ran/.test(out)) ok('a test AFTER the failure still ran (the `&&` chain would not have)');
  else fail('a failure stopped the run — this is the chain fault the runner exists to remove');
  if (/1 failed/.test(out)) ok('the summary counts exactly one failure');
  else fail('the summary did not report exactly one failure');
  if (code === 1) ok('and the run is still red overall');
  else fail(`expected exit 1 with a failure present, got ${code}`);
});

// 3 — an exclusion with no reason -------------------------------------------
withTree({
  files: { 'test-a.mjs': 0 },
  patch: (s) => s.replace(/const EXCLUDED = \{[\s\S]*?\n\};/, "const EXCLUDED = {\n  'test-a.mjs': '',\n};"),
}, ({ code, out }) => {
  if (code === 2) ok('an exclusion with no reason exits 2 (usage, not failure)');
  else fail(`a reasonless exclusion exited ${code}, expected 2`);
  if (/no reason/.test(out)) ok('and it says the exclusion has no reason');
  else fail('the refusal did not explain itself');
  if (!/test-a\.mjs ran/.test(out)) ok('and nothing ran');
  else fail('it ran tests despite refusing');
});

// 4 — a stale exclusion naming a file that is gone --------------------------
withTree({
  files: { 'test-a.mjs': 0 },
  patch: (s) => s.replace(/const EXCLUDED = \{[\s\S]*?\n\};/, "const EXCLUDED = {\n  'test-deleted-long-ago.mjs': 'needs BUSES_DIR — runs in verify.yml',\n};"),
}, ({ code, out }) => {
  if (code === 2) ok('an exclusion naming an absent file exits 2');
  else fail(`a stale exclusion exited ${code}, expected 2`);
  if (/not in scripts\//.test(out)) ok('and it names the file that is gone');
  else fail('the refusal did not name the stale entry');
});

// 5 — discovery: a file with no npm script is still run ----------------------
withTree({ files: { 'test-orphan.mjs': 0 } }, ({ code, out }) => {
  if (/test-orphan\.mjs ran/.test(out)) ok('a test with no npm script is discovered and RUN');
  else fail('a test with no npm script was skipped — the suite would not widen by itself');
  if (/no npm script/.test(out)) ok('and it is reported as unowned rather than passing quietly');
  else fail('an unowned test was run without being flagged');
  if (code === 0) ok('and the run is green');
  else fail(`expected exit 0, got ${code}`);
});

// 6 — the invocation comes from package.json, flags and all ------------------
withTree({
  files: {
    'test-flagged.mjs':
      "if (process.env.PROVE_RUNNER_FLAG === 'yes') { console.log('flag reached the test'); process.exit(0); }\n" +
      "console.error('the --env-file flag was dropped'); process.exit(1);\n",
  },
  scripts: { 'test:flagged': 'node --env-file-if-exists=.env scripts/test-flagged.mjs' },
  env: 'PROVE_RUNNER_FLAG=yes\n',
}, ({ code, out }) => {
  if (code === 0 && /flag reached the test/.test(out)) {
    ok("the owning script's flags are used verbatim (`npm run <name>` and the runner cannot diverge)");
  } else {
    fail(`the runner rebuilt the command and dropped --env-file-if-exists (exit ${code})\n${out}`);
  }
});

// 6b — the control for case 6: with no owning script, there IS no flag -------
withTree({
  files: {
    'test-flagged.mjs':
      "if (process.env.PROVE_RUNNER_FLAG === 'yes') { process.exit(0); }\n" +
      "console.error('no flag, as expected'); process.exit(1);\n",
  },
  env: 'PROVE_RUNNER_FLAG=yes\n',
}, ({ code }) => {
  if (code === 1) ok('control for 6: with no owning script the file runs bare, so case 6 tested the script and not the .env');
  else fail(`control for 6: expected exit 1 without an owning script, got ${code}`);
});

for (const t of trees) rmSync(t, { recursive: true, force: true });

console.log('');
if (failures) {
  console.error(`prove-red-run-tests: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('prove-red-run-tests: all cases behaved as required.');
process.exit(0);
