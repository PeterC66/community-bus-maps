#!/usr/bin/env node
// prove-red-directory.mjs — falsify test-directory.mjs (buses-data OA-308 tier 2).
//
//   node scripts/prove-red-directory.mjs     (or: npm run test:prove-red-directory)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags and
// no placeholders.
//
// A test written the same hour as its subject and green on its first run has
// been seen to do nothing at all. Each arm below breaks ONE thing the directory
// panel promises a reader and requires the named check to go red; the control
// requires the unmutated copy to stay green, and it is the arm that has caught a
// harness bug before anywhere else could.
//
//   0  control — an untouched copy of the tree                -> exit 0
//   1  an `unknown` status put back into a row                -> the shape check
//   2  the "Not ours" badge and the "Published by …" label
//        taken off the card                                   -> the three promises
//   3  substring matching switched on in the matcher          -> "ton" hits
//   4  rows that publish nothing filtered out of the results  -> an absence is a result
//   5  the checked date taken from the clock instead of the
//        data — the clock-dependent-artefact shape            -> the date check
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY: each arm copies src/, public/ and
// scripts/ into a scratch tree, edits the copy, and runs the test from there.
// The test resolves the vendored file from its own module path, so a copy is a
// complete and isolated subject — no node_modules, no database, no network.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);
const scratches = [];

/** A throwaway copy of everything the test touches. */
function makeCopy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-directory-'));
  scratches.push(dir);
  for (const sub of ['src', 'scripts', path.join('public', 'js'), path.join('public', 'data')]) {
    cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  return dir;
}

function runIn(dir) {
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'test-directory.mjs')],
    { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

/** Rewrite one file in the copy. `edit` gets the text and returns the new text. */
function patch(dir, rel, edit) {
  const p = path.join(dir, rel);
  const before = readFileSync(p, 'utf8');
  const after = edit(before);
  if (after === before) {
    fail(`the patch to ${rel} changed nothing — this harness is testing the wrong text`);
    return false;
  }
  writeFileSync(p, after);
  return true;
}

/** An arm: mutate, run, and require a check whose line contains `phrase` to be red. */
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

console.log('\n0  the control — an untouched copy');
{
  const dir = makeCopy();
  const { out, code } = runIn(dir);
  if (code !== 0) fail(`the shipped test exits ${code} on a clean copy; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

arm('1  an `unknown` status put back into one row',
  (dir) => patch(dir, path.join('public', 'data', 'bus-map-directory.json'), (s) => {
    const doc = JSON.parse(s);
    doc.rows[0].networkMap.status = 'unknown';
    return JSON.stringify(doc, null, 2) + '\n';
  }),
  [['no row still says unknown', 'the shape check']]);

arm('2  the "Not ours" badge and the "Published by …" label taken off the card',
  (dir) => patch(dir, path.join('public', 'js', 'shared', 'map-card.mjs'), (s) => s
    .replace('<span class="badge notours">Not ours</span> ', '')
    .replace('Published by ${esc(d.authority)}, last checked on ${esc(whenGB(d.checked))}', 'Updated recently')),
  [
    ['carries the "Not ours" badge', 'the badge check'],
    ['last checked on', 'the "Published by …, last checked on …" check'],
  ]);

arm('3  substring matching switched on in the matcher',
  (dir) => patch(dir, path.join('src', 'search', 'directory.js'), (s) => s
    .replace('  if (norm.startsWith(qn)) return 2;\n  return -1;', '  if (norm.startsWith(qn)) return 2;\n  if (norm.includes(qn)) return 3;\n  return -1;')),
  [['a bare substring of a name does not match', 'the substring check']]);

arm('4  rows that publish nothing filtered out of the results',
  (dir) => patch(dir, path.join('src', 'search', 'directory.js'), (s) => s
    .replace('.map(({ term }) => ({ offer: offerOf(term.row), reason: reasonFor(term) }));',
      '.map(({ term }) => ({ offer: offerOf(term.row), reason: reasonFor(term) }))\n    .filter((r) => r.offer.status !== \'none\');')),
  [['still RETURNED by a search', 'the absence-is-a-result check']]);

arm('4b  a survey note copied into the public vendored file',
  (dir) => patch(dir, path.join('public', 'data', 'bus-map-directory.json'), (s) => {
    const doc = JSON.parse(s);
    doc.rows[0].networkMap.note = 'Their website is a mess and the map is four years old.';
    return JSON.stringify(doc, null, 2) + '\n';
  }),
  [['no survey note reached this public repository', 'the projection check']]);

arm('5a  covers[] ignored, so an area inside a differently-named authority matches nothing',
  (dir) => patch(dir, path.join('src', 'search', 'directory.js'), (s) => s
    .replace("    for (const area of row.covers || []) add(area, 'area');\n", '')),
  [
    ['"Derbyshire" reaches the East Midlands Combined Authority', 'the covers check'],
    ['"Allerdale" reaches Cumberland', 'the abolished-district check'],
  ]);

arm('5b  the "But: somebody else publishes one" block dropped from the card',
  (dir) => patch(dir, path.join('public', 'js', 'shared', 'map-card.mjs'), (s) => s
    .replace('        ${also}\n', '')),
  [['does NOT leave a York reader with "no bus map"', 'the York check']]);

arm('6  the checked date taken from the clock instead of the data',
  (dir) => patch(dir, path.join('src', 'search', 'directory.js'), (s) => s
    .replace('checked: row.checked || \'\',', 'checked: new Date().toISOString().slice(0, 10),')),
  [["the date rendered is the row's own, not today's", 'the clock-independence check']]);

for (const dir of scratches) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ } }

console.log(failures ? `\n✗ ${failures} falsification(s) failed` : '\n✓ every arm went red on purpose, and the control stayed green');
process.exit(failures ? 1 : 0);
