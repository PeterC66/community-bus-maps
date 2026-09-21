#!/usr/bin/env node
// test-schema-version.mjs — SCHEMA_VERSION describes the migrations below it.
//
// WHY (buses-data OA-325). docs/DEPLOY.md has said "Bump `SCHEMA_VERSION` in
// `src/db/index.js` when you add a migration" since the constant was introduced,
// and nothing checked it. On 2026-09-12 PR #282 (buses-data OA-320) added
//     ALTER TABLE customer ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 1
// to migrate() and left SCHEMA_VERSION at 4. Every gate in `npm test` passed. It
// was caught by a person re-reading the runbook before deploying, and #283 fixed
// it. The constant is not decorative: `schema_version` is one row recording which
// generation of the code last migrated the database, and a database written by a
// NEWER release than the running code logs a warning naming both numbers. That is
// the one signal a rollback produces, and a constant left one behind means the
// signal does not fire in exactly the case it exists for.
//
// WHAT IS ADJACENT AND CANNOT SEE THIS. scripts/test-schema-compat.mjs asks
// whether the ROLLBACK PAIR OPENS — build a database with this code, open it with
// the previous release's code, assert the older code tolerates an unknown column.
// That answer is identical whether the constant was bumped or not, because the
// constant changes no column. It even reads `dbmod.SCHEMA_VERSION` and prints it,
// as a recorded value rather than as a claim, which is the easiest kind of false
// comfort there is. scripts/test-db-constraints.mjs is the nearer relative: it
// joins schema.sql's `--` comments to src/db/enums.js, the same species of check —
// a comment held to the code beside it — and the version blocks here are that same
// shape with no such join until now.
//
// IT READS TEXT AND NEVER OPENS A DATABASE. The question is about what the source
// SAYS, so parsing it is the honest instrument; building a database would answer a
// different question and would answer it green either way.
//
// Run from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:schema-version
//
// It resolves its tree from its OWN location rather than from the cwd, so the
// scratch copy prove-red-schema-version.mjs builds is checked by running the copy
// of this file that sits inside it — the pattern every prove-red here uses. There
// is deliberately no --root flag: a flag only the harness would ever pass is one
// more thing that can point at the real repository while the output says otherwise.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

console.log('test-schema-version — the constant describes the migrations below it\n');

const indexJs = readFileSync(path.join(ROOT, 'src/db/index.js'), 'utf8');
const schemaSql = readFileSync(path.join(ROOT, 'src/db/schema.sql'), 'utf8');

/* ---------------------------------------------------------------------------
 * THE PRE-v1 BASELINE — the one judgement in this file, DECLARED and not computed.
 *
 * Version 1 is defined in index.js as "the schema as it stood on 2026-08-25" and
 * names no individual column, so every column and table that predates it can match
 * no version block. Without this list the check would report 31 findings on the day
 * it landed, and a gate that is red on day one is one somebody mutes in its first
 * week.
 *
 * EVERY ENTRY WAS DATED BEFORE IT WENT IN, off `git log -S "ADD COLUMN <c>"` and
 * `git log -S "CREATE TABLE IF NOT EXISTS <t>"`, rather than assumed from position
 * in the file. The newest is map_version.data_change_json (2026-08-12, PR #23); the
 * newest table is proposed_update (2026-07-24). Nothing added between 2026-08-25
 * and the first bump is being quietly excused — that would be the very defect this
 * file exists to find, wearing this list as cover.
 *
 * IT IS CHECKED IN BOTH DIRECTIONS BELOW. An entry naming a subject that no longer
 * exists is a finding, so the list cannot rot into coverage it does not have; and a
 * baselined subject that a version block ALSO names is a finding, so the list can
 * never be reached for to silence a real one.
 * ------------------------------------------------------------------------- */
const PRE_V1 = {
  columns: [
    'map.customer_id', 'map.outputs', 'map.request_note', 'map.requested_by',
    'application.reviewed_at', 'application.customer_id',
    'map.published_version_id', 'map_version.review_state',
    'customer.slug', 'customer.branding_json', 'map.public_listed', 'message.map_id',
    'customer.is_demo', 'customer.hide_operators_enabled', 'customer.watermark_enabled',
    'map.banner_note', 'map.banner_note_source', 'map.banner_note_set_at',
    'map_version.data_change_json',
  ],
  tables: [
    'application', 'message', 'customer', 'user', 'session', 'magic_link',
    'map', 'map_version', 'publish_request', 'proposed_update', 'audit_log',
    // Created inside migrate() itself, last, by the N13 change that introduced
    // the constant. It IS version 1 rather than something version 1 predates.
    'schema_version',
  ],
};
const baselined = new Set([...PRE_V1.columns, ...PRE_V1.tables]);

