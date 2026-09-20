#!/usr/bin/env node
// prove-red-newest-render.mjs — falsify test-newest-render.mjs.
//
//   node scripts/prove-red-newest-render.mjs   (or: npm run test:prove-red-newest-render)
//
// A gate that has never been seen to refuse proves nothing, and this one guards
// a fault that shipped four times while every check in the building was green.
// So each arm puts a real, previously-shipped mistake back and requires the
// test to go red FOR THAT REASON — an arm that reddens for some other reason
// has established nothing about the assertion it was aimed at.
//
//   0  control — the tree as shipped                          -> exit 0
//   1  THE BUG VERBATIM: the comparison done by sorting the
//      S5-render listing as text and taking the last, which is
//      `ls -1 … | tail -1` in JavaScript                      -> exit 1, and the
//      failures must include the v1.9/v1.19 case and St Neots Co-op's, and NOT
//      St Neots (area), the one of the four that a text sort gets right
//   2  `cannot-tell` folded into a pass                       -> exit 1, naming
//      all three ways of not knowing
//   3  the not-on-this-disk case treated as "nothing newer"   -> exit 1, naming it
//   4  deliver-map.mjs stops calling the predicate            -> exit 1, "calls it"
//   5  the superseded branch warns instead of exiting         -> exit 1, "exits non-zero"
//   6  --render-superseded left in the forwarded args         -> exit 1, "stripped"
//   7  the gate moved AFTER the scp                           -> exit 1, "BEFORE the scp"
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY: each arm copies `scripts/` into a
// scratch tree, edits the copy, and runs the shipped test against that tree,
// which the test accepts as its one positional argument.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-newest-render.mjs');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

function scratch(mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prnewrender-'));
  cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
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
  if (!s.includes(needle)) throw new Error(`prove-red is stale: ${JSON.stringify(needle.slice(0, 70))} is no longer in the source`);
  return s.replace(needle, replacement);
};

/**
 * One arm. `expects` must ALL appear among the red lines; `forbids` must not.
 * The forbids half is what makes arm 1 mean something: a text sort is RIGHT
 * about v2.32 against v3.1, so an arm claiming to restore it had better leave
 * that case green.
 */
