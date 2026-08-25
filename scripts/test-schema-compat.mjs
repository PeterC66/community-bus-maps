// test-schema-compat.mjs — does the CURRENT code open a database the PREVIOUS
// release built, and does the PREVIOUS release still open one built by this
// code? (technical-audit_2026-08-25 N13.)
//
//   node scripts/test-schema-compat.mjs      (or: npm run test:schema)
//
// WHY THIS EXISTS. `docs/DEPLOY.md` promises a rollback to the previous release
// and rests it on a property it states candidly and does not check:
//
//   "Schema changes here have been additive … and the older code's `SELECT *`
//    tolerates an unknown column … That is a property worth preserving
//    deliberately, not a coincidence to rely on blindly."
//
// Nothing enforced it. Migrations are ad-hoc `ALTER TABLE` calls inside an IIFE,
// and the promise depended on a discipline no gate could see. It became
// load-bearing on 2026-08-25, when N3 changed what the `session.token` column
// MEANS — the column keeps its name precisely so that a rollback degrades to
// "everyone signs in again" instead of throwing on every request. That reasoning
// deserves a test rather than a paragraph.
//
// HOW. `src/db/index.js` imports nothing but node builtins (`node:sqlite`,
// `node:crypto`, `node:fs`, `node:path`, `node:url`), so a copy of it from an
// older commit RUNS AS IS, with no install. The previous release is defined as
// the commit before HEAD's most recent change under `src/db/` — that is, the
// last schema the deployed system could roll back to. Both directions are then
// exercised in CHILD PROCESSES, because a module that builds its database at
// import time cannot be loaded twice in one process against two files.
//
// WHERE IT CANNOT RUN. A shallow clone has no history to read (CI checks out
// with `fetch-depth: 1`). That is reported as SKIPPED, by name, and is not a
// pass: the local run and the verify workflow both have full history.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// --- which two versions are we comparing? -----------------------------------
let refs;
try {
  const touching = git('log', '--format=%H', '-n', '5', '--', 'src/db/').split('\n').filter(Boolean);
  if (touching.length < 2) throw new Error(`only ${touching.length} commit(s) of src/db/ history available`);
  refs = { previous: touching[1], previousSubject: git('log', '-1', '--format=%s', touching[1]) };
} catch (e) {
  console.log('\n· SKIPPED — cannot see enough git history to find the previous schema.');
  console.log(`  (${e.message.split('\n')[0]})`);
  console.log('  This is what a shallow clone looks like. It is NOT a pass: nothing about');
  console.log('  cross-version compatibility was proved by this run.');
  process.exitCode = 0;
  process.exit(0);
}

console.log(`\ncomparing HEAD against ${refs.previous.slice(0, 7)} — "${refs.previousSubject}"`);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-schema-compat-'));
const oldRoot = path.join(scratch, 'old');
mkdirSync(path.join(oldRoot, 'src', 'db'), { recursive: true });
for (const f of ['src/db/index.js', 'src/db/schema.sql']) {
  writeFileSync(path.join(oldRoot, f), git('show', `${refs.previous}:${f}`) + '\n');
}

