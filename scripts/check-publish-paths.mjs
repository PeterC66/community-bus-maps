#!/usr/bin/env node
// EVERY PATH THAT MOVES THE PUBLISHED POINTER MUST WRITE THE PLACE-NAME SIDECAR
// (buses-data OA-379, 2026-09-16).
//
//   node scripts/check-publish-paths.mjs        (or: npm run check:publish-paths)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments and there are no placeholders.
//
// WHY THIS EXISTS, which is the only part worth reading.
//
// `writePlacesSidecar()` gives a published version its place names — the external
// sheet's destinations and the stops along each route — and it is what makes a map
// findable on /maps by the villages it serves rather than only by its own title.
// Until today it was called from exactly ONE place: the approve handler in
// src/routes/review.js. `scripts/publish-baseline.mjs` moves the same pointer by
// calling the same db functions directly and called neither it nor anything like
// it, and that is the path the first real customer's four St Neots maps went out
// on. Measured on the live site on 2026-09-16, before the fix: searching Tilbrook
// or Abbotsley returned no map of ours, although the published sheet's routes 150,
// 18 and C2 all call there; Boxworth returned St Ives and not St Neots.
//
// Nothing went red, and nothing could have. buildIndex() in src/search/index.js
// skips a version with no sidecar in a single line — a comment written for the
// one-off P9 backfill — so a permanent defect wore the clothes of a temporary one.
// And scripts/test-search.mjs could not see it either, because its own seedMap()
// helper calls writePlacesSidecar itself: a fixture that re-implements the rule
// under test can only ever confirm the rule, never the code that has to keep it.
//
// SO THE REQUIREMENT IS RECORDED HERE AS A RULE ABOUT THE CLASS, not as a line in
// one handler. Each call site is DECLARED below with what it is and whether it
// writes a sidecar; a call site that is not declared is a finding, a declaration
// with no call site behind it is a finding, and a declaration that disagrees with
// the code is a finding in both directions — a `writes` site that stopped writing
// (this morning's state) and an `exempt` site that quietly started.
//
// Declared and not inferred, on purpose. A checker that tried to decide for itself
// whether a given publish path OUGHT to write a sidecar would be guessing at
// intent, and the revert path is the proof that the guess would be wrong: it moves
// the pointer and must NOT write one.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, '..');

/** The function whose callers this check is about. */
const POINTER = 'setPublishedVersion';
/** What a caller of it must also call, unless it is declared exempt. */
const SIDECAR = 'writePlacesSidecar';
/**
 * How far after the pointer move we look for the sidecar write. Generous, because
 * the approve handler puts nine lines of state changes and a comment between the
 * two; small enough that a call in an unrelated function further down the file
 * cannot answer for this one.
 */
const WINDOW = 40;

// Folders searched. `public/` is the browser's half and has no database.
const TREES = ['src', 'scripts'];

// Files that call the pointer and are NOT publish paths. Each says why, because an
// exclusion with no reason is a hole that reads as coverage.
const NOT_A_PUBLISH_PATH = {
  'src/db/index.js': 'declares the function; it is the pointer, not a path to it',
};
/**
 * Test and harness files build their own published state in a throwaway DATA_DIR
 * and are not publish paths either. Excluded by SHAPE rather than by name, so a
 * new test does not have to be added here — and stated out loud because that is
 * the one exclusion wide enough to hide a real path if somebody ever names a
 * production script `test-something.mjs`.
 */
const isHarness = (rel) => /^scripts\/(test|prove-red)-[^/]*\.mjs$/.test(rel);

/**
 * THE DECLARATION. One entry per call site, in the order it appears in its file.
 *   what    — what this path does, in a reader's words
 *   sidecar — 'writes' or 'exempt'
 *   why     — required for 'exempt'; ignored otherwise
 */
