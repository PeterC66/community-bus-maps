#!/usr/bin/env node
// prove-red-engine-live.mjs — falsify test-engine-live.mjs.
//
//   node scripts/prove-red-engine-live.mjs   (or: npm run test:prove-red-engine-live)
//
// A gate that has never been seen to refuse proves nothing. Each arm puts one
// plausible mistake into a COPY of `scripts/` and requires the test to go red
// FOR THAT REASON — an arm that reddens for some other reason has established
// nothing about the assertion it was aimed at. Arm 1 is the one that matters:
// against the real a96a758 host, which lacks engine/legend_key.js, a gate that
// stopped reading the diff must be caught.
//
//   0  control — the tree as shipped                                -> exit 0
//   1  a non-empty engine diff reported as current                   -> "real incident -> behind"
//   2  a commit this clone does not hold reported as current         -> "an unknown commit"
//   3  the diff no longer limited to engine/                         -> "a later commit that touched no engine file"
//   4  deliver-map.mjs stops calling the gate                        -> "calls gateEngineLive"
//   5  --engine-unchecked left in the args forwarded to the host     -> "stripped"
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. Run it from the repository root
// (`C:\Claude\community-bus-maps`); it takes no arguments.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-engine-live.mjs');
const LIB = 'scripts/lib/engine-live.mjs';
const DELIVER = 'scripts/deliver-map.mjs';

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const cut = (s, needle, replacement = '') => {
  if (!s.includes(needle)) throw new Error(`prove-red is stale: ${JSON.stringify(needle.slice(0, 70))} is no longer in the source`);
  return s.replace(needle, replacement);
};

function scratch(edits) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prengine-'));
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

arm(1, 'a non-empty engine diff reported as current',
  [[LIB, 'if (!files.length) {', 'if (true) {']],
  /real incident -> behind/);

arm(2, 'a commit this clone does not hold reported as current',
  [[LIB, "return { verdict: 'cannot-tell', hostHead: host, wantedSha,\n      message: `the host is at", "return { verdict: 'current', hostHead: host, wantedSha,\n      message: `the host is at"]],
  /an unknown commit/);

arm(3, 'the diff no longer limited to engine/',
  [[LIB, "wantedSha, '--', 'engine/']", "wantedSha]"]],
  /a later commit that touched no engine file/);

arm(4, 'deliver-map.mjs stops calling the gate',
  [[DELIVER, '} else {\n  gateEngineLive();\n}', '} else {\n  // gate removed\n}']],
  /calls gateEngineLive/);

arm(5, '--engine-unchecked left in the forwarded args',
  [[DELIVER, "  if (a === '--engine-unchecked') return false;\n", '']],
  /stripped/);

console.log(failures ? `\n✗ ${failures} arm(s) did not go red for their reason` : '\n✓ every arm went red for its reason');
process.exit(failures ? 1 : 0);