// The probe. One file, run twice, told by DB_MODULE_URL which release's db module
// to import - importing it is what runs that release's migrations against the
// database file. It takes the URL rather than a relative path because a relative
// import resolves against the PROBE's own folder, and the two probes do not live
// in the same place.
//
// IT BUILDS ITS INSERTS FROM THE SCHEMA IT FINDS, and both earlier drafts are
// the argument for that. The first called the exported helpers and died on
// insertVersion, whose SIGNATURE changed between the two releases - an API
// difference, not a schema one, and not what this gate is about. The second
// hard-coded column lists and died on a column that never existed. Reading
// PRAGMA table_info and filling whatever is NOT NULL with no default makes the
// probe describe the schema in front of it rather than the one I remembered.
//
// The session is the one deliberate exception: it goes through
// insertSession/getSession, because N3 changed what that column MEANS while
// keeping its name, so the round trip through the release's own accessors is
// exactly the property at issue.
const PROBE = `
const dbmod = await import(process.env.DB_MODULE_URL);
const { insertSession, getSession, db } = dbmod;

const mode = process.argv[2];            // 'seed' | 'read'
const out = { mode, ok: true };
const TABLES = ['customer', 'user', 'map', 'map_version', 'session'];

// Values we care about being able to read back afterwards; everything else is
// filled by type so the INSERT satisfies whatever this schema requires.
const WANTED = { 'map.slug': 'compat-town', 'map.name': 'Compat Town', 'map.kind': 'area',
                 'customer.name': 'Compat Ltd', 'user.email': 'a@b.invalid', 'user.role': 'admin' };

function seed(table, fks) {
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all();
  const names = [], values = [];
  for (const c of cols) {
    if (c.pk) continue;                                   // the rowid assigns itself
    const key = table + '.' + c.name;
    let v;
    if (Object.prototype.hasOwnProperty.call(WANTED, key)) v = WANTED[key];
    else if (Object.prototype.hasOwnProperty.call(fks, c.name)) v = fks[c.name];
    else if (c.notnull && c.dflt_value === null) v = /INT|REAL|NUM/i.test(c.type || '') ? 1 : 'x';
    else continue;                                        // nullable or defaulted: let the schema decide
    names.push(c.name); values.push(v);
  }
  const sql = 'INSERT INTO ' + table + ' (' + names.join(', ') + ') VALUES (' + names.map(() => '?').join(', ') + ')';
  return Number(db.prepare(sql).run(...values).lastInsertRowid);
}

if (mode === 'seed') {
  const cid = seed('customer', {});
  const uid = seed('user', { customer_id: cid });
  const mid = seed('map', { customer_id: cid, requested_by: uid });
  const vid = seed('map_version', { map_id: mid, created_by: uid });
  db.prepare('UPDATE map SET current_version_id = ? WHERE id = ?').run(vid, mid);
  insertSession('compat-token', uid, '2099-01-01 00:00:00');
  out.seeded = { cid, uid, mid, vid };
}

// Both modes read, because the point is that the OTHER release's rows are legible.
out.maps = db.prepare('SELECT slug FROM map ORDER BY id').all().map((r) => r.slug);
out.versions = db.prepare('SELECT COUNT(*) AS n FROM map_version').get().n;
out.users = db.prepare('SELECT COUNT(*) AS n FROM user').get().n;
// A SELECT * on every table the app reads. This is the exact property
// docs/DEPLOY.md rests the rollback on, so ask it directly rather than by proxy.
out.selectStar = {};
for (const t of TABLES) out.selectStar[t] = db.prepare('SELECT * FROM ' + t + ' LIMIT 1').all().length;
const sess = getSession('compat-token');
out.session = sess ? { email: sess.email || null } : null;
out.tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
// The generation stamp (N13). A release that predates it has neither the table
// nor the export, so both are asked for defensively - this probe runs against
// code that has never heard of either.
out.schemaVersion = typeof dbmod.recordedSchemaVersion === 'function' ? dbmod.recordedSchemaVersion() : 'no-such-export';
out.codeSchemaVersion = dbmod.SCHEMA_VERSION === undefined ? 'no-such-export' : dbmod.SCHEMA_VERSION;
if (mode === 'bump') {
  // Pretend a NEWER release has been here: the state a rollback leaves behind.
  db.prepare('UPDATE schema_version SET version = version + 1 WHERE id = 1').run();
  out.bumpedTo = dbmod.recordedSchemaVersion();
}
console.log('PROBE:' + JSON.stringify(out));
`;
const PROBE_FILE = path.join(scratch, 'compat-probe.mjs');
writeFileSync(PROBE_FILE, PROBE);

const NEW_DB = pathToFileURL(path.join(ROOT, 'src', 'db', 'index.js')).href;
const OLD_DB = pathToFileURL(path.join(oldRoot, 'src', 'db', 'index.js')).href;

function run(dbModuleUrl, mode, dataDir) {
  const r = execFileSync(process.execPath, [PROBE_FILE, mode], {
    cwd: scratch,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'portal.sqlite'), DB_MODULE_URL: dbModuleUrl },
  });
  const line = r.split('\n').find((l) => l.startsWith('PROBE:'));
  if (!line) throw new Error(`no probe output:\n${r}`);
  return JSON.parse(line.slice('PROBE:'.length));
}

