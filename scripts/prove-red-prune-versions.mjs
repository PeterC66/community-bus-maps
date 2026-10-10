// prove-red-prune-versions.mjs — falsify test-prune-versions.mjs (buses-data OA-572).
//
//   node scripts/prove-red-prune-versions.mjs   (or: npm run test:prove-red-prune-versions)
//
// The test is green on a healthy tree whether or not it is testing anything, so
// each arm below breaks ONE thing the retire rule or the script must get right,
// and requires the test to go red FOR THAT REASON — an arm that goes red for some
// other reason has proved nothing about the assertion it was aimed at.
//
//   0  control — the tree as shipped                                  -> exit 0
//   1  the rule stops protecting the revert target                    -> "revert target is kept"
//   2  the rule stops protecting the highest number                   -> "highest number is kept"
//   3  the rule stops protecting a version under review               -> "under review is kept"
//   4  the rule lets an editor retire a once-published version        -> "admin only"
//   5  the script removes the files without stamping the row          -> "stamped retired"
//   6  the script writes no audit row                                 -> "audit row"
//   7  listVersions() goes on listing retired versions                -> "listVersions leaves"
//   8  the script accepts --include-published with no reason          -> "without a reason is refused"
//   9  the script accepts --all with --yes                            -> "--all with --yes is refused"
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY: each arm copies `src/` and
// `scripts/` into a scratch tree, edits the copy, and runs the shipped test
// against that tree, which the test accepts as its one positional argument.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-prune-versions.mjs');
const RULE = path.join('src', 'publish', 'retire.js');
const SCRIPT = path.join('scripts', 'prune-versions.mjs');
const DB = path.join('src', 'db', 'index.js');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

function scratch(mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prprune-'));
  for (const sub of ['src', 'scripts']) cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  if (mutate) {
    mutate({
      read: (rel) => readFileSync(path.join(dir, rel), 'utf8'),
      write: (rel, s) => writeFileSync(path.join(dir, rel), s),
    });
  }
  return dir;
}

function run(dir) {
  const res = spawnSync(process.execPath, [TEST, dir], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

const cut = (s, needle, replacement = '') => {
  if (!s.includes(needle)) throw new Error(`prove-red is stale: ${JSON.stringify(needle.slice(0, 60))} is no longer in the source`);
  return s.replace(needle, replacement);
};
/** A mutation that replaces one exact passage of one file. */
const edit = (rel, needle, replacement = '') => ({ read, write }) => write(rel, cut(read(rel), needle, replacement));

function arm(n, what, mutate, expect) {
  console.log(`\n${n}  ${what}`);
  let dir;
  try {
    dir = scratch(mutate);
    const { out, code } = run(dir);
    if (code === 0) { fail('the test still passed — this fault is invisible to it'); return; }
    const lines = reds(out);
    if (!lines.some((l) => expect.test(l))) {
      fail(`exit ${code}, but no failure mentions ${expect}:\n     ${lines.join('\n     ') || out.split('\n').slice(-6).join('\n     ')}`);
      return;
    }
    ok(`exit ${code} — ${lines.length} failure(s), including: ${lines.find((l) => expect.test(l))}`);
  } catch (e) {
    fail(e.message);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n0  the control — the tree as shipped');
{
  const dir = scratch(null);
  const { out, code } = run(dir);
  rmSync(dir, { recursive: true, force: true });
  if (code !== 0) fail(`the shipped test exits ${code}; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

arm(1, 'the rule stops protecting the revert target',
  edit(RULE, "    if (v.id === revertTargetId) return out('keep', 'the revert target — what a rollback would serve');\n"),
  /revert target is kept/);

arm(2, 'the rule stops protecting the highest number',
  edit(RULE, "    if (v.id === highestId) return out('keep', 'the highest number — the next version is numbered from it');\n"),
  /highest number is kept/);

arm(3, 'the rule stops protecting a version under review',
  edit(RULE, "    if (openRequestVersionIds.includes(v.id)) return out('keep', 'a publish request for it is awaiting review');\n"),
  /under review is kept/);

arm(4, 'the rule lets an editor retire a once-published version',
  edit(RULE, "an admin only, with a reason (its URL will 404)', true);", "an admin only, with a reason (its URL will 404)', false);"),
  /admin only/);

arm(5, 'the script removes the files without stamping the row',
  edit(SCRIPT, 'if (!markVersionRetired(v.id)) continue;', '/* no stamp */'),
  /stamped retired/);

arm(6, 'the script writes no audit row',
  edit(SCRIPT, "        action: 'version.retire',", "        action: 'version.retire-unrecorded',"),
  /audit row/);

arm(7, 'listVersions() goes on listing retired versions',
  edit(DB, 'FROM map_version WHERE map_id = ? AND retired_at IS NULL ORDER BY', 'FROM map_version WHERE map_id = ? ORDER BY'),
  /listVersions leaves/);

arm(8, 'the script accepts --include-published with no reason',
  edit(SCRIPT, 'if (includePublished && !reason) usage(', 'if (false) usage('),
  /without a reason is refused/);

arm(9, 'the script accepts --all with --yes',
  edit(SCRIPT, "if (all && yes) usage('--all is a dry run only", "if (false) usage('--all is a dry run only"),
  /--all with --yes is refused/);

console.log('');
if (failures) {
  console.error(`${failures} arm(s) did not go red as required.`);
  process.exit(1);
}
console.log('test-prune-versions.mjs has been seen to refuse each fault it is there to catch.');
