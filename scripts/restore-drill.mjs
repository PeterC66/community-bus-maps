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
//   --db-only    you copied ONLY manifest.json and the database off the host, not
//                the maps/ tree (which is most of a snapshot's half-gigabyte and
//                is not encrypted anyway). The maps check is then skipped OUT
//                LOUD, naming how many maps went unverified. Without this flag an
//                absent maps/ is a FAILURE, because the usual reason a folder is
//                missing is that something went wrong.
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
const DB_ONLY = argv.includes('--db-only');
const SNAPSHOT = arg('snapshot');
const IDENTITY = arg('identity');

if (!SNAPSHOT) {
  console.error('usage: node scripts/restore-drill.mjs --snapshot FOLDER [--identity KEYFILE] [--db-only] [--keep]');
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
    /* SAY WHAT IS WRONG, NOT WHAT WAS HOPED. The first version of this printed
     * `FAIL  the identity file is where you said — <path>`, which asserts the
     * positive and then prints the path, so it reads as though the file HAD been
     * found and something else had gone wrong. A wrong path is the likeliest
     * mistake here and it deserves a sentence that names it, plus the near misses,
     * because Notepad appends `.txt` and a key saved to Documents rather than the
     * home folder is the same typo twice over. */
    if (!existsSync(IDENTITY)) {
      console.log(`  FAIL  no identity file at ${IDENTITY}`);
      const dir = path.dirname(IDENTITY);
      const stem = path.basename(IDENTITY).replace(/\.[^.]*$/, '').toLowerCase().slice(0, 8);
      /* THE NAMED FOLDER AND ITS OBVIOUS SIBLINGS. Searching only the folder the
       * caller typed misses the mistake that actually happened on 2026-09-03: the
       * key was saved to Documents and the command named the home folder, so the
       * near-miss was one level sideways and the script had nothing to say. These
       * three are where a Save As dialog puts a file on this machine. */
      const look = [dir, path.join(dir, 'Documents'), path.join(dir, 'Downloads'), path.join(dir, 'Desktop')];
      const near = [];
      for (const d of look) {
        try {
          for (const f of readdirSync(d)) {
            if (f.toLowerCase().includes(stem)) near.push(path.join(d, f));
          }
        } catch { /* not a directory we can read; the next one may be */ }
      }
      if (near.length) {
        console.log('        did you mean one of these?');
        for (const f of near) console.log(`          ${f.replace(/\\/g, '/')}`);
      } else if (!existsSync(dir)) {
        console.log(`        (the folder ${dir} does not exist either)`);
      }
      console.log('        The private key lives in the password manager; write it to a file and pass that path.');
      process.exit(2);
    }
    check(true, 'the identity file is where you said');
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
  if (DB_ONLY) {
    // AN ANNOUNCED SKIP, NEVER AN INFERRED ONE. A snapshot's maps/ is most of its
    // half-gigabyte, so copying only the database off the host to drill the
    // DECRYPTION is a reasonable thing to do — but "the folder was absent so I
    // said nothing" is how a check quietly stops covering half its subject. The
    // caller has to ask for this, and the run says what it did not look at.
    console.log(`  skip  maps/ NOT checked — --db-only was given. The manifest lists `
      + `${(manifest.maps || []).length} map(s) and none of them was verified.`);
    console.log('        maps/ is published material and restores unencrypted; what this run drilled is the database.');
  } else if (!existsSync(mapsDir)) {
    check((manifest.maps || []).length === 0, 'maps/ is present',
      `the manifest lists ${(manifest.maps || []).length} map(s) and the folder is absent — `
      + 'if you copied only the database on purpose, say --db-only and the run will record that');
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
console.log(DB_ONLY
  ? 'This snapshot\'s DATABASE decrypts, opens, migrates and holds the data it should. maps/ was not checked.'
  : 'This snapshot decrypts, opens, migrates and holds the data it should.');
console.log('Record the date in docs/DEPLOY.md under "Restore drill" — an undated drill is a drill nobody can rely on.');
