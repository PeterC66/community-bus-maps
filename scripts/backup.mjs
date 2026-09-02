// Backup the portal's state (P7 ops).
//
//   node scripts/backup.mjs [--out <dir>] [--keep-days 14] [--keep 7]
//                           [--keep-recent-hours 48] [--no-renders] [--quiet]
//
// Takes a CONSISTENT snapshot of everything that is not in git:
//
//   • the SQLite database, via `VACUUM INTO` — a single statement that writes a
//     clean copy of a committed state even while the server is running (WAL and
//     all). Copying portal.sqlite with `cp` while the server is up can capture a
//     torn database plus a stale -wal; this cannot.
//   • the object store: each map's `data/` (its payload + generators + expert
//     layout) and, unless --no-renders, its `renders/` (the print-ready
//     artefacts, including the bytes an approver reviewed).
//
// Deliberately NOT backed up: `proposed/` (a staged monthly refresh — it can be
// re-staged centrally) and `archive/` (superseded data). They are the bulk, and
// nothing published depends on them.
//
// Backups land in `<DATA_DIR>/../backups/<timestamp>/` by default (outside
// DATA_DIR, so a backup never ends up inside the next backup) with a manifest,
// and older ones are removed on the rule in src/ops/backup-retention.js — by
// AGE (--keep-days), thinned to one a day beyond --keep-recent-hours, with the
// newest --keep kept whatever happens. Restore instructions: docs/DEPLOY.md.
//
// Set BACKUP_RECIPIENT to an age public key and the database copy is written
// encrypted, as portal.sqlite.age — see the block above the encryption function
// below for what that covers and why the key is asymmetric.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../src/db/index.js';
import { MAPS_DIR, mapDataDir, rendersDir } from '../src/maps/store.js';
import { dirSize } from '../src/ops/index.js';
import { planRetention } from '../src/ops/backup-retention.js';
import { arg, has as flag } from './lib/cli.mjs';

const quiet = flag('quiet');
const say = (...a) => { if (!quiet) console.log(...a); };
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

const withRenders = !flag('no-renders');
// --keep is now the FLOOR (newest N kept whatever their age), not the whole
// rule; --keep-days is the window. src/ops/backup-retention.js says why.
// A bad number falls back to the default rather than to NaN — NaN would sail
// through Math.max and make every comparison in the retention plan false, which
// is the quiet way to delete everything.
const num = (name, def) => { const v = Number(arg(name, def)); return Number.isFinite(v) ? v : def; };
const keep = Math.max(1, num('keep', 7));
const keepDays = Math.max(1, num('keep-days', 14));
const keepRecentHours = Math.max(0, num('keep-recent-hours', 48));
const outRoot = path.resolve(arg('out', path.join(DATA_DIR, '..', 'backups')));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(outRoot, stamp);

