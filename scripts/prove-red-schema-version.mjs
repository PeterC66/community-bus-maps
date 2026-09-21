#!/usr/bin/env node
// prove-red-schema-version.mjs — falsify test-schema-version.mjs (buses-data OA-325).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-schema-version
//
// WHY THIS EXISTS. The suite it breaks is green on the day it lands, and a green
// check nobody has watched go red proves nothing — this repository's standing
// rule. It matters more than usual here for a specific reason: the check is a
// TEXT check over prose, so nearly every mistake in it fails SILENT rather than
// loud. A matcher that is too strict reports a finding somebody notices; a matcher
// that is too loose passes an undescribed migration and reads exactly like a
// correct run. The first draft of the matcher was too loose, and the arm at the
// foot of this file — "a new column borrowing a described column's bare name" — is
// that bug kept as a fixture for ever.
//
// Each arm is broken ON PURPOSE, is required to go red BY ITSELF, and is required
// to go red on the RIGHT assertion: a mutation caught by the wrong check means the
// suite is sensitive to the damage but not for the reason claimed.
//
// THE ARM THAT MATTERS MOST is "THE REGRESSION ITSELF", which reproduces the state
// portal PR #282 shipped on 2026-09-12 — an `ALTER TABLE ... ADD COLUMN` added to
// migrate() with SCHEMA_VERSION left where it was. If the suite cannot tell that
// apart from a correct tree, it is not testing the thing it was written for.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `src/`, `docs/` and `scripts/` are
// copied into a scratch tree, the copy is damaged, and the COPY of the checker is
// run — it resolves its tree from its own location, so it reads the damage and
// never the repository. `scripts/` is copied rather than linked precisely so the
// baseline arm below can damage the checker's own declared list. Nothing is moved
// aside and restored, because a harness that restores in a `finally` still leaves
// the repository broken if it is killed between the two.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-schema-version-'));
  for (const dir of ['src', 'docs', 'scripts']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
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

function runChecker(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-schema-version.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// Anchored on the checker's own two-space indent and four-character verdict.
const failedLines = (out) => out.split('\n').filter((l) => /^ {2}FAIL {2}/.test(l));
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
  const { code, out } = runChecker(tmp);
  if (code === 0) {
    problems += 1;
    console.error(`  ✗ SURVIVED  ${what}\n      the check passed with this broken — it is not testing it`);
    return;
  }
  if (!caughtBy(out, expect)) {
    problems += 1;
    console.error(`  ✗ WRONG CAUSE  ${what}\n      went red, but not on "${expect}"\n      red on: ${failedLines(out).map((l) => l.trim()).join('\n              ') || '(nothing matched the FAIL shape)'}`);
    return;
  }
  console.log(`  ✓ RED       ${what}`);
}

console.log('\nBreaking the schema-version check on purpose, one thing at a time:\n');

// --- the regression this file exists for ------------------------------------

arm('THE REGRESSION ITSELF — a new ALTER lands and the constant stays put (PR #282)',
  (t) => damage(t, 'src/db/index.js',
    "  if (!mapCols.includes('banner_note')) db.exec('ALTER TABLE map ADD COLUMN banner_note TEXT');",
    "  if (!mapCols.includes('banner_note')) db.exec('ALTER TABLE map ADD COLUMN banner_note TEXT');\n"
    + "  if (!custCols.includes('billing_ref')) db.exec('ALTER TABLE customer ADD COLUMN billing_ref TEXT');"),
  'are either baselined or named by a block');

arm('a new TABLE lands in schema.sql and no block describes it (the v3/v4 shape)',
  (t) => damage(t, 'src/db/schema.sql', 'CREATE TABLE IF NOT EXISTS audit_log',
    'CREATE TABLE IF NOT EXISTS billing_event (\n  id INTEGER PRIMARY KEY\n);\n\nCREATE TABLE IF NOT EXISTS audit_log'),
  'are either baselined or named by a block');

arm('a new column borrows a described column\'s BARE name (the matcher\'s own first bug)',
  (t) => damage(t, 'src/db/index.js',
    "  if (!mapCols.includes('banner_note')) db.exec('ALTER TABLE map ADD COLUMN banner_note TEXT');",
    "  if (!mapCols.includes('banner_note')) db.exec('ALTER TABLE map ADD COLUMN banner_note TEXT');\n"
    + "  if (!mapCols.includes('is_sample')) db.exec('ALTER TABLE map ADD COLUMN is_sample INTEGER');"),
  'are either baselined or named by a block');

// --- the numbered history ---------------------------------------------------

arm('the constant is bumped and no block is written for it',
  (t) => damage(t, 'src/db/index.js', 'export const SCHEMA_VERSION = 5;', 'export const SCHEMA_VERSION = 6;'),
  'equals the highest block');

arm('a block is written and the constant is not bumped',
  (t) => damage(t, 'src/db/index.js', ' */\nexport const SCHEMA_VERSION = 5;',
    ' * 6 = a generation nobody bumped for.\n */\nexport const SCHEMA_VERSION = 5;'),
  'equals the highest block');

arm('the history gains a gap (a block is tidied away)',
  (t) => damage(t, 'src/db/index.js', ' * 4 = 2026-09-12, buses-data OA-154 Phase D1: one new table,',
    ' * 9 = 2026-09-12, buses-data OA-154 Phase D1: one new table,'),
  'run 1..N with no gap');

arm('two blocks claim the same number',
  (t) => damage(t, 'src/db/index.js', ' * 3 = 2026-09-11, OA-308 tier 4: two new tables,',
    ' * 4 = 2026-09-11, OA-308 tier 4: two new tables,'),
  'appears twice');

// --- the baseline cannot be used as cover, and cannot rot -------------------

arm('the baseline is reached for to silence a migration a block already describes',
  (t) => damage(t, 'scripts/test-schema-version.mjs', "    'map_version.data_change_json',",
    "    'map_version.data_change_json', 'customer.is_sample',"),
  'nothing is both baselined and described');

arm('a baselined subject is deleted from the schema and the entry is left behind',
  (t) => damage(t, 'src/db/index.js',
    "  if (!mapCols.includes('banner_note_set_at')) db.exec('ALTER TABLE map ADD COLUMN banner_note_set_at TEXT');\n", ''),
  'name a subject that still exists');

// --- the runbook ------------------------------------------------------------

arm('the runbook drops the instruction this check enforces',
  (t) => damage(t, 'docs/DEPLOY.md', '**Bump `SCHEMA_VERSION` in `src/db/index.js` when you add a migration.**', ''),
  'still carries the instruction');

arm('the runbook stops naming the check, so the rule reads as advice again',
  (t) => damage(t, 'docs/DEPLOY.md', '`scripts/test-schema-version.mjs` now holds', 'something now holds'),
  'names this check beside the instruction');

// THE CONTROL. Without it every arm above would pass with the checker hard-wired
// to exit 1, and the harness would be proving nothing but its own plumbing. It is
// also the one arm that proves `--root` reaches a COPY correctly: if the checker
// silently read the real repository instead, the control would still be green but
// every arm above would have SURVIVED, so the two halves check each other.
{
  const tmp = scratch();
  const { code, out } = runChecker(tmp);
  if (code !== 0) {
    problems += 1;
    console.error('  ✗ CONTROL   an UNDAMAGED copy went red — the harness cannot tell damage from the ordinary state\n      '
      + failedLines(out).map((l) => l.trim()).join('\n      '));
  } else {
    console.log('  ✓ CONTROL   an undamaged copy stays green');
  }
}

if (problems) {
  console.error(`\n✗ ${problems} arm(s) of the schema-version check are not doing their job`);
  process.exit(1);
}
console.log('\n✓ every arm of the schema-version check was watched go red, and the control stayed green');
