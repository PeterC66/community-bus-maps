#!/usr/bin/env node
// DELETING A MAP HANDLES EVERY TABLE THAT POINTS AT ONE.
//
//   node scripts/test-delete-map.mjs        (or: npm run test:delete-map)
//
// WHY IT EXISTS. `scripts/delete-map.mjs` names the tables it clears one by one,
// in a list a human typed in August. `map_adviser_grant` was added three weeks
// later for the local adviser's seat (buses-data OA-154 D1) with
// `map_id INTEGER NOT NULL REFERENCES map(id)`, and `PRAGMA foreign_keys = ON`
// has been set since before either — so from the day the grant table landed,
// deleting a map that had an adviser threw a bare SQLite constraint error and
// rolled the whole thing back. Nothing said so. The script was green, the schema
// was right, and the JOIN between them existed only in somebody's memory.
//
// It was found by reasoning about a handover rather than by any check, which is
// the part worth fixing: a hand-kept list of tables is a claim that nothing
// re-derives, and the next table to reference map(id) will be added by somebody
// who has never read this script.
//
// SO THE POPULATION IS THE SCHEMA, NOT A LIST. Section 1 parses
// `src/db/schema.sql` for every column declaring `REFERENCES map(id)` and
// requires delete-map.mjs to name that table. A new one fails here on the day it
// is written. Two tables carry a `map_id` with NO foreign key — `message` and
// `audit_log` — and both are deliberate: their rows outlive the map on purpose.
// Section 2 pins that deliberateness, so nobody "tidies up" a constraint onto
// them without meeting this file.
//
// Section 3 then actually DOES it, against a throwaway database: a map with a
// live adviser grant, a revoked one, a version, a publish request and a feedback
// message is deleted, and every consequence is asserted — the grants gone, the
// message kept but detached, the audit row naming the advisers who lost access.
// That is the case that used to throw.

import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

// The tree to read. A directory rather than a constant so prove-red can point
// the whole file at a mutated copy without touching the real one.
const TREE = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
const schema = readFileSync(path.join(TREE, 'src', 'db', 'schema.sql'), 'utf8');
const source = readFileSync(path.join(TREE, 'scripts', 'delete-map.mjs'), 'utf8');
// The script under test lives in TREE too, not beside this file: section 3 has
// to RUN the same copy section 1 READ, or a falsification harness could mutate
// the source and still watch the shipped script pass.
const SCRIPT = path.join(TREE, 'scripts', 'delete-map.mjs');

/**
 * Every table whose schema declares a column REFERENCING map(id), read off the
 * CREATE TABLE statements rather than listed here.
 */
function tablesReferencingMap(sql) {
  const out = [];
  for (const block of sql.split(/CREATE TABLE IF NOT EXISTS\s+/i).slice(1)) {
    const name = (block.match(/^(\w+)/) || [])[1];
    if (!name || name === 'map') continue;              // the map itself is the subject
    if (/REFERENCES\s+map\s*\(\s*id\s*\)/i.test(block)) out.push(name);
  }
  return out;
}

/** Tables carrying a `map_id` column but declaring no foreign key on it. */
function tablesWithLooseMapId(sql) {
  const out = [];
  for (const block of sql.split(/CREATE TABLE IF NOT EXISTS\s+/i).slice(1)) {
    const name = (block.match(/^(\w+)/) || [])[1];
    if (!name || name === 'map') continue;
    const line = block.split('\n').find((l) => /^\s*map_id\b/.test(l));
    if (line && !/REFERENCES/i.test(line)) out.push(name);
  }
  return out;
}

console.log('1  every table with a foreign key to map(id) is handled');

const constrained = tablesReferencingMap(schema);
check('the schema declares at least three of them', constrained.length >= 3, `found ${constrained.length}: ${constrained.join(', ')}`);
// Foreign keys are enforced, which is what turns "unhandled" into "the delete
// fails" rather than "a row dangles". If this is ever switched off, the rest of
// this section is about a different world.
check('foreign keys are enforced on the connection', /PRAGMA foreign_keys = ON/.test(readFileSync(path.join(TREE, 'src', 'db', 'index.js'), 'utf8')));
for (const t of constrained) {
  check(`delete-map.mjs clears ${t}`, new RegExp(`DELETE FROM ${t}\\b`).test(source),
    'a NOT NULL foreign key to map(id) that nothing clears makes the whole delete roll back');
}

console.log('');
console.log('2  and the two that deliberately outlive the map still do');

const loose = tablesWithLooseMapId(schema);
for (const t of ['message', 'audit_log']) {
  check(`${t}.map_id still declares no foreign key`, loose.includes(t),
    'adding one would make delete-map fail or would delete rows that are not the map\'s to take');
}
check('delete-map.mjs detaches message rather than deleting them', /UPDATE message SET map_id = NULL/.test(source));
check('and never deletes from audit_log', !/DELETE FROM audit_log/.test(source));