try {
  // --- upgrade: yesterday's database, today's code ---------------------------
  console.log('\nupgrade — a database the PREVIOUS release built, opened by THIS code:');
  {
    const dir = path.join(scratch, 'upgrade');
    mkdirSync(dir, { recursive: true });
    const seeded = run(OLD_DB, 'seed', dir);
    check('the previous release builds and seeds its own database', seeded.ok === true && seeded.maps.includes('compat-town'), JSON.stringify(seeded).slice(0, 200));

    let read;
    try { read = run(NEW_DB, 'read', dir); } catch (e) {
      check('the current code opens it without throwing', false, String(e.message).split('\n').slice(0, 3).join(' | '));
    }
    if (read) {
      check('the current code opens it without throwing', true);
      check('…and can still read the rows', read.maps.includes('compat-town'), JSON.stringify(read.maps));
      check('…and every table it reads still answers SELECT *', Object.values(read.selectStar).every((n) => n === 1), JSON.stringify(read.selectStar));
      // The N3 migration is the one that had to compute new values from old ones.
      check('a session written before the token migration still signs in', read.session !== null, JSON.stringify(read.session));
    }
  }

  // --- rollback: today's database, yesterday's code --------------------------
  console.log('\nrollback — a database THIS code built, opened by the PREVIOUS release:');
  {
    const dir = path.join(scratch, 'rollback');
    mkdirSync(dir, { recursive: true });
    const seeded = run(NEW_DB, 'seed', dir);
    check('the current code builds and seeds its own database', seeded.ok === true && seeded.maps.includes('compat-town'), JSON.stringify(seeded).slice(0, 200));

    let read;
    try { read = run(OLD_DB, 'read', dir); } catch (e) {
      check('the PREVIOUS release opens it without throwing — this is the rollback promise', false,
        String(e.message).split('\n').slice(0, 4).join(' | '));
    }
    if (read) {
      check('the PREVIOUS release opens it without throwing — this is the rollback promise', true);
      check('…and can still read the rows', read.maps.includes('compat-town'), JSON.stringify(read.maps));
      check('…and every table it reads still answers SELECT * — the exact DEPLOY.md property', Object.values(read.selectStar).every((n) => n === 1), JSON.stringify(read.selectStar));
      check('…and no table it expects has gone missing', ['customer', 'user', 'map', 'map_version', 'session'].every((t) => read.tables.includes(t)), JSON.stringify(read.tables));
      // The DOCUMENTED degradation, asserted so it stays a degradation and never
      // becomes a crash: after N3 the stored token is a hash, so the old code's
      // raw comparison matches nothing and everybody signs in again.
      console.log(`  · note: the old release ${read.session ? 'DID' : 'did not'} match the session — either is fine here,`);
      console.log('    what must not happen is a throw. See docs/DEPLOY.md §rollback.');
    }
  }
  // --- the generation stamp, and the warning that is the rollback's only tell ---
  console.log('\nthe schema_version stamp:');
  {
    const dir = path.join(scratch, 'stamp');
    mkdirSync(dir, { recursive: true });
    const seeded = run(NEW_DB, 'seed', dir);
    check('a database this code builds records its schema generation',
      Number.isInteger(seeded.schemaVersion) && seeded.schemaVersion === seeded.codeSchemaVersion,
      JSON.stringify({ recorded: seeded.schemaVersion, code: seeded.codeSchemaVersion }));

    const old = run(OLD_DB, 'read', dir);
    check('the PREVIOUS release ignores the table it has never heard of',
      old.tables.includes('schema_version') && old.schemaVersion === 'no-such-export',
      JSON.stringify({ sawTable: old.tables.includes('schema_version'), export: old.schemaVersion }));

    // Now make the database claim a NEWER generation than the code, which is
    // exactly what a rollback leaves behind, and check that the app WARNS and
    // still boots. A refusal here would turn a rollback into an outage.
    run(NEW_DB, 'bump', dir);
    const after = execFileSync(process.execPath, [PROBE_FILE, 'read'], {
      cwd: scratch, encoding: 'utf8',
      env: { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'portal.sqlite'), DB_MODULE_URL: NEW_DB },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    check('reading a NEWER database still boots', after.includes('PROBE:'), after.slice(0, 200));
    // console.warn goes to STDERR, which execFileSync's return value does not
    // carry - the first version of this assertion searched stdout and reported a
    // warning that was being printed perfectly well as missing.
    const warn = spawnSync(process.execPath, ['-e', 'await import(process.env.DB_MODULE_URL);'], {
      cwd: scratch, encoding: 'utf8',
      env: { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'portal.sqlite'), DB_MODULE_URL: NEW_DB },
    });
    const said = `${warn.stdout || ''}${warn.stderr || ''}`;
    check('…and says so, rather than passing over it in silence',
      /was last written by schema v/.test(said), said.split('\n').filter((l) => !/Warning|Reparsing|eliminate|trace-warnings/.test(l)).join(' ').slice(0, 200) || '(said nothing)');
  }

} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n✗ ${failures} schema-compatibility check(s) failed`);
  console.error('  A migration that breaks either direction breaks the rollback promise in docs/DEPLOY.md.');
  console.error('  Fix the migration to be additive, or change the promise deliberately and say so there.');
  process.exitCode = 1;
} else {
  console.log('\n✓ both directions open cleanly — the rollback promise holds for this pair');
}
