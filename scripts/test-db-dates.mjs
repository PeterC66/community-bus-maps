#!/usr/bin/env node
// test-db-dates.mjs — the one reader of a stored timestamp, and the census that
// keeps it the only one.
//
// WHY (codebase review 2026-09-01, portal-src F11). The conversion from SQLite's
// `datetime('now')` form to a JS instant was hand-written at nine sites in five
// files and only ONE of them checked the shape first. This asserts what the
// helper does, and then asks the closed question that stops the nine coming back:
// no file under src/ may convert a timestamp by hand.
//
// THE CENSUS IS THE HALF THAT LASTS. Testing `parseDbDate` proves the helper is
// right; it says nothing about whether anybody uses it. The `dbDateToIso`
// duplication was not a bug in any one of those nine lines — each was locally
// correct on the input its author had in mind — it was a bug in there being nine.
//
// Run from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:db-dates

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { parseDbDate, dbDateToIso, dbDateMs, NOW_SQL } from '../src/db/dates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};
const eq = (got, want, what) => check(got === want, what, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

console.log('test-db-dates — one reader, and nobody else converting by hand\n');

console.log('the SQLite form, which is UTC without saying so:');
eq(dbDateToIso('2026-09-03 01:23:45'), '2026-09-03T01:23:45.000Z', "datetime('now') output is read as UTC");
eq(dbDateToIso('2026-09-03 01:23:45.678'), '2026-09-03T01:23:45.678Z', 'fractional seconds survive');
// The fault the eight unguarded sites had: `+ 'Z'` on a value that already ends
// in one gives `...ZZ`, and new Date() of that is Invalid Date — which this
// codebase renders as an empty string, not as an error.
console.log('\nthe ISO form, which the naive fix-up turned into an Invalid Date:');
eq(dbDateToIso('2026-09-03T01:23:45Z'), '2026-09-03T01:23:45.000Z', 'an already-ISO value is passed through');
eq(dbDateToIso('2026-09-03T01:23:45.000Z'), '2026-09-03T01:23:45.000Z', 'with milliseconds too');
check(new Date(String('2026-09-03T01:23:45Z').replace(' ', 'T') + 'Z').toString() === 'Invalid Date',
  'and the old hand-written form really does produce an Invalid Date on it',
  'the premise of this whole change no longer holds — re-measure before trusting the comment in dates.js');

console.log('\nthe absent and the unusable:');
for (const v of [null, undefined, '', 'not a date', {}, NaN]) {
  eq(dbDateToIso(v), null, `${JSON.stringify(v) ?? String(v)} reads as null rather than as an Invalid Date`);
}
check(Number.isNaN(dbDateMs('rubbish')), 'dbDateMs of an unusable value is NaN', 'it returned a number');
check(parseDbDate('2026-09-03 01:23:45') instanceof Date, 'parseDbDate hands back a Date', 'not a Date');

console.log('\nordering, which is why the stored format was left alone:');
{
  // Measured rather than reasoned: `T` is 0x54 and a space is 0x20, so in the
  // plain string comparison SQLite does on TEXT, an 11pm row in the old form
  // sorts BEFORE a 1am row in the new one. Any partial migration leaves exactly
  // this state, silently, with the newest row at the bottom of the list.
  const older = '2026-09-03T01:00:00Z';   // 1am, "new" form
  const newer = '2026-09-03 23:00:00';    // 11pm, stored form
  const stringOrder = [newer, older].sort();
  check(stringOrder[0] === newer, 'a mixed store really does sort wrongly',
    'the inversion is gone — if the storage format has been unified, dates.js\'s reasoning needs rewriting');
  check(dbDateMs(older) < dbDateMs(newer), 'and the helper gets the real order right', 'the helper is wrong');
}

console.log('\nthe writer:');
eq(NOW_SQL, "datetime('now')", 'there is one spelling of "now" and this is it');

// ---- the census -------------------------------------------------------------
console.log('\nthe census — nobody converts a stored timestamp by hand:');
const HAND_ROLLED = [
  // `.replace(' ', 'T')` — the shape all nine sites had.
  { re: /replace\(\s*['"] ['"]\s*,\s*['"]T['"]\s*\)/, why: "the ' ' -> 'T' fix-up" },
];
const ALLOWED = new Set(['src/db/dates.js']);

/* THE ARM THAT IS DELIBERATELY NOT HERE, and why — it was written, run, and
 * removed rather than shipped. A second arm flagged any literal `datetime('now')`
 * outside db/, on the reasoning that NOW_SQL should be the one spelling. It
 * produced two findings on its first run and BOTH WERE FALSE: a comment in
 * auth/index.js explaining that `expires_at > datetime('now')` compares correctly
 * as strings, and ops/index.js:131 doing exactly that comparison. A `datetime('now')`
 * in a WHERE clause is not a stored value at all — it is the clock, in the one
 * place the clock belongs — and a rule that cannot tell a comparison from a write
 * would sit red on that line for ever. A check that produces false findings is
 * muted within a week, and then it is not protecting the true ones either.
 *
 * So NOW_SQL is a convention with a name and a docstring, asserted above to be the
 * one spelling, and not a census. The census covers the READ conversion, which is
 * where the nine copies actually were. */

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
};
const offenders = [];
let scanned = 0;
for (const p of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, p).replace(/\\/g, '/');
  const src = readFileSync(p, 'utf8');
  scanned++;
  for (const { re, why } of HAND_ROLLED) {
    if (ALLOWED.has(rel)) continue;
    if (re.test(src)) offenders.push(`${rel} carries ${why} — use src/db/dates.js`);
  }
}
check(scanned > 30, 'the census read the whole of src/', `only ${scanned} files scanned — the walk is not reaching it`);
check(offenders.length === 0, `no file under src/ converts a timestamp by hand (${scanned} files)`, '\n    ' + offenders.join('\n    '));

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('One reader, one writer, and nothing else converting.');