const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'portal.sqlite');
if (!existsSync(dbPath)) {
  console.error(`✗ no database at ${dbPath} — nothing to back up.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
say(`Backing up → ${dest}`);

// ---------------------------------------------------------------------------
// Encryption at rest (technical-audit_2026-08-25 N3).
//
// WHAT IS ENCRYPTED, AND WHAT DELIBERATELY IS NOT. Only `portal.sqlite`. That
// file is the whole of the finding: it holds `application` and `message` — names,
// email addresses, phone numbers and free text submitted through public forms —
// and, until the other half of the same finding, a live session cookie for every
// signed-in user. The `maps/` tree beside it is published sheets and their
// generators: material anyone can fetch from busmaps.uk. Encrypting that too
// would add nothing and would make the restore drill in docs/DEPLOY.md §5
// harder, which is a real cost paid at the worst possible moment.
//
// THE KEY MODEL IS ASYMMETRIC ON PURPOSE. BACKUP_RECIPIENT holds an age PUBLIC
// key, so the VPS writes a backup that nobody on the VPS can read; the private
// key lives on the laptop and in a password manager and never touches the
// server. A symmetric passphrase would have to sit on the box it is protecting
// against, which is most of the way back to no encryption at all.
//
// UNSET MEANS PLAINTEXT, LOUDLY. With no BACKUP_RECIPIENT this behaves exactly
// as before — the backup still runs and still succeeds, because a box that stops
// taking backups over a missing key is worse off than one taking readable ones.
// It warns on every run, and `manifest.dbEncryptedTo: null` records the fact for
// whoever reads the folder later.
const RECIPIENT = (process.env.BACKUP_RECIPIENT || '').trim();
const AGE_BIN = process.env.AGE_BIN || 'age';

function encryptDatabase(plainPath) {
  if (!RECIPIENT) {
    console.warn("! BACKUP_RECIPIENT is not set — this backup's database is UNENCRYPTED (technical-audit_2026-08-25 N3).");
    return null;
  }
  if (!/^age1[0-9a-z]{20,}$/.test(RECIPIENT)) {
    console.error(`✗ BACKUP_RECIPIENT does not look like an age public key ("${RECIPIENT.slice(0, 12)}…").`);
    process.exit(1);
  }
  const encPath = plainPath + '.age';
  const r = spawnSync(AGE_BIN, ['-r', RECIPIENT, '-o', encPath, plainPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.error || r.status !== 0) {
    // Exit rather than fall back to plaintext. A key was configured, so somebody
    // is relying on this; quietly writing the readable copy they asked not to
    // have is the one outcome worse than no backup at all.
    console.error(`✗ age failed (${r.error ? r.error.message : `exit ${r.status}`}): ${String(r.stderr || '').trim()}`);
    console.error('  Fix age or unset BACKUP_RECIPIENT, then run again.');
    rmSync(plainPath, { force: true });
    rmSync(encPath, { force: true });
    process.exit(1);
  }
  // Read the artefact back before deleting the only readable copy. An `age` that
  // exits 0 having written nothing would otherwise destroy the very backup this
  // function exists to protect — check the file, not the exit code.
  if (!existsSync(encPath) || statSync(encPath).size < 100) {
    console.error('✗ age reported success but produced no usable file — keeping the plaintext copy and stopping.');
    process.exit(1);
  }
  rmSync(plainPath, { force: true });
  return encPath;
}

// 1) database — VACUUM INTO gives a consistent copy of a live DB.
let dbOut = path.join(dest, 'portal.sqlite');
{
  const src = new DatabaseSync(dbPath, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
  } finally { src.close(); }
  say(`· database  ${mb(statSync(dbOut).size)}`);
  const enc = encryptDatabase(dbOut);
  if (enc) { dbOut = enc; say(`· encrypted  ${path.basename(enc)}  (${mb(statSync(enc).size)}, recipient ${RECIPIENT})`); }
}

// 2) object store — per map: data/ (+ renders/ unless --no-renders)
const manifest = { at: new Date().toISOString(), source: DATA_DIR, withRenders, maps: [] };
let copied = 0;
if (existsSync(MAPS_DIR)) {
  for (const entry of readdirSync(MAPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const mapDest = path.join(dest, 'maps', id);
    const parts = [];
    for (const [name, from] of [['data', mapDataDir(id)], ['renders', rendersDir(id)]]) {
      if (name === 'renders' && !withRenders) continue;
      if (!existsSync(from)) continue;
      cpSync(from, path.join(mapDest, name), { recursive: true });
      parts.push(name);
    }
    // overrides.json sits above data/ and IS the customer's canonical edit set.
    const ov = path.join(MAPS_DIR, id, 'overrides.json');
    if (existsSync(ov)) { cpSync(ov, path.join(mapDest, 'overrides.json')); parts.push('overrides.json'); }
    if (!parts.length) continue;
    const bytes = dirSize(mapDest);
    manifest.maps.push({ id: Number(id), parts, bytes });
    copied++;
    say(`· map ${id}    ${mb(bytes)}  (${parts.join(', ')})`);
  }
}

manifest.dbBytes = statSync(dbOut).size;
manifest.dbFile = path.basename(dbOut);
// The RECIPIENT is a public key and belongs in the manifest: a person holding
// this folder in two years needs to know which private key opens it, and the
// alternative is guessing. Absent means the copy is plaintext.
manifest.dbEncryptedTo = RECIPIENT || null;
manifest.totalBytes = dirSize(dest);
writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 3) retention — by AGE, with a floor. See src/ops/backup-retention.js for why
// this stopped being "keep the newest N folders" on 2026-08-28.
const { keep: kept, prune } = planRetention(
  readdirSync(outRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
  { now: new Date(), keepDays, keepAll: keep, keepRecentHours },
);
for (const name of prune) {
  rmSync(path.join(outRoot, name), { recursive: true, force: true });
  say(`· pruned old backup ${name}`);
}

say(`\n✓ backup complete — ${copied} map(s), ${mb(manifest.totalBytes)} total, keeping ${kept.length} snapshot(s) over ${keepDays} days.`);
say(RECIPIENT
  ? '  Restore: age -d -i <your-key.txt> -o portal.sqlite portal.sqlite.age, then put it + maps/ back under DATA_DIR (docs/DEPLOY.md §5).'
  : '  Restore: stop the server, put portal.sqlite + maps/ back under DATA_DIR (see docs/DEPLOY.md).');
process.exit(0);