/* ---- the numbered history -------------------------------------------------- */

console.log('the numbered version blocks:');

/* Scoped to the docblock that ENDS at the declaration, not to the whole file.
 * index.js is 900 lines of commentary and several other comments contain a line
 * that starts with a digit and an equals sign. */
const decl = /^export const SCHEMA_VERSION = (\d+);$/m.exec(indexJs);
if (!decl) {
  console.error('  FAIL  no `export const SCHEMA_VERSION = <n>;` line in src/db/index.js');
  process.exit(1);
}
const declared = Number(decl[1]);
const docStart = indexJs.lastIndexOf('/**', decl.index);
const doc = docStart < 0 ? '' : indexJs.slice(docStart, decl.index);

/* Each `N = …` line in the docblock, with its continuation lines.
 *
 * `order` IS RETURNED SEPARATELY AND THAT IS NOT TIDINESS. The first draft asked
 * whether a number appeared twice by de-duplicating the Map's own keys, which are
 * unique by construction — so that assertion could not fail, and the harness said
 * so: renumbering block 3 to 4 went red on the GAP check instead, because the
 * second 4 had silently overwritten the first. A duplicate has to be counted where
 * it is read. */
function parseBlocks(text) {
  const blocks = new Map();
  const order = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*\*\s?/, '');
    const started = /^(\d+) = (.*)$/.exec(line);
    if (started) {
      current = Number(started[1]);
      order.push(current);
      blocks.set(current, started[2]);
    } else if (current !== null && line.trim() && !line.trim().startsWith('/')) {
      blocks.set(current, blocks.get(current) + ' ' + line.trim());
    }
  }
  return { blocks, order };
}
const { blocks, order } = parseBlocks(doc);
const numbers = [...blocks.keys()].sort((a, b) => a - b);

check(blocks.size > 0, 'the docblock above the constant carries numbered blocks',
  'found none — a block is a line of the form "N = what changed"');
if (blocks.size === 0) { console.error('\nNothing further can be asked.'); process.exit(1); }

check(order.length === new Set(order).size, 'no version number appears twice',
  `read in order: ${order.join(', ')} — a second block for a number REPLACES the first, `
  + 'so the migration the first one described is then described by nothing');
const gaps = [];
for (let n = 1; n <= numbers[numbers.length - 1]; n++) if (!blocks.has(n)) gaps.push(n);
check(gaps.length === 0, 'the blocks run 1..N with no gap', `missing: ${gaps.join(', ')}`);
check(declared === numbers[numbers.length - 1],
  `SCHEMA_VERSION (${declared}) equals the highest block (${numbers[numbers.length - 1]})`,
  'a bump with no block, or a block with no bump — either way the history and the constant disagree');

/* ---- what the migrations actually did --------------------------------------- */

console.log('\nevery migration subject is described by a block:');

/* Scoped to migrate()'s own body. An ALTER quoted in a comment elsewhere in the
 * file is prose about migrations, not a migration — index.js's own docblock
 * contains the string "ALTER TABLE ... ADD COLUMN", and an unscoped scan read it
 * as a subject called "...." the first time this was run. */
const migStart = indexJs.indexOf('(function migrate() {');
const migEnd = indexJs.indexOf('\n})();', migStart);
if (migStart < 0 || migEnd < 0) {
  console.error('  FAIL  could not find the `(function migrate() { … })();` body in src/db/index.js');
  process.exit(1);
}
const migrate = indexJs.slice(migStart, migEnd);

const subjects = [];
for (const m of migrate.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) {
  subjects.push({ kind: 'column', name: `${m[1]}.${m[2]}`, bare: m[2], where: 'migrate()' });
}
/* A NEW TABLE IS A MIGRATION HERE and is the shape versions 3 and 4 are made of.
 * schema.sql is CREATE TABLE IF NOT EXISTS throughout, so a new table needs no
 * ALTER and appears in migrate() only when it is created there (schema_version).
 * A check that read migrate() alone would be blind to the two most recent
 * migrations before the one that failed. */
