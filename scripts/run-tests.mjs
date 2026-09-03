#!/usr/bin/env node
// The portal's test runner. Replaces the 36-command `&&` chain that `npm test`
// used to be (OA-224 Tier 2.2).
//
// Three things the chain could not do:
//
//   1. It stopped at the first failure, so a red test hid every test after it.
//      This runs all of them and reports every verdict.
//   2. Nothing tied it to the tests on disk. On 2026-09-02 four of the 37
//      `test-*`/`prove-red-*` files in `scripts/` were absent from it, and the
//      only way to find that out was to diff the chain against `ls`. This
//      DISCOVERS the files, so a new test is in the suite the moment it lands
//      and an excluded one has to say why.
//   3. It hard-coded each invocation a second time. `test:svg` carries
//      `--env-file-if-exists=.env` and three others do too; a chain entry that
//      forgot the flag would run a different command under the same name. Here
//      each file's command comes from the `package.json` script that owns it,
//      so `npm run test:svg` and this runner cannot diverge.
//
// Exit codes follow the house rule: 0 ok, 1 a test failed, 2 the runner was
// used wrongly or its own invariants are broken.
//
// Run it from the repository root (`C:\Claude\community-bus-maps`):
//     npm test
//     npm test -- --only search        # substring filter on the file name
//     npm test -- --list               # print the plan and exit, run nothing

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, '..');

// Checks that are not `test-*` files but ran at the head of the old chain, in
// this order. They are cheap and they fail for reasons a test cannot see.
const PREFLIGHT = [
  'changelog-assemble.mjs --check',
  'check-compose-env.mjs',
  'check-chrome.mjs',
  // The vendored-engine audit: UNLISTED / MISSING / EDITED / UNRESOLVED. It ran
  // in NO workflow and was no preflight until 2026-09-03 (the review's
  // portal-ops T8); the only thing exercising `auditVendored` against the real
  // tree was one section of `test-vendored.mjs`. `--no-skills` is the form CI
  // can run: it verifies the hashes of what is here, and says out loud that it
  // cannot tell whether the SKILL has moved on. `status.js` on the laptop is
  // what asks that half.
  'check-vendored.mjs --no-skills',
];

// A discovered file may be skipped ONLY with a reason that names where it DOES
// run. An exclusion with no reason is a hole; the runner refuses to start with
// one rather than printing a green summary that covers less than its name.
const EXCLUDED = {
  'test-engine-selfsufficient.mjs':
    'needs BUSES_DIR (the buses-data checkout) — runs in verify.yml, "self-sufficient" step',
  'prove-red-selfsufficient.mjs':
    'needs BUSES_DIR (the buses-data checkout) — runs in verify.yml, "prove the self-sufficiency gate can go red"',
};

const args = process.argv.slice(2);
const only = (() => {
  const i = args.indexOf('--only');
  return i === -1 ? null : args[i + 1];
})();
const listOnly = args.includes('--list');

if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: npm test [-- --only <substring>] [-- --list]');
  process.exit(2);
}
if (args.includes('--only') && !only) {
  console.error('--only needs a substring to match against the file name.');
  process.exit(2);
}

// --- discover -------------------------------------------------------------

const discovered = readdirSync(SCRIPTS)
  .filter((f) => /^(test|prove-red)-.*\.mjs$/.test(f))
  .sort();

if (discovered.length === 0) {
  console.error('No test files found in scripts/. That cannot be right.');
  process.exit(2);
}

// --- each file's command comes from the script that owns it ---------------

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

/** The npm script that runs this file, if there is exactly one. */
function ownerOf(file) {
  const owners = Object.entries(scripts)
    .filter(([name]) => name !== 'test')
    .filter(([, cmd]) => new RegExp(`scripts/${file.replace(/\./g, '\\.')}(\\s|$)`).test(cmd))
    .map(([name, cmd]) => ({ name, cmd }));
  return owners.length === 1 ? owners[0] : null;
}

const plan = [];
const unowned = [];
for (const file of discovered) {
  if (EXCLUDED[file]) continue;
  if (only && !file.includes(only)) continue;
  const owner = ownerOf(file);
  if (!owner) unowned.push(file);
  plan.push({
    file,
    script: owner ? owner.name : null,
    cmd: owner ? owner.cmd : `node scripts/${file}`,
  });
}

// --- the runner's own invariants ------------------------------------------

const holes = Object.entries(EXCLUDED).filter(([, why]) => !why || !why.trim());
if (holes.length) {
  console.error('Excluded with no reason: ' + holes.map(([f]) => f).join(', '));
  console.error('An exclusion must name where the test DOES run.');
  process.exit(2);
}
const ghosts = Object.keys(EXCLUDED).filter((f) => !discovered.includes(f));
if (ghosts.length) {
  console.error('EXCLUDED names a file that is not in scripts/: ' + ghosts.join(', '));
  console.error('Delete the entry — a stale exclusion hides nothing and reads as coverage.');
  process.exit(2);
}

// --- report the plan ------------------------------------------------------

const skipped = Object.entries(EXCLUDED);
console.log(`${plan.length} test file(s), ${PREFLIGHT.length} preflight check(s)` +
  (only ? `, filtered to "${only}"` : '') +
  (skipped.length ? `, ${skipped.length} excluded` : ''));
for (const [file, why] of skipped) console.log(`  SKIP  ${file}\n        ${why}`);
if (unowned.length) {
  console.log(`  ${unowned.length} file(s) have no npm script and run as \`node scripts/<file>\`:`);
  for (const f of unowned) console.log(`        ${f}`);
}
console.log('');

if (listOnly) {
  for (const t of plan) console.log(`  ${(t.script || '-').padEnd(30)} ${t.cmd}`);
  process.exit(0);
}

// --- run ------------------------------------------------------------------

function run(label, cmd) {
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit' });
  const ms = Date.now() - started;
  const code = r.status === null ? 1 : r.status;
  return { label, cmd, code, ms };
}

const results = [];
for (const cmd of PREFLIGHT) {
  results.push(run(cmd.split(' ')[0], `node scripts/${cmd}`));
}
for (const t of plan) {
  results.push(run(t.file, t.cmd));
}

// --- summary --------------------------------------------------------------

const failed = results.filter((r) => r.code !== 0);
const total = results.reduce((n, r) => n + r.ms, 0);

console.log('\n' + '='.repeat(72));
for (const r of results) {
  const verdict = r.code === 0 ? 'ok  ' : `FAIL`;
  console.log(`${verdict}  ${String(r.ms).padStart(6)} ms  ${r.label}` +
    (r.code === 0 ? '' : `  (exit ${r.code})`));
}
console.log('='.repeat(72));
console.log(`${results.length} run, ${failed.length} failed, ${skipped.length} excluded, ${(total / 1000).toFixed(1)} s`);

if (failed.length) {
  console.log('\nFailed:');
  for (const r of failed) console.log(`  ${r.label}\n    ${r.cmd}`);
  process.exit(1);
}
process.exit(0);
