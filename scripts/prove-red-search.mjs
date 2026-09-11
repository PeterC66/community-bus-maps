#!/usr/bin/env node
// prove-red-search.mjs — falsify test-search.mjs's thoroughfare rule (buses-data OA-311).
//
//   node scripts/prove-red-search.mjs      (or: npm run test:prove-red-search)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags,
// no placeholders, no database of its own: each arm copies src/ and scripts/
// into a scratch tree, breaks ONE thing there, and runs the real test against
// the copy.
//
// WHY THIS EXISTS AT ALL. The rule it protects is a heuristic with an
// exemption, and both halves fail silently in opposite directions: without the
// rule the search answers "York" with three Buckinghamshire sheets, and without
// the exemption it stops finding two real villages. Neither failure throws,
// neither shows up in a byte gate, and both look exactly like a working search
// until somebody reads the results. So every arm below breaks one half and
// requires the check whose NAME is about that half to go red.
//
//   0  control — an untouched copy                          -> exit 0
//   1  the whole rule removed (fullOnly never set)           -> York and London return the street map
//   2  the knownPlaces exemption removed                     -> Bar Hill stops being a place
//   3  the bracket strip removed                             -> York Road (UB8) escapes the rule
//   4  the bare-name form removed from the exact pass        -> "York Road" stops finding York Road (UB8)
//   5  the fuzzy-pass guard removed                          -> a typo walks back through the closed door

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);
const scratches = [];

function makeCopy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-search-'));
  scratches.push(dir);
  // public/ as well as src/ and scripts/, because test-search.mjs finishes by
  // running check-chrome.mjs over public/*.html.
  for (const sub of ['src', 'scripts', 'public']) {
    cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  // package.json carries "type": "module" — without it every import in the copy
  // is read as CommonJS and nothing runs.
  cpSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  // AND node_modules, because the search index transitively imports
  // src/public/index.js, which imports sharp. A junction rather than a copy:
  // copying it takes minutes and this harness makes six scratch trees.
  //
  // THIS WAS NOT OBVIOUS AND IT FAILED SILENTLY-ISH. Without it every arm
  // exited 1 — which is what an arm wants — while printing NO failing checks at
  // all, because the test was dying on ERR_MODULE_NOT_FOUND before it could run
  // one. An arm that "passes" because its subject crashed proves nothing, which
  // is why each arm below names the check it expects to see red rather than
  // trusting the exit code.
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}

function runIn(dir) {
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'test-search.mjs')],
    { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

function patch(dir, rel, edit) {
  const p = path.join(dir, rel);
  const before = readFileSync(p, 'utf8');
  const after = edit(before);
  if (after === before) {
    fail(`the patch to ${rel} changed nothing — this harness is testing text that has moved`);
    return false;
  }
  writeFileSync(p, after);
  return true;
}

function arm(title, mutate, wants) {
  console.log(`\n${title}`);
  const dir = makeCopy();
  if (!mutate(dir)) return;
  const { out, code } = runIn(dir);
  if (code === 0) {
    fail('exit 0 — the break was not noticed, so that check proves nothing');
    return;
  }
  ok(`exit ${code}`);
  const r = reds(out);
  for (const [phrase, what] of wants) {
    if (r.some((l) => l.includes(phrase))) ok(`${what} went red`);
    else fail(`${what} stayed green ("${phrase}") — it does not check what its name says\n      red lines were: ${r.join(' | ') || '(none)'}`);
  }
}

const SEARCH = path.join('src', 'search', 'index.js');

console.log('\n0  the control — an untouched copy');
{
  const dir = makeCopy();
  const { out, code } = runIn(dir);
  if (code !== 0) fail(`the shipped test exits ${code} on a clean copy; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

arm('1  the whole rule removed — nothing is ever full-match-only',
  (dir) => patch(dir, SEARCH, (s) => s.replace(/if \(hit\.fullOnly && mr !== 0 && qn !== hit\.bare\) continue;/, '')),
  [
    ['"York" no longer returns a map whose only link is York Road', 'the York check'],
    ['"London" no longer returns a map whose only link is London Road', 'the London check'],
  ]);

arm('2  the knownPlaces exemption removed — a village ending in a street type is treated as a street',
  (dir) => patch(dir, SEARCH, (s) => s.replace('  return !knownPlaces.has(normalize(text));', '  return true;')),
  [["\"Bourne\" finds Bourne End, because a village is not a street", "the partial-village check"]]);

arm('3  the bracket strip removed — a name ending in a postcode escapes the rule',
  (dir) => patch(dir, SEARCH, (s) => s.replace(
    "  return normalize(String(text || '').replace(/\\([^)]*\\)/g, ' '));",
    "  return normalize(String(text || ''));")),
  [['"York" no longer returns a map whose only link is York Road', 'the York check']]);

arm('4  the bare-name form removed from the exact pass — the rule becomes technically correct and useless',
  (dir) => patch(dir, SEARCH, (s) => s.replace('if (hit.fullOnly && mr !== 0 && qn !== hit.bare) continue;', 'if (hit.fullOnly && mr !== 0) continue;')),
  [['a bracketed qualifier does not save the street from the rule', 'the "York Road" check']]);

arm('5  the fuzzy-pass guard removed — a typo reopens the door',
  (dir) => patch(dir, SEARCH, (s) => s.replace('    if (hit.fullOnly) continue;\n', '')),
  [['a typo on a street name gets no second chance either', 'the typo check']]);

for (const dir of scratches) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ } }

console.log(failures ? `\n✗ ${failures} falsification(s) failed` : '\n✓ every arm went red on purpose, and the control stayed green');
process.exit(failures ? 1 : 0);