const DECLARED = [
  {
    file: 'src/routes/review.js', index: 0,
    what: 'an approver approves a publish request',
    sidecar: 'writes',
  },
  {
    file: 'src/routes/review.js', index: 1,
    what: 'an admin reverts the public site to an earlier published version',
    sidecar: 'exempt',
    why: 'the version reverted to has its own sidecar from the day it was published; rewriting it from the current data dir would describe a sheet nobody reviewed',
  },
  {
    file: 'scripts/publish-baseline.mjs', index: 0,
    what: 'a freshly imported map\'s v1.0 baseline is published from the command line',
    sidecar: 'writes',
  },
  {
    file: 'scripts/seed-demo.mjs', index: 0,
    what: 'the demo seeder publishes a sample map\'s baseline',
    sidecar: 'writes',
  },
  {
    file: 'scripts/seed-demo.mjs', index: 1,
    what: 'the demo seeder publishes a sample map with the boarding plan switched on',
    sidecar: 'writes',
  },
];

// --- find the call sites --------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const found = [];
const skipped = [];
for (const tree of TREES) {
  for (const full of walk(join(ROOT, tree))) {
    const rel = relative(ROOT, full).split('\\').join('/');
    const text = readFileSync(full, 'utf8');
    if (!text.includes(`${POINTER}(`)) continue;
    if (NOT_A_PUBLISH_PATH[rel]) { skipped.push([rel, NOT_A_PUBLISH_PATH[rel]]); continue; }
    if (isHarness(rel)) { skipped.push([rel, 'a test or harness building its own state in a throwaway DATA_DIR']); continue; }

    const lines = text.split(/\r?\n/);
    let index = 0;
    lines.forEach((line, i) => {
      // The definition itself, wherever it lives, is not a call.
      if (/^\s*export\s+function\s/.test(line)) return;
      if (!line.includes(`${POINTER}(`)) return;
      const window = lines.slice(i, i + WINDOW).join('\n');
      found.push({ file: rel, index: index++, line: i + 1, writes: window.includes(`${SIDECAR}(`) });
    });
  }
}
found.sort((a, b) => a.file.localeCompare(b.file) || a.index - b.index);

// --- join them to the declaration ----------------------------------------

const findings = [];
const key = (d) => `${d.file}#${d.index}`;
const declaredBy = new Map(DECLARED.map((d) => [key(d), d]));
const foundBy = new Map(found.map((f) => [key(f), f]));

for (const f of found) {
  const d = declaredBy.get(key(f));
  if (!d) {
    findings.push(`${f.file}:${f.line} — a publish path this check has never been told about. Add it to DECLARED in ${relative(ROOT, fileURLToPath(import.meta.url)).split('\\').join('/')}, saying what it does and whether it writes the place-name sidecar.`);
    continue;
  }
  if (d.sidecar === 'writes' && !f.writes) {
    findings.push(`${f.file}:${f.line} — declared as writing the place-name sidecar (${d.what}) and no ${SIDECAR}() call follows within ${WINDOW} lines. Maps published this way answer the /maps search by their own title and nothing else.`);
  }
  if (d.sidecar === 'exempt' && f.writes) {
    findings.push(`${f.file}:${f.line} — declared EXEMPT (${d.why}) and a ${SIDECAR}() call now follows it. Either the code is wrong or the declaration is stale; both are worth a second look.`);
  }
}
for (const d of DECLARED) {
  if (!foundBy.has(key(d))) {
    findings.push(`${d.file} #${d.index} — declared (${d.what}) but there is no ${POINTER}() call there any more. Delete the entry: a stale declaration reads as coverage.`);
  }
  if (d.sidecar === 'exempt' && !(d.why || '').trim()) {
    findings.push(`${d.file} #${d.index} — exempt with no reason. An exemption must say why the sidecar would be wrong here.`);
  }
  if (d.sidecar !== 'writes' && d.sidecar !== 'exempt') {
    findings.push(`${d.file} #${d.index} — sidecar is "${d.sidecar}"; it must be "writes" or "exempt".`);
  }
}

// --- report ---------------------------------------------------------------

for (const [rel, why] of skipped.sort()) console.log(`  · not a publish path: ${rel} — ${why}`);
const writes = found.filter((f) => f.writes).length;
console.log(`\n${found.length} publish path(s) that move the published pointer; ${writes} write the place-name sidecar, ${found.length - writes} do not.`);

if (findings.length) {
  console.error('');
  for (const f of findings) console.error(`  ✗ ${f}`);
  console.error(`\n${findings.length} finding(s).`);
  process.exit(1);
}
console.log('Every one of them is declared, and every declaration matches the code.');
