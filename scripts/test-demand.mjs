#!/usr/bin/env node
// OA-308 tier 4 — the demand tally: what may be stored, what may not, and the
// promise that this is a count of place names and not a log of searches.
//
//   node scripts/test-demand.mjs           (or: npm run test:demand)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags and
// no placeholders. It runs against a throwaway DATA_DIR in the system temp
// directory and never touches the real portal data.
//
// WHAT IS ACTUALLY AT RISK. Two things, and the second is the one that would not
// announce itself:
//
//   * The SHAPE FILTER. A free-text box receives names, emails, postcodes and
//     whole sentences, and a tally keyed on raw input would quietly become a
//     small pile of personal data in a table nobody reads. Every rejection rule
//     is checked here with an example that must be refused AND an example that
//     must be kept, because a filter that refuses everything passes a test that
//     only looks at one side.
//
//   * The SHAPE OF THE TABLE ITSELF. "It is a tally, not a log" is a claim about
//     columns that do not exist. Nothing about the running code would look wrong
//     if somebody added `created_at` or `ip` — the reports would still print —
//     so the absence is asserted against the live schema, by name.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-demand-'));
process.env.DATA_DIR = scratch;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { recordable, recordMiss, demandTally, MAX_CHARS, MAX_WORDS, DISTINCT_CAP } =
  await import('../src/search/demand.js');
const { db } = await import('../src/db/index.js');
const { SCHEMA_VERSION } = await import('../src/db/index.js');

console.log('\nthe shape filter — what may be stored');
const kept = [
  ['York', 'york'],
  ['  st ives  ', 'st ives'],
  ['St Ives', 'st ives'],
  ['ST IVES', 'st ives'],
  ['Weston-super-Mare', 'weston-super-mare'],
  ["Bishop's Stortford", "bishop's stortford"],
  ['Stoke on Trent', 'stoke on trent'],
  ['Bury St Edmunds', 'bury st edmunds'],
  ['Llanfairfechan', 'llanfairfechan'],
  ['St. Neots', 'st. neots'],
];
for (const [raw, key] of kept) {
  const v = recordable(raw);
  check(`"${raw}" is a place name -> "${key}"`, v.ok && v.key === key, JSON.stringify(v));
}
check('three spellings of one town are one row',
  recordable('York').key === recordable('york').key && recordable('york').key === recordable('YORK').key);

console.log('\n…and what may not, each with the reason it is refused');
const refused = [
  ['', 'too short'],
  ['y', 'too short'],
  ['x'.repeat(MAX_CHARS + 1), 'too long'],
  ['peter@example.com', 'not a plain name'],
  ['PE27 5BZ', 'not a plain name'],
  ['SW1A 1AA', 'not a plain name'],
  ['07700 900123', 'not a plain name'],
  ['https://busmaps.uk/maps', 'not a plain name'],
  ['route 401 to spaldwick', 'not a plain name'],
  ['Cambridge, Cambridgeshire', 'not a plain name'],
  ['where is the bus to st ives from', 'too many words'],
  ['1 High Street', 'not a plain name'],
];
for (const [raw, why] of refused) {
  const v = recordable(raw);
  check(`"${raw}" is refused (${why})`, !v.ok && v.reason === why, JSON.stringify(v));
}
check('a refusal carries no copy of the text', refused.every(([raw]) => recordable(raw).key === ''));
check(`the word limit is ${MAX_WORDS} and it bites at ${MAX_WORDS + 1}`,
  recordable('a b c d').ok && !recordable('a b c d e').ok);
check(`the length limit is ${MAX_CHARS} and it bites at ${MAX_CHARS + 1}`,
  recordable('x'.repeat(MAX_CHARS)).ok && !recordable('x'.repeat(MAX_CHARS + 1)).ok);

console.log('\nthe tally — counting up, not writing down');
check('a recordable miss is recorded', recordMiss('Harrogate') === 'recorded');
check('an unrecordable one is skipped', recordMiss('someone@example.com') === 'skipped');
recordMiss('Harrogate');
recordMiss('harrogate');
recordMiss('Swavesey');
{
  const t = demandTally();
  const harrogate = t.rows.find((r) => r.q === 'harrogate');
  check('the same place counts up rather than duplicating', !!harrogate && harrogate.n === 3,
    JSON.stringify(t.rows));
  check('two places are two rows', t.places === 2, String(t.places));
  check('the totals add up', t.searches === 4, String(t.searches));
  check('the refused one was counted without being quoted',
    t.skipped === 1 && !t.rows.some((r) => r.q.includes('@')), JSON.stringify(t));
  check('first and last seen are DATES, not timestamps', /^\d{4}-\d{2}-\d{2}$/.test(harrogate.first_seen),
    harrogate.first_seen);
  check('commonest first', t.rows[0].q === 'harrogate');
}

console.log('\nit is a tally, not a log — asserted against the live schema');
{
  const cols = db.prepare("SELECT name FROM pragma_table_info('search_demand')").all().map((r) => r.name);
  check('the columns are exactly the four a tally needs',
    JSON.stringify(cols.sort()) === JSON.stringify(['first_seen', 'last_seen', 'n', 'q']), cols.join(','));
  for (const forbidden of ['ip', 'remote_addr', 'address', 'session_id', 'user_id', 'user_agent', 'created_at', 'at']) {
    check(`no ${forbidden} column`, !cols.includes(forbidden));
  }
  const skip = db.prepare("SELECT name FROM pragma_table_info('search_demand_skipped')").all().map((r) => r.name);
  check('the skipped counter holds no text at all', !skip.includes('q') && !skip.includes('text'), skip.join(','));
  check('the schema version was bumped for these tables', SCHEMA_VERSION >= 3, String(SCHEMA_VERSION));
}

console.log('\nthe redaction lists are untouched — this must never become a search log');
{
  const { BARE_QUERY_ROUTES } = await import('../src/public/logRedaction.js');
  check('/api/public/search still has its query string dropped', BARE_QUERY_ROUTES.includes('/api/public/search'));
  check('/maps? too', BARE_QUERY_ROUTES.includes('/maps?'));
  const { loggableUrl } = await import('../src/public/logRedaction.js');
  check('a submitted search logs neither the query nor the intent',
    loggableUrl('/api/public/search?q=Harrogate&intent=submit') === '/api/public/search',
    loggableUrl('/api/public/search?q=Harrogate&intent=submit'));
}

console.log('\nit never throws into a request');
{
  check('a null query is skipped, not thrown', recordMiss(null) === 'skipped');
  check('an object is skipped, not thrown', recordMiss({}) === 'skipped');
}

console.log('\nthe cap is a number the code can state');
check(`DISTINCT_CAP is ${DISTINCT_CAP}, a few thousand and not unbounded`,
  DISTINCT_CAP >= 1000 && DISTINCT_CAP <= 100000);

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('✓ all demand checks passed');
