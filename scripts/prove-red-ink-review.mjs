#!/usr/bin/env node
// prove-red-ink-review.mjs — falsify test-ink-review.mjs.
//
//   node scripts/prove-red-ink-review.mjs   (or: npm run test:prove-red-ink-review)
//
// A gate that has never been seen to refuse proves nothing. Each arm puts one
// plausible mistake into a COPY of `scripts/` and requires the test to go red
// FOR THAT REASON — an arm that reddens for some other reason has established
// nothing about the assertion it was aimed at.
//
//   0  control — the tree as shipped                                 -> exit 0
//   1  a hold read as an accept                                      -> "a hold is uncovered"
//   2  the review's build not compared with the render's             -> "ANOTHER build"
//   3  an unparseable review filtered out as if it held nothing      -> "will not parse"
//   4  the OLDEST review judges the map                              -> "OLDER review"
//   4a any review that lists the map judges it, not the current one   -> "only an older review"
//   5  a build already staged delivered again                        -> "already-staged"
//   6  the render joined to its build by folder name                 -> "a minute after"
//   7  deliver-map.mjs stops calling the gate                        -> "calls gateInkReview"
//   8  --ink-unchecked left in the args forwarded to the host        -> "stripped"
//   9  the digest owed whatever the delivery did                     -> "--no-notify"
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. Run it from the repository root
// (`C:\Buses\community-bus-maps`); it takes no arguments.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-ink-review.mjs');
const LIB = 'scripts/lib/ink-review.mjs';
const DELIVER = 'scripts/deliver-map.mjs';

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const cut = (s, needle, replacement = '') => {
  if (!s.includes(needle)) throw new Error(`prove-red is stale: ${JSON.stringify(needle.slice(0, 70))} is no longer in the source`);
  return s.replace(needle, replacement);
};

function scratch(edits) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prinkreview-'));
  cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  for (const [rel, needle, replacement] of edits) {
    const f = path.join(dir, rel);
    writeFileSync(f, cut(readFileSync(f, 'utf8'), needle, replacement));
  }
  return dir;
}

function arm(n, what, edits, expect) {
  console.log(`\n${n}  ${what}`);
  let dir;
  try {
    dir = scratch(edits);
    const res = spawnSync(process.execPath, [TEST, dir], { cwd: ROOT, encoding: 'utf8' });
    const out = (res.stdout || '') + (res.stderr || '');
    const lines = out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());
    if (res.status === 0) { fail('the test still passed — this fault is invisible to it'); return; }
    if (!lines.some((l) => expect.test(l))) {
      fail(`exit ${res.status}, but no failure mentions ${expect}:\n     ${lines.join('\n     ') || '(no ✗ lines)'}`);
      return;
    }
    ok(`exit ${res.status} — ${lines.length} failure(s), including: ${lines.find((l) => expect.test(l))}`);
  } catch (e) {
    fail(e.message);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

console.log('0  the control — the tree as shipped');
{
  const dir = scratch([]);
  try {
    const res = spawnSync(process.execPath, [TEST, dir], { cwd: ROOT, encoding: 'utf8' });
    if (res.status !== 0) fail(`the control is RED, so every arm below is meaningless:\n${res.stdout}${res.stderr}`);
    else ok('exit 0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

arm(1, 'a hold read as an accept',
  [[LIB, "if (m.answer.verdict !== 'accept') return", 'if (false) return']],
  /a hold is uncovered/);

/* For an ink-moved map the answer's own build also catches a rebuild; the comparison
 * is what catches it for a no-ink map, and what tells the reader to re-collect. */
arm(2, "the review's build not compared with the render's",
  [[LIB, 'if (m.after !== build) return', 'if (false) return']],
  /no ink moved on ANOTHER build|names both builds/);

arm(3, 'an unparseable review filtered out as if it held nothing',
  [[LIB, '  const reviews = readReviews(root);', '  const reviews = readReviews(root).filter((r) => r.review);']],
  /will not parse/);

arm(4, 'the OLDEST review judges the map',
  [[LIB, '.map((m) => m[1]).sort().reverse()', '.map((m) => m[1]).sort()']],
  /OLDER review/);

arm('4a', 'any review that lists the map judges it, not only the current one',
  [[LIB, '  const r = reviews[0];', '  const r = reviews.find((x) => x.review && x.review.maps.some((y) => y && fwd(y.dir === undefined ? `Areas/${y.map}` : y.dir) === rel)) || reviews[0];']],
  /only an older review lists/);

arm(5, 'a build already staged delivered again',
  [[LIB, 'if (m.staged && m.staged.after === build) return', 'if (false) return']],
  /already-staged/);

arm(6, 'the render joined to its build by folder name',
  [[LIB, "  const hit = v && runs.find((r) => (r.version || versionOf(r.id)) === v);", '  const hit = runs.find((r) => r.id === render.id);']],
  /a minute after/);

arm(7, 'deliver-map.mjs stops calling the gate',
  [[DELIVER, '    INK = gateInkReview();', '    // gate removed']],
  /calls gateInkReview/);

arm(8, '--ink-unchecked left in the forwarded args',
  [[DELIVER, "  if (a === '--ink-unchecked') return false;\n", '']],
  /stripped/);

arm(9, 'the digest owed whatever the delivery did',
  [[DELIVER, "notify: has('no-notify') ? 'digest' : null", "notify: 'digest'"]],
  /--no-notify/);

console.log(failures ? `\n✗ ${failures} arm(s) did not go red for their reason` : '\n✓ every arm went red for its reason');
process.exit(failures ? 1 : 0);
