// test-create-admin.mjs — create-admin.mjs's --dry-run writes no user row
// (buses-data OA-228, 2026-09-25).
//
//   node scripts/test-create-admin.mjs        (or: npm run test:create-admin)
//
// create-admin.mjs writes to the live store, and until this change it had no way
// to say what it would do first. It now takes cli.mjs's confirm('remote'): the
// default is to do it, and --dry-run reports and writes nothing.
//
// THE PROPERTY IS "NO ROW", NOT "EXIT 0". A dry run that printed "would create"
// and then inserted anyway would exit 0 with the right words, so every case here
// reads the user table back after the script has run, in a separate process from
// the one that wrote it. The real run is asserted alongside as the control: a
// script that never wrote at all would pass every dry-run case perfectly.
//
// Runs the script as a child process against a throwaway DATA_DIR; it never
// touches real portal data and needs no network.
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'create-admin.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-create-admin-'));
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

const { db } = await import('../src/db/index.js');
const users = () => db.prepare('SELECT email, role FROM user ORDER BY email').all();

try {
  console.log('create-admin.mjs --dry-run');

  const dry = run('--email', 'first@example.test', '--name', 'First Admin', '--dry-run');
  check('--dry-run exits 0', dry.status === 0, dry.stderr);
  check('--dry-run says what it would do', /would create admin: first@example\.test/.test(dry.stdout), dry.stdout);
  check('--dry-run writes no user row', users().length === 0, JSON.stringify(users()));

  const real = run('--email', 'first@example.test', '--name', 'First Admin');
  check('without --dry-run it exits 0', real.status === 0, real.stderr);
  check('without --dry-run it says it created the admin', /created admin: first@example\.test/.test(real.stdout), real.stdout);
  const after = users();
  check('without --dry-run exactly one admin row is written',
    after.length === 1 && after[0].email === 'first@example.test' && after[0].role === 'admin', JSON.stringify(after));

  const again = run('--email', 'first@example.test', '--dry-run');
  check('--dry-run on an existing user reports it', /already exists: first@example\.test/.test(again.stdout), again.stdout);
  check('--dry-run on an existing user writes nothing', users().length === 1, JSON.stringify(users()));

  const second = run('--email', 'second@example.test', '--dry-run');
  check('a second --dry-run still writes nothing', users().length === 1 && second.status === 0, JSON.stringify(users()));

  const noEmail = run('--dry-run');
  check('no --email is a usage error (exit 2)', noEmail.status === 2, `status ${noEmail.status}`);
  check('no --email writes nothing', users().length === 1, JSON.stringify(users()));
} finally {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nall create-admin checks passed.');
