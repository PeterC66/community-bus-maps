// Backup the portal's state (P7 ops).
//
//   node scripts/backup.mjs [--out <dir>] [--keep 7] [--no-renders] [--quiet]
//
// Takes a CONSISTENT snapshot of everything that is not in git:
//
//   • the SQLite database, via `VACUUM INTO` — a single statement that writes a
//     clean copy of a committed state even while the server is running (WAL and
//     all). Copying portal.sqlite with `cp` while the server is up can capture a
//     torn database plus a stale -wal; this cannot.
//   • the object store: each map's `data/` (its payload + generators + expert
//     layout) and, unless --no-renders, its `renders/` (the print-ready
//     artefacts, including the bytes an approver signed off).
//
// Deliberately NOT backed up: `proposed/` (a staged monthly refresh — it can be
// re-staged centrally) and `archive/` (superseded data). They are the bulk, and
// nothing published depends on them.
//
// Backups land in `<DATA_DIR>/../backups/<timestamp>/` by default (outside
// DATA_DIR, so a backup never ends up inside the next backup) with a manifest,
// and older ones beyond --keep are removed. Restore instructions: docs/DEPLOY.md.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../src/db/index.js';
import { MAPS_DIR, mapDataDir, rendersDir } from '../src/maps/store.js';
import { dirSize } from '../src/ops/index.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);
const quiet = flag('quiet');
const say = (...a) => { if (!quiet) console.log(...a); };
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

const withRenders = !flag('no-renders');
const keep = Math.max(1, Number(arg('keep', 7)) || 7);
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

// 1) database — VACUUM INTO gives a consistent copy of a live DB.
const dbOut = path.join(dest, 'portal.sqlite');
{
  const src = new DatabaseSync(dbPath, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
  } finally { src.close(); }
  say(`· database  ${mb(statSync(dbOut).size)}`);
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
manifest.totalBytes = dirSize(dest);
writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 3) retention — keep the newest N backup folders.
const olds = readdirSync(outRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
  .map((e) => e.name)
  .sort()
  .reverse()
  .slice(keep);
for (const name of olds) {
  rmSync(path.join(outRoot, name), { recursive: true, force: true });
  say(`· pruned old backup ${name}`);
}

say(`\n✓ backup complete — ${copied} map(s), ${mb(manifest.totalBytes)} total, keeping ${keep}.`);
say('  Restore: stop the server, put portal.sqlite + maps/ back under DATA_DIR (see docs/DEPLOY.md).');
process.exit(0);
