// test-build-place-index.mjs — build-place-index.mjs's --dry-run writes no
// places.json sidecar (buses-data OA-228, 2026-09-26).
//
//   node scripts/test-build-place-index.mjs        (or: npm run test:build-place-index)
//
// build-place-index.mjs writes a sidecar into every published version's folder
// in the live store. It now takes cli.mjs's confirm('remote'): the default is to
// do it, and --dry-run reports and writes nothing.
//
// THE PROPERTY IS "NO FILE", NOT "EXIT 0". A dry run that printed "would index"
// and then wrote anyway would exit 0 with the right words, so every case here
// looks for the sidecar on disk after the script has run. The real run is
// asserted alongside as the control: a script that never wrote at all would
// pass every dry-run case perfectly.
//
// Seeds one published map into a throwaway DATA_DIR and runs the script as a
// child process against it; it never touches real portal data and needs no
// network. Copies the shape of test-create-admin.mjs.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-place-index.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-build-place-index-'));
const env = {
  ...process.env,
  DATA_DIR: scratch,
  DB_PATH: path.join(scratch, 'portal.sqlite'),
  NODE_ENV: 'test',
};
process.env.DATA_DIR = env.DATA_DIR;
process.env.DB_PATH = env.DB_PATH;
process.env.NODE_ENV = 'test';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });

const { db, insertMap, insertVersion, setPublishedVersion } = await import('../src/db/index.js');
const { versionDir } = await import('../src/maps/store.js');

try {
  const mapId = insertMap({ slug: 'testtown', name: 'Testtown', kind: 'area', subject: 'Testtown', status: 'published' });
  const versionId = insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0' });
  setPublishedVersion(mapId, versionId);
  const sidecar = path.join(versionDir(mapId, 'v1.0'), 'places.json');

  console.log('build-place-index.mjs --dry-run');

  const dry = run('--dry-run');
  check('--dry-run exits 0', dry.status === 0, dry.stderr);
  check('--dry-run names the version it would index', /would index testtown \(v1\.0\)/.test(dry.stdout), dry.stdout);
  check('--dry-run says it wrote nothing', /would be indexed — --dry-run, nothing written/.test(dry.stdout), dry.stdout);
  check('--dry-run writes no sidecar', !existsSync(sidecar), sidecar);

  const real = run();
  check('without --dry-run it exits 0', real.status === 0, real.stderr);
  check('without --dry-run it says it indexed the version', /1 published version\(s\) indexed\./.test(real.stdout), real.stdout);
  check('without --dry-run the sidecar is written', existsSync(sidecar), sidecar);

  rmSync(sidecar);
  const again = run('--dry-run');
  check('a second --dry-run still writes nothing', again.status === 0 && !existsSync(sidecar), again.stderr);
} finally {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nall build-place-index checks passed.');
