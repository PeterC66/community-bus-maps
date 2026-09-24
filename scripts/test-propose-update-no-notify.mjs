// `propose-update.mjs --no-notify` stages the update and tells nobody (buses-data
// OA-152).
//
// A multi-map delivery round sent one near-identical "an update is ready" email
// per map — the 2026-08-28 round put 18 in one inbox — and there was no way to
// stage an update, or rehearse a delivery against a real customer record,
// without mailing the customer. The flag is the escape hatch; the per-customer
// digest the row goes on to ask for is not built here.
//
// The file RUNS the script twice against a throwaway database, once without the
// flag and once with it, so the control run proves the assertion can fail: the
// customer has one deliverable user, EMAIL_PROVIDER is removed from the child's
// environment so nothing can actually be sent, and notify() then logs that it
// tried. With --no-notify it must not get that far, and the update must still be
// staged exactly as without it.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'propose-update.mjs');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-nonotify-'));
const env = {
  ...process.env,
  DATA_DIR: scratch,
  DB_PATH: path.join(scratch, 'portal.sqlite'),
  NODE_ENV: 'test',
};
delete env.EMAIL_PROVIDER;

// A minimal area payload: one generator (only its presence is checked) and a
// routes.json. The same file is the live data, so the summary is "no change".
const routes = JSON.stringify({ routes: [] });
const src = path.join(scratch, 'fresh-render');
mkdirSync(src, { recursive: true });
writeFileSync(path.join(src, 'gen_internal.js'), '// placeholder generator\n');
writeFileSync(path.join(src, 'routes.json'), routes);

// Seed through the real db module, in a child process, so this file never opens
// the database the script under test is about to write to.
const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const fs = await import('node:fs');
  const path = await import('node:path');
  const db = await import(${JSON.stringify(new URL('../src/db/index.js', import.meta.url).href)});
  const store = await import(${JSON.stringify(new URL('../src/maps/store.js', import.meta.url).href)});
  const cust = db.insertCustomer({ name: 'Testville Council', type: 'council' });
  db.insertUser({ email: 'clerk@testville-council.org.uk', name: 'The Clerk', role: 'editor', customer_id: cust });
  const mapId = db.insertMap({ customer_id: cust, slug: 'testville', name: 'Testville', kind: 'area', data_dir: 'x', status: 'draft' });
  const live = store.mapDataDir(mapId);
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, 'routes.json'), ${JSON.stringify(routes)});
  db.db.prepare('UPDATE map SET data_dir = ? WHERE id = ?').run(live, mapId);
  const vid = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
  db.setCurrentVersion(mapId, vid);
  console.log(JSON.stringify({ mapId }));
`], { cwd: ROOT, env, encoding: 'utf8' });

const proposed = () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const db = await import(${JSON.stringify(new URL('../src/db/index.js', import.meta.url).href)});
    console.log(JSON.stringify(db.db.prepare('SELECT id, status FROM proposed_update ORDER BY id').all()));
  `], { cwd: ROOT, env, encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
};

if (seed.status !== 0) {
  check('the fixture seeds', false, (seed.stderr || '').split('\n').slice(0, 4).join(' | '));
} else {
  const run = (...extra) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--map', 'testville', '--src', src, ...extra], { cwd: ROOT, env, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const TRIED = /notification not sent|notification sent/;

  console.log('1  without the flag, the customer is notified (the control)');
  const plain = run();
  check('it exits 0', plain.status === 0, `exit ${plain.status}: ${plain.out.split('\n').slice(-4).join(' | ')}`);
  check('and notify() is reached for the deliverable user', TRIED.test(plain.out),
    'if this fails, the assertion in section 2 proves nothing');
  const afterPlain = proposed();
  check('and one update is staged', afterPlain && afterPlain.length === 1, JSON.stringify(afterPlain));

  console.log('2  with --no-notify, the update is staged and nobody is told');
  const quiet = run('--no-notify');
  check('it exits 0', quiet.status === 0, `exit ${quiet.status}: ${quiet.out.split('\n').slice(-4).join(' | ')}`);
  check('notify() is NOT reached', !TRIED.test(quiet.out), quiet.out.split('\n').filter((l) => TRIED.test(l)).join(' | '));
  check('and the run says out loud that nobody was told', /--no-notify was given/.test(quiet.out));
  const afterQuiet = proposed();
  check('a second update is staged, superseding the first',
    afterQuiet && afterQuiet.length === 2 && afterQuiet[0].status !== afterQuiet[1].status, JSON.stringify(afterQuiet));

  console.log('3  deliver-map.mjs forwards the flag rather than swallowing it');
  const { readFileSync } = await import('node:fs');
  const deliver = readFileSync(path.join(ROOT, 'scripts', 'deliver-map.mjs'), 'utf8');
  const filter = deliver.slice(deliver.indexOf('const passthroughArgs'), deliver.indexOf('});', deliver.indexOf('const passthroughArgs')));
  check('the passthrough filter does not drop --no-notify', filter.length > 0 && !filter.includes('no-notify'));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall propose-update --no-notify checks passed');