console.log('');
console.log('3  a map with a live adviser grant actually deletes');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-delmap-'));
const env = {
  ...process.env,
  DATA_DIR: scratch,
  DB_PATH: path.join(scratch, 'portal.sqlite'),
  NODE_ENV: 'test',
};

// Seed through the real db module, in a child process, so this file never opens
// the database the script under test is about to write to.
const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const db = await import(${JSON.stringify(new URL('../src/db/index.js', import.meta.url).href)});
  const cust = db.insertCustomer({ name: 'Test Council', type: 'council' });
  const mapId = db.insertMap({ customer_id: cust, slug: 'testville', name: 'Testville', kind: 'area', data_dir: '', status: 'draft' });
  const vid = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
  db.setCurrentVersion(mapId, vid);
  const live = db.insertUser({ email: 'adviser@example.test', name: 'A Adviser', role: 'adviser' });
  const gone = db.insertUser({ email: 'former@example.test', name: 'Former Adviser', role: 'adviser' });
  db.grantAdviser({ mapId, userId: live, note: 'knows the bus routes' });
  db.grantAdviser({ mapId, userId: gone, note: 'moved away' });
  db.revokeAdviserGrant(mapId, gone);
  db.insertMessage({ kind: 'feedback', name: 'A Reader', email: '', body: 'the 55 is wrong', map_id: mapId });
  console.log(JSON.stringify({ mapId }));
`], { cwd: ROOT, env, encoding: 'utf8' });

if (seed.status !== 0) {
  check('the fixture seeds', false, (seed.stderr || '').split('\n').slice(0, 4).join(' | '));
} else {
  const { mapId } = JSON.parse(seed.stdout.trim().split('\n').pop());

  const dry = spawnSync(process.execPath, [SCRIPT, '--map', String(mapId)], { cwd: ROOT, env, encoding: 'utf8' });
  const dryOut = (dry.stdout || '') + (dry.stderr || '');
  check('the dry run exits 0', dry.status === 0, `exit ${dry.status}`);
  check('the dry run NAMES the live adviser', /adviser@example\.test/.test(dryOut),
    'the dry run is where an operator is supposed to find out');
  check('and does not name the revoked one', !/former@example\.test/.test(dryOut),
    'a revoked grant has no access to lose and is noise here');
  check('and says how many grants there are', /adviser grants: 2/.test(dryOut));

  const run = spawnSync(process.execPath, [SCRIPT, '--map', String(mapId), '--yes'], { cwd: ROOT, env, encoding: 'utf8' });
  const runOut = (run.stdout || '') + (run.stderr || '');
  // THE ASSERTION THIS WHOLE FILE EXISTS FOR. Before the fix this exited
  // non-zero with "FOREIGN KEY constraint failed" and deleted nothing.
  check('the delete SUCCEEDS with a live grant', run.status === 0,
    `exit ${run.status}: ${runOut.split('\n').filter((l) => l.trim()).slice(-3).join(' | ')}`);
  check('and reminds you to re-grant', /re-grant after the import/i.test(runOut));

  const after = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const db = await import(${JSON.stringify(new URL('../src/db/index.js', import.meta.url).href)});
    const q = (sql, ...a) => db.db.prepare(sql).get(...a);
    console.log(JSON.stringify({
      map: q('SELECT COUNT(*) AS n FROM map WHERE id = ?', ${mapId}).n,
      versions: q('SELECT COUNT(*) AS n FROM map_version WHERE map_id = ?', ${mapId}).n,
      grants: q('SELECT COUNT(*) AS n FROM map_adviser_grant WHERE map_id = ?', ${mapId}).n,
      messages: q('SELECT COUNT(*) AS n FROM message').n,
      detached: q('SELECT COUNT(*) AS n FROM message WHERE map_id IS NULL').n,
      audit: q("SELECT detail_json AS d FROM audit_log WHERE action = 'map.delete'").d,
    }));
  `], { cwd: ROOT, env, encoding: 'utf8' });

  if (after.status !== 0) {
    check('the state can be read back', false, (after.stderr || '').split('\n').slice(0, 3).join(' | '));
  } else {
    const st = JSON.parse(after.stdout.trim().split('\n').pop());
    check('the map row is gone', st.map === 0);
    check('its versions are gone', st.versions === 0);
    check('BOTH grants are gone, revoked included', st.grants === 0,
      'a revoked grant keeps its row, so it violates the constraint just as a live one does');
    check('the feedback survives', st.messages === 1, 'it was never the map\'s to take with it');
    check('and is detached rather than dangling', st.detached === 1);
    const detail = JSON.parse(st.audit || '{}');
    check('the audit row counts the grants', detail.grantCount === 2, `got ${detail.grantCount}`);
    check('and names the adviser who lost access', (detail.advisersDropped || []).some((a) => a.email === 'adviser@example.test'),
      'the console scrolls away; the append-only log is what is left');
  }
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Deleting a map handles every table that points at one.');