function arm(n, what, mutate, expects, forbids = []) {
  console.log(`\n${n}  ${what}`);
  let dir;
  try {
    dir = scratch(mutate);
    const { out, code } = run(dir);
    if (code === 0) { fail('the test still passed — this fault is invisible to it'); return; }
    const lines = reds(out);
    for (const expect of [].concat(expects)) {
      if (!lines.some((l) => expect.test(l))) {
        fail(`exit ${code}, but no failure mentions ${expect}:\n     ${lines.join('\n     ') || '(no ✗ lines)'}`);
        return;
      }
    }
    for (const forbid of forbids) {
      if (lines.some((l) => forbid.test(l))) {
        fail(`a failure mentions ${forbid}, which this fault must NOT reach:\n     ${lines.join('\n     ')}`);
        return;
      }
    }
    ok(`exit ${code} — ${lines.length} failure(s), including: ${lines[0]}`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

const LIB = 'scripts/lib/newest-render.mjs';
const DELIVER = 'scripts/deliver-map.mjs';

// The whole body of checkNewestRender, from its signature to the end of the
// function, replaced wholesale by the arm that wants a different one.
const SIGNATURE = 'export function checkNewestRender(srcDir) {';

console.log('\n0  the control — the tree as shipped');
{
  const dir = scratch(null);
  try {
    const { out, code } = run(dir);
    if (code !== 0) fail(`the control is RED, so every arm below is meaningless:\n${out}`);
    else ok('exit 0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
// 1. The bug verbatim. `ls -1 <map>/S5-render | tail -1`, written in JavaScript:
//    read the directory, sort it as text, and call the last entry current. This
//    is what chose three of the four renders on 2026-09-15.
// ---------------------------------------------------------------------------
arm(1, 'the comparison done by a TEXT SORT of the listing, which is the original bug', ({ read, write }) => {
  const s = read(LIB);
  const i = s.indexOf(SIGNATURE);
  if (i === -1) throw new Error('prove-red is stale: checkNewestRender has been renamed');
  // The function's own closing brace: the first `}` at column 0 after it.
  const j = s.indexOf('\n}\n', i);
  if (j === -1) throw new Error('prove-red is stale: checkNewestRender no longer ends at column 0');
  const TEXT_SORT = [
    "export function checkNewestRender(srcDir) {",
    "  const abs = path.resolve(srcDir);",
    "  const parent = path.dirname(abs);",
    "  if (path.basename(parent) !== 'S5-render') {",
    "    return { verdict: 'not-a-render', runId: null, latest: null, mapRoot: null, latestOnDisk: null, message: `${srcDir} is not a render folder` };",
    "  }",
    "  const runId = path.basename(abs);",
    "  const listed = readdirSync(parent).sort();",
    "  const latest = listed[listed.length - 1];",
    "  return {",
    "    verdict: latest === runId ? 'current' : 'superseded',",
    "    runId, latest, mapRoot: path.dirname(parent), latestOnDisk: true,",
    "    message: `${runId} against ${latest}, and the current one is on this disk.`,",
    "  };",
  ].join('\n');
  const mutated = s.slice(0, i) + TEXT_SORT + s.slice(j);
  write(LIB, mutated.replace(
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { existsSync, readFileSync, readdirSync } from 'node:fs';"));
  // The FORBID is St Neots (area), the one delivery of the four that was right
  // on 2026-09-15 — right, as OA-368's table says, by luck of the sort. Its
  // single run is the last entry of its own listing, so a text sort agrees with
  // the manifest about it. An arm that reddened that case too would be an arm
  // that breaks everything, and would say nothing about the text sort.
}, [/v1\.9 delivered while the manifest says v1\.19/, /St Neots Co-op/], [/St Neots: delivered/]);

// ---------------------------------------------------------------------------
// 2. "Could not check" folded into "checked and fine" — the audit's V2, and the
//    exact shape the S6 gate beside this one exists to prevent.
// ---------------------------------------------------------------------------
arm(2, 'every cannot-tell turned into a pass', ({ read, write }) => {
  let s = read(LIB);
  s = s.replace(/verdict: 'cannot-tell'/g, "verdict: 'current'");
  write(LIB, s);
}, [/no manifest above it is cannot-tell/, /unparseable manifest/, /no current S5 run/, /ways of not knowing returns "current"/]);

// ---------------------------------------------------------------------------
// 3. The retention case. prune_runs.py deletes old runs and S5-render is
//    gitignored, so a tree can record a current render it does not hold —
//    reading that as "nothing newer exists" is how a pruned clone would deliver
//    a stale render with the gate green.
// ---------------------------------------------------------------------------
arm(3, 'a current render that is not on this disk read as "nothing newer"', ({ read, write }) => {
  const s = read(LIB);
  write(LIB, cut(s,
    "  return { ...found, latest, latestOnDisk, verdict: 'superseded',",
    "  if (!latestOnDisk) return { ...found, latest, latestOnDisk, verdict: 'current', message: 'nothing newer on disk' };\n  return { ...found, latest, latestOnDisk, verdict: 'superseded',"));
}, [/NOT on this disk still supersedes/]);

// ---------------------------------------------------------------------------
// 4–7. The wiring. A predicate nothing calls, a refusal that does not refuse,
//      an override forwarded to a script that will reject it, and a gate that
//      runs after the upload it was supposed to prevent.
// ---------------------------------------------------------------------------
arm(4, 'deliver-map.mjs stops calling the predicate', ({ read, write }) => {
  write(DELIVER, cut(read(DELIVER), 'const r = checkNewestRender(SRC);', "const r = { verdict: 'current', message: 'x' };"));
}, [/it calls it/]);

arm(5, 'the superseded branch warns instead of exiting', ({ read, write }) => {
  const s = read(DELIVER);
  const i = s.indexOf('✗ 0b. Newest render: REFUSED (SUPERSEDED)');
  if (i === -1) throw new Error('prove-red is stale: the superseded banner has changed');
  const j = s.indexOf('process.exit(1);', i);
  write(DELIVER, `${s.slice(0, j)}// warned only\n${s.slice(j + 'process.exit(1);'.length)}`);
}, [/superseded branch exits non-zero/]);

arm(6, '--render-superseded left in the args forwarded to the importer', ({ read, write }) => {
  write(DELIVER, cut(read(DELIVER),
    "  if (a === '--render-superseded') return false;\n  if (all[i - 1] === '--render-superseded') return false;\n"));
}, [/stripped from the args/]);

arm(7, 'the gate moved after the scp, so a refusal has already uploaded', ({ read, write }) => {
  const s = read(DELIVER);
  const call = 'if (RENDER_SUPERSEDED) {';
  const i = s.indexOf(call);
  if (i === -1) throw new Error('prove-red is stale: the gate call site has changed');
  const end = s.indexOf('}\nconsole.log(\'\');', i);
  if (end === -1) throw new Error('prove-red is stale: the gate call site no longer ends where expected');
  const block = s.slice(i, end + 2);
  write(DELIVER, `${s.slice(0, i)}${s.slice(i + block.length)}\n${block}`);
}, [/BEFORE the scp/]);

console.log('');
if (failures) { console.error(`✗ prove-red-newest-render: ${failures} arm(s) did not redden as required`); process.exit(1); }
console.log('✓ prove-red-newest-render: every arm reddened, control green');