for (const [text, where] of [[schemaSql, 'schema.sql'], [migrate, 'migrate()']]) {
  for (const m of text.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
    subjects.push({ kind: 'table', name: m[1], bare: m[1], where });
  }
}

check(subjects.length > 0, 'the migrations parse into subjects at all',
  'no ALTER and no CREATE TABLE found — the parse has gone stale, not the schema');

/* THE MATCH IS ON BACKTICKS, and the strictness is load-bearing rather than
 * fussy. `map` is a table name and the word "map" appears in the prose of nearly
 * every block, so a bare-word match would find it in a sentence about something
 * else and pass a genuinely undescribed table — a false PASS, which is the
 * direction that matters. Backticks also separate `search_demand` from
 * `search_demand_skipped`, which no substring test can do. The convention is one
 * the file already follows: name the column or table in backticks in its block.
 *
 * A COLUMN MUST BE QUALIFIED — `customer.is_sample`, never a bare `is_sample` —
 * AND THAT RULE WAS MEASURED RATHER THAN CHOSEN. The first draft accepted the
 * bare name as a fallback, and the "nothing is both baselined and described"
 * check below went red on its first run against the real tree: block 4 writes
 * "src/db/guards.js refuses an adviser a `customer_id`", which is prose about a
 * RULE, and it matched both map.customer_id and application.customer_id, two
 * columns from July that block 4 has nothing to do with. A bare column name is
 * ambiguous across tables by construction — four tables here have a `status`
 * column — so the loose form could only ever attribute a migration to the wrong
 * generation, or excuse one that no block describes. */
const namedBy = (subject) => {
  const form = `\`${subject.name}\``;
  for (const n of numbers) {
    if (blocks.get(n).includes(form)) return n;
  }
  return null;
};

const undescribed = [];
const doubleCounted = [];
for (const s of subjects) {
  const block = namedBy(s);
  if (baselined.has(s.name)) {
    if (block !== null) doubleCounted.push(`${s.name} (baselined, but block ${block} names it too)`);
    continue;
  }
  if (block === null) undescribed.push(`${s.name} (${s.kind}, ${s.where})`);
}

check(undescribed.length === 0,
  `all ${subjects.length} subject(s) are either baselined or named by a block`,
  `no version block names: ${undescribed.join(', ')}\n`
  + '          Add the migration to the block for the version that introduces it, in backticks,\n'
  + '          and bump SCHEMA_VERSION if this is a new generation. docs/DEPLOY.md says so too.');

check(doubleCounted.length === 0, 'nothing is both baselined and described',
  `${doubleCounted.join(', ')}\n`
  + '          Take it out of PRE_V1 — a subject a block describes is not pre-v1, and leaving it\n'
  + '          in the baseline means the baseline is what is passing it.');

/* ---- the baseline cannot rot ------------------------------------------------ */

console.log('\nthe declared baseline still describes real subjects:');
const present = new Set(subjects.map((s) => s.name));
const ghosts = [...baselined].filter((n) => !present.has(n));
check(ghosts.length === 0, `all ${baselined.size} PRE_V1 entries name a subject that still exists`,
  `gone from the schema: ${ghosts.join(', ')}\n`
  + '          Delete the entry. A stale baseline hides nothing and reads as coverage.');

/* ---- and the runbook still points here -------------------------------------- */

console.log('\nthe runbook and the check still know about each other:');
const deploy = readFileSync(path.join(ROOT, 'docs/DEPLOY.md'), 'utf8');
check(deploy.includes('Bump `SCHEMA_VERSION` in `src/db/index.js` when you add a migration'),
  'docs/DEPLOY.md still carries the instruction this check enforces',
  'the sentence has moved or been reworded — either update it here or say why the rule changed');
check(deploy.includes('test-schema-version.mjs'),
  'docs/DEPLOY.md names this check beside the instruction',
  'a runbook rule with no named enforcer reads as advice, which is what it was until OA-325');

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log(`SCHEMA_VERSION is ${declared}, ${numbers.length} block(s) describe the history, `
  + `and ${subjects.length} migration subject(s) are all accounted for.`);
