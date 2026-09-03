#!/usr/bin/env node
// test-db-constraints.mjs — the two state enums are enforced by the database,
// and schema.sql's comments still say what the database does.
//
// WHY (codebase review 2026-09-01, portal-src F12). `schema.sql` had 15
// `REFERENCES`, 0 `CHECK` constraints and 0 indexes. `map.status` has six legal
// values and `map_version.review_state` five, and both lived ONLY as a `--`
// comment beside the column — enforced in whichever handler happened to write
// them. A handler writing 'Published' or 'pubished' would be accepted, would fail
// no test, and would take the map off the public site, because every public query
// filters on that exact string.
//
// THE HALF THAT IS EASY TO GET WRONG IS THE COMMENT. Moving a list out of a
// comment and into src/db/enums.js makes it a SECOND copy of the same list, and a
// second copy is an improvement only if something joins the two. So this asserts
// both directions: the trigger rejects what the list forbids and accepts
// everything it allows, AND schema.sql's `--` comment names exactly the values
// enums.js names. Without the second half, the review's finding would be back the
// first time somebody added a status — with the comment now further from the code
// than it was before.
//
// IT BUILDS ITS OWN DATABASE in a temp directory by importing src/db/index.js
// with DB_PATH pointed at it, which is what runs the migration. Nothing here
// touches the real store.
//
// Run from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:db-constraints

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENUMS, MAP_STATUSES, REVIEW_STATES, enumTriggerNames } from '../src/db/enums.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

console.log('test-db-constraints — the enums are the database\'s rule, not a comment\n');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-db-constraints-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
const { db } = await import(pathToFileURL(path.join(ROOT, 'src/db/index.js')).href);

// ---- the triggers exist ------------------------------------------------------
console.log('installed:');
const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((r) => r.name);
for (const name of enumTriggerNames()) {
  check(triggers.includes(name), `trigger ${name}`, `not in sqlite_master (found: ${triggers.join(', ') || 'none'})`);
}
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all().map((r) => r.name);
for (const name of ['idx_map_customer', 'idx_map_published']) {
  check(indexes.includes(name), `index ${name}`, `not in sqlite_master (found: ${indexes.join(', ') || 'none'})`);
}

// ---- the rule bites, in both directions --------------------------------------
// A guard is only worth having if it has been seen to refuse. And "accepts every
// legal value" is not padding: a trigger with a typo in its own list would pass
// the refusal test perfectly while quietly making a legal state unwritable.
const cust = db.prepare("INSERT INTO customer (name, type) VALUES ('T', 'other') RETURNING id").get().id;
const mk = (status) => db.prepare(
  "INSERT INTO map (customer_id, slug, name, status) VALUES (?, ?, 'T', ?) RETURNING id",
).get(cust, `s-${Math.random().toString(36).slice(2)}`, status).id;

console.log('\nmap.status:');
for (const v of MAP_STATUSES) {
  let ok = true, why = '';
  try { mk(v); } catch (e) { ok = false; why = e.message; }
  check(ok, `'${v}' is accepted`, why);
}
for (const v of ['Published', 'pubished', 'deleted', '', 'DRAFT']) {
  let refused = false, msg = '';
  try { mk(v); } catch (e) { refused = true; msg = e.message; }
  check(refused && /must be one of/.test(msg), `'${v}' is REFUSED on insert`,
    refused ? `refused, but not by the guard: ${msg}` : 'the database accepted it');
}
{
  const id = mk('draft');
  let refused = false;
  try { db.prepare('UPDATE map SET status = ? WHERE id = ?').run('nonsense', id); } catch { refused = true; }
  check(refused, 'and on UPDATE too', 'a bad value can still be written by an UPDATE — the insert trigger alone is half a guard');
}

console.log('\nmap_version.review_state:');
const mapId = mk('draft');
let n = 0;
const mkv = (state) => db.prepare(
  "INSERT INTO map_version (map_id, major, minor, storage_key, review_state) VALUES (?, ?, 0, 'v', ?) RETURNING id",
).get(mapId, ++n, state).id;
for (const v of REVIEW_STATES) {
  let ok = true, why = '';
  try { mkv(v); } catch (e) { ok = false; why = e.message; }
  check(ok, `'${v}' is accepted`, why);
}
for (const v of ['Draft', 'approved', 'live']) {
  let refused = false, msg = '';
  try { mkv(v); } catch (e) { refused = true; msg = e.message; }
  check(refused && /must be one of/.test(msg), `'${v}' is REFUSED`,
    refused ? `refused, but not by the guard: ${msg}` : 'the database accepted it');
}

// ---- the JOIN: schema.sql's comment against enums.js -------------------------
// The half the review's finding was actually about. A list that has moved out of
// a comment into code has not been made safer if the comment is still there and
// nothing compares them.
console.log('\nschema.sql still describes what the database enforces:');
const schema = readFileSync(path.join(ROOT, 'src/db/schema.sql'), 'utf8');

/* SCOPED TO THE TABLE'S OWN BLOCK, and the first draft was not — it searched the
 * whole file for a line starting with the column name and found `application.status`
 * when it wanted `map.status`. Four tables here have a `status` column. A check
 * that reads the wrong line is worse than no check: it reported a mismatch against
 * a list that was never claiming to be map's. */
function commentedValues(table, column) {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start < 0) return { error: `no CREATE TABLE for ${table}` };
  const end = schema.indexOf('\n);', start);
  const block = schema.slice(start, end < 0 ? undefined : end);
  const line = block.split('\n').find((l) => l.trimStart().startsWith(`${column} `) && l.includes('--'));
  if (!line) return { error: `no commented ${column} line inside ${table}` };
  const listed = (line.split('--')[1].match(/[a-z_]+(?:\|[a-z_]+)+/) || [''])[0].split('|').filter(Boolean);
  return { line: line.trim(), listed };
}

for (const [qualified, values] of Object.entries(ENUMS)) {
  const [table, column] = qualified.split('.');
  const got = commentedValues(table, column);
  if (got.error) { check(false, `${qualified} has a documented value list`, got.error); continue; }
  check(got.listed.length > 0, `${qualified}'s comment carries a pipe-separated list`, `read: ${got.line}`);
  check(got.listed.join(',') === values.join(','),
    `${qualified}: the comment and enums.js name the same values, in the same order`,
    `schema.sql says [${got.listed.join('|')}], enums.js says [${values.join('|')}]`);
}

/* Close before removing: the module opens the file in WAL mode and Windows will
 * not unlink a mapped file, so the first draft finished every check and then died
 * EPERM — a passing suite reporting a crash. */
try { db.close(); } catch { /* already closed */ }
try { rmSync(scratch, { recursive: true, force: true }); } catch { /* a leftover temp dir is not a test failure */ }
console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('Both enums are enforced by the database, and schema.sql still says so.');
