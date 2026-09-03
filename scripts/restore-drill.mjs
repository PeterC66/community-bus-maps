#!/usr/bin/env node
// restore-drill.mjs — prove a backup snapshot can actually be restored, without
// touching the live site.
//
// WHY THIS EXISTS (codebase review 2026-09-01, portal-ops B1). `backup.mjs` is
// sound and the restore is documented in docs/DEPLOY.md. The restore was drilled
// for real once, on 2026-08-09 — BEFORE encryption existed. `BACKUP_RECIPIENT`
// was added on 2026-08-25, since when every snapshot's database is
// `portal.sqlite.age` and every restore begins with an `age -d` that has never
// been performed on a real snapshot. **An untried decryption is not a backup.**
// The failure mode is the worst available: it is discovered on the day the
// database is gone, and the answer arrives months after anything can be done
// about the key.
//
// WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT. It answers the only question
// the drill exists for — *does this snapshot become a working database?* — in a
// temporary directory:
//
//   1. reads the snapshot's manifest and says which key it was encrypted to;
//   2. decrypts `portal.sqlite.age` with the identity file you name;
//   3. runs `PRAGMA integrity_check` on the result;
//   4. OPENS IT WITH THE APP'S OWN `src/db/index.js`, which is what runs the
//      migrations — the step that turns "the file decrypted" into "this release
//      can serve it", and the one a `sqlite3 .tables` would not have asked;
//   5. counts the rows that would tell you a restore had silently produced an
//      empty database, and checks `maps/` against the manifest.
//
// It never stops a container, never writes to DATA_DIR, and never touches the
// live volume. THAT HALF STAYS A HUMAN OPERATION and stays in docs/DEPLOY.md: a
// script that can replace the live database is a script that can replace the live
// database by accident. What this removes is the *unknown* — after a green run,
// the remaining risk in a real restore is `docker compose stop` and `cp`.
//
// Run it from the repository root (`C:\Claude\community-bus-maps`):
//
//     node scripts/restore-drill.mjs --snapshot <folder> --identity <age key file>
//
//   --snapshot   a backup snapshot folder: the one holding manifest.json and
//                portal.sqlite (or portal.sqlite.age). Copy one down from the
//                host first — it is READ, never modified.
//   --identity   the age identity file holding the PRIVATE key, from the password
//                manager. Only needed when the snapshot's database is encrypted;
//                the file is read by `age`, never printed, never copied.
//   --keep       leave the decrypted copy for inspection instead of deleting it.
//                It is a full copy of the live database: delete it yourself.
//
// Exit 0 the snapshot restores, 1 it does not, 2 the arguments are wrong.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= argv.length || argv[i + 1].startsWith('--') ? null : argv[i + 1];
};
const KEEP = argv.includes('--keep');
const SNAPSHOT = arg('snapshot');
const IDENTITY = arg('identity');

if (!SNAPSHOT) {
  console.error('usage: node scripts/restore-drill.mjs --snapshot <folder> [--identity <age key file>] [--keep]');
  console.error('  run from the repository root; --snapshot is a backup folder holding manifest.json');
  process.exit(2);
}
if (!existsSync(path.join(SNAPSHOT, 'manifest.json'))) {
  console.error(`no manifest.json in ${SNAPSHOT} — that is not a backup snapshot folder`);
  process.exit(2);
}

let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

console.log(`restore-drill — ${SNAPSHOT}\n`);

// ---- 1. the manifest ---------------------------------------------------------
const manifest = JSON.parse(readFileSync(path.join(SNAPSHOT, 'manifest.json'), 'utf8'));
console.log(`taken ${manifest.at}, ${manifest.dbFile} (${manifest.dbBytes} bytes), `
  + `${(manifest.maps || []).length} map(s), ${manifest.totalBytes} bytes total`);
if (manifest.dbEncryptedTo) console.log(`encrypted to ${manifest.dbEncryptedTo}`);
else console.log('NOT ENCRYPTED — this snapshot predates BACKUP_RECIPIENT, or it was not set when it was taken');

const work = mkdtempSync(path.join(os.tmpdir(), 'cbm-restore-drill-'));
const restored = path.join(work, 'portal.sqlite');

