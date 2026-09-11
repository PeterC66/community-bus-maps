#!/usr/bin/env node
// OA-308 tier 4 — read the demand tally: which places people looked for on
// /maps and found no map of ours for.
//
//   node scripts/demand-report.mjs                 the top 40, as a table
//   node scripts/demand-report.mjs --all           every place name held
//   node scripts/demand-report.mjs --limit 100     the top 100
//   node scripts/demand-report.mjs --json          the same figures as JSON
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). There are no
// placeholders in those commands. It reads DATA_DIR's database, so on the VPS it
// is run there and not on a laptop, where the tally is whatever local testing
// put in it.
//
// THIS IS THE ONLY READER, AND THAT IS DELIBERATE. There is no route, no admin
// screen and no API that serves this. A private count of what people could not
// find is evidence for the CIC papers and for a conversation with a council; a
// public list of what visitors type into a search box is a different object with
// a different set of questions attached to it, and nobody has asked for one.
//
// What the numbers mean, and what they do not. A row is a SUBMITTED search that
// matched no map of ours — a reader who pressed Enter, or arrived at a /maps?q=
// link — counted once per search and not once per person: five searches could be
// five people or one person on five days, and `first_seen`/`last_seen` are the
// only thing that distinguishes those. Crawlers following a shared ?q= link
// count too. It is a signal, not a measurement, and a paper quoting it should
// say so. `skipped` is how many misses were NOT recorded because the text did
// not look like a place name — see src/search/demand.js for that rule.
//
// Exit codes follow docs/CONVENTIONS.md: 0 printed, 2 used wrongly.

import { demandTally } from '../src/search/demand.js';
import { DB_PATH } from '../src/db/paths.js';

const args = process.argv.slice(2);
const KNOWN = ['--all', '--json', '--limit'];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') { i++; continue; }
  if (!KNOWN.includes(args[i])) {
    console.error(`demand-report: unknown flag ${args[i]}. Known flags: ${KNOWN.join(' ')} <n>`);
    process.exit(2);
  }
}
const JSON_OUT = args.includes('--json');
const limitAt = args.indexOf('--limit');
const limit = args.includes('--all') ? 1000000
  : limitAt >= 0 ? Number(args[limitAt + 1])
    : 40;
if (!Number.isFinite(limit) || limit < 1) {
  console.error('demand-report: --limit needs a positive number.');
  process.exit(2);
}

const t = demandTally({ limit });

if (JSON_OUT) {
  console.log(JSON.stringify({ db: DB_PATH, ...t }, null, 2));
  process.exit(0);
}

console.log(`Places people searched for and we had no map of — ${DB_PATH}\n`);
if (!t.rows.length) {
  console.log('  Nothing recorded yet.');
} else {
  const w = Math.max(...t.rows.map((r) => r.q.length), 5);
  console.log(`  ${'place'.padEnd(w)}  count  first asked   last asked`);
  console.log(`  ${'-'.repeat(w)}  -----  -----------   ----------`);
  for (const r of t.rows) {
    console.log(`  ${r.q.padEnd(w)}  ${String(r.n).padStart(5)}  ${r.first_seen}    ${r.last_seen}`);
  }
}
console.log(`\n  ${t.places} place name(s), ${t.searches} submitted search(es) with no map of ours.`);
console.log(`  ${t.skipped} further miss(es) were not recorded because the text did not look like a place name${t.skippedLast ? `, most recently on ${t.skippedLast}` : ''}.`);
console.log('\n  A signal, not a measurement: one person searching five times counts five.');
