// test-seed-demo.mjs — seed-demo.mjs's --dry-run writes no row in any table
// (buses-data OA-228, 2026-09-27).
//
//   node scripts/test-seed-demo.mjs        (or: npm run test:seed-demo)
//
// seed-demo.mjs creates users, customers, an application, a requested map and a
// piece of feedback, and runs import-map.mjs and propose-update.mjs as children.
// It now takes cli.mjs's confirm('remote'): the default is to do it, and
// --dry-run reports and writes nothing.
//
// THE PROPERTY IS "NO ROW IN ANY TABLE", NOT "EXIT 0". Every case counts the rows
// of every table in the database, after the script has run in a separate
// process, and compares them with the counts before. The real run is asserted
// alongside as the control: a script that never wrote at all would pass every
// dry-run case perfectly. Copies the shape of test-create-admin.mjs.
//
// The dry run is given a BUSES_DIR holding one empty render folder for March, so
// it reaches the import step and must say it WOULD import rather than run
// import-map.mjs; the real run is given an empty BUSES_DIR, so it imports
// nothing and needs no map data. Runs against a throwaway DATA_DIR; it never
// touches real portal data and needs no network.
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-demo.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-seed-demo-'));
const busesWithMarch = path.join(scratch, 'buses-march');
mkdirSync(path.join(busesWithMarch, 'Areas', 'March', 'S5-render', '2026-01-01_0000'), { recursive: true });
const busesEmpty = path.join(scratch, 'buses-empty');
mkdirSync(busesEmpty, { recursive: true });
const env = {
  ...process.env,
  DATA_DIR: path.join(scratch, 'data'),
  DB_PATH: path.join(scratch, 'portal.sqlite'),
  NODE_ENV: 'test',
  ADMIN_EMAIL: 'admin@example.test',
  APPROVER_EMAIL: 'approver@example.test',
};
for (const k of ['DATA_DIR', 'DB_PATH', 'NODE_ENV']) process.env[k] = env[k];

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const run = (busesDir, ...args) => spawnSync(process.execPath, [SCRIPT, ...args],
  { env: { ...env, BUSES_DIR: busesDir }, encoding: 'utf8' });

const { db } = await import('../src/db/index.js');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const counts = () => Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

try {
  console.log('seed-demo.mjs --dry-run');
  check('the database has tables to count', tables.includes('user') && tables.includes('customer'), tables.join(','));

  const before = counts();
  const dry = run(busesWithMarch, '--dry-run');
  check('--dry-run exits 0', dry.status === 0, dry.stderr);
  check('--dry-run says it would create the admin', /would create admin: admin@example\.test/.test(dry.stdout), dry.stdout);
  check('--dry-run says it would import March, not imports it',
    /would import March from 2026-01-01_0000/.test(dry.stdout) && !/importing March/.test(dry.stdout), dry.stdout);
  check('--dry-run says nothing was written', /dry run complete .* nothing written/.test(dry.stdout), dry.stdout);
  check('--dry-run writes no row in any table', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));

  const real = run(busesEmpty);
  check('without --dry-run it exits 0', real.status === 0, real.stderr);
  const after = counts();
  check('without --dry-run it writes users, customers, an application and a requested map',
    after.user >= 5 && after.customer === 3 && after.application === 1 && after.map === 1, JSON.stringify(after));

  const again = run(busesWithMarch, '--dry-run');
  check('--dry-run on a seeded store exits 0', again.status === 0, again.stderr);
  check('--dry-run on a seeded store reports existing users', /user exists: admin@example\.test/.test(again.stdout), again.stdout);
  check('--dry-run on a seeded store writes no row in any table', JSON.stringify(counts()) === JSON.stringify(after), JSON.stringify(counts()));
  check('the control run wrote something the dry runs did not', total(after) > total(before), `${total(before)} → ${total(after)}`);
} finally {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nall seed-demo checks passed.');