try {
  // ---- 2. decrypt ------------------------------------------------------------
  console.log('\ndecrypting:');
  const encrypted = path.join(SNAPSHOT, 'portal.sqlite.age');
  if (existsSync(encrypted)) {
    if (!IDENTITY) {
      console.error('  FAIL  this snapshot is encrypted and no --identity was given.');
      console.error('        The private key lives in the password manager; write it to a file and pass it here.');
      process.exit(2);
    }
    check(existsSync(IDENTITY), 'the identity file is where you said', IDENTITY);
    if (!existsSync(IDENTITY)) process.exit(2);
    try {
      // `age` reads the key file itself: the private key never passes through
      // this process, is never printed, and is never written anywhere else.
      execFileSync('age', ['-d', '-i', IDENTITY, '-o', restored, encrypted], { stdio: ['ignore', 'pipe', 'pipe'] });
      check(true, 'age -d accepted the identity and wrote a database');
    } catch (e) {
      const why = (e.stderr && e.stderr.toString().trim()) || e.message;
      check(false, 'age -d accepted the identity', why);
      console.error('\n  THIS IS THE FAULT THE DRILL EXISTS FOR. The snapshot is unreadable with this key.');
      console.error(`  The manifest says it was encrypted to ${manifest.dbEncryptedTo || '(unrecorded)'};`);
      console.error('  check that the identity file holds the matching private key.');
      process.exit(1);
    }
  } else {
    const plain = path.join(SNAPSHOT, 'portal.sqlite');
    check(existsSync(plain), 'an unencrypted portal.sqlite is present', 'neither portal.sqlite nor portal.sqlite.age is in this folder');
    if (!existsSync(plain)) process.exit(1);
    execFileSync('node', ['-e', `require('node:fs').copyFileSync(${JSON.stringify(plain)}, ${JSON.stringify(restored)})`]);
    check(true, 'copied (nothing to decrypt)');
  }
  check(statSync(restored).size > 0, 'the restored file is not empty', 'zero bytes');

  // ---- 3. is it a sound SQLite file? -----------------------------------------
  console.log('\nthe file:');
  const { DatabaseSync } = await import('node:sqlite');
  {
    const probe = new DatabaseSync(restored, { readOnly: true });
    const integrity = probe.prepare('PRAGMA integrity_check').get();
    check(Object.values(integrity)[0] === 'ok', 'PRAGMA integrity_check', JSON.stringify(integrity));
    const fk = probe.prepare('PRAGMA foreign_key_check').all();
    check(fk.length === 0, 'PRAGMA foreign_key_check', `${fk.length} violation(s): ${JSON.stringify(fk.slice(0, 3))}`);
    probe.close();
  }

  // ---- 4. can THIS RELEASE serve it? -----------------------------------------
  // The step that makes this a restore drill rather than a file check. Importing
  // the db module runs every migration against the restored file, which is
  // exactly what would happen when the container came back up.
  console.log('\nthis release opening it (the migrations run here):');
  process.env.DATA_DIR = work;
  process.env.DB_PATH = restored;
  let db;
  try {
    ({ db } = await import(pathToFileURL(path.join(ROOT, 'src/db/index.js')).href));
    check(true, 'src/db/index.js opened it and ran its migrations');
  } catch (e) {
    check(false, 'src/db/index.js opened it and ran its migrations', e.message);
    process.exit(1);
  }

  console.log('\nwhat is in it:');
  // A restore that produced an EMPTY database passes every check above. These are
  // the counts that would say so — the point of a drill is to notice that here and
  // not on the day it matters.
  for (const [table, atLeast] of [['customer', 1], ['user', 1], ['map', 1], ['map_version', 1]]) {
    const c = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    check(c >= atLeast, `${table}: ${c} row(s)`, `only ${c} — a restore that silently produced an empty database looks exactly like this`);
  }
  const pub = db.prepare(
    `SELECT COUNT(*) AS c FROM map m JOIN customer c ON c.id = m.customer_id
      WHERE m.published_version_id IS NOT NULL AND m.public_listed = 1
        AND m.status <> 'archived' AND c.status = 'active'`,
  ).get().c;
  check(pub >= 1, `${pub} map(s) would be publicly visible`, 'none — the public site would come back empty');
  try { db.close(); } catch { /* already closed */ }

  // ---- 5. the maps folder ------------------------------------------------------
  console.log('\nthe published material (maps/ is not encrypted — it is public):');
  const mapsDir = path.join(SNAPSHOT, 'maps');
  if (!existsSync(mapsDir)) {
    check((manifest.maps || []).length === 0, 'maps/ is present', 'the manifest lists maps and the folder is absent');
  } else {
    const onDisk = readdirSync(mapsDir).filter((d) => statSync(path.join(mapsDir, d)).isDirectory());
    const listed = (manifest.maps || []).map((m) => String(m.id));
    const missing = listed.filter((id) => !onDisk.includes(id));
    check(missing.length === 0, `${onDisk.length} map folder(s), all ${listed.length} the manifest lists`,
      `the manifest lists ${missing.length} map(s) with no folder: ${missing.join(', ')}`);
  }
} finally {
  if (KEEP) {
    console.log(`\n(kept: ${work} — it holds a full copy of the live database. Delete it.)`);
  } else {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* WAL still mapped on Windows */ }
  }
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed — this snapshot does NOT restore. Fix it before you need it.`);
  process.exit(1);
}
console.log('This snapshot decrypts, opens, migrates and holds the data it should.');
console.log('Record the date in docs/DEPLOY.md under "Restore drill" — an undated drill is a drill nobody can rely on.');
