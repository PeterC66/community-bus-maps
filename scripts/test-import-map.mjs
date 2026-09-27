// test-import-map.mjs — import-map.mjs's --dry-run writes no row in any table
// and no file in the object store (buses-data OA-228, 2026-09-27).
//
//   node scripts/test-import-map.mjs   (or: npm run test:import-map)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments, there are no placeholders, and it works in a throwaway DATA_DIR — it
// never touches the real portal data and needs no network.
//
// import-map.mjs writes a customer (when --customer names a new one), a map row
// (or adopts an approved request's), a pack under maps/<id>/, a version and an
// audit row. It now takes cli.mjs's confirm('remote'): the default is to do it,
// and --dry-run runs every refusal and then says what it would do.
//
// THE PROPERTY IS "NO ROW IN ANY TABLE AND NO FILE", NOT "EXIT 0". Every case
// counts the rows of every table after the script has run in a separate process,
// and compares them with the counts before, and lists the object store's maps/
// folder. The real run is the control: a script that never wrote at all would
// pass every dry-run case perfectly. The real run EXITS NON-ZERO, because a stub
// payload cannot draw a sheet and dies at renderVersion() — the same reason
// test-engine-source.mjs gives — so the control asserts what was written before
// the render, never the exit code. Copies the shape of test-publish-baseline.mjs.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'import-map.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-import-map-dry-'));
const env = { ...process.env, DATA_DIR: scratch, NODE_ENV: 'test' };
for (const k of ['DATA_DIR', 'NODE_ENV']) process.env[k] = env[k];

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });

const dbm = await import('../src/db/index.js');
const { db } = dbm;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const counts = () => Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
const packs = () => (existsSync(path.join(scratch, 'maps')) ? readdirSync(path.join(scratch, 'maps')).sort() : []);

// --- a generator-free area payload, which is every real area delivery --------
const src = path.join(scratch, 'payload');
mkdirSync(src, { recursive: true });
writeFileSync(path.join(src, 'routes.json'), JSON.stringify({ palette: { 55: '#000000' } }));
writeFileSync(path.join(src, 'internal.svg'), '<svg/>');
writeFileSync(path.join(src, 'external.svg'), '<svg/>');

// --- an approved request awaiting a build, owned by an existing organisation -
const ownerId = dbm.insertCustomer({ name: 'Import Dry Run Test Council' });
const requestId = dbm.insertMap({
  customer_id: ownerId, slug: 'requested-town', name: 'Requested Town', kind: 'area',
  subject: 'Requested Town', data_dir: '', status: 'approved',
});

try {
  console.log('import-map.mjs --dry-run');
  check('the database has tables to count', tables.includes('map') && tables.includes('customer'), tables.join(','));

  const before = counts();
  const packsBefore = packs();
  const fresh = run('--src', src, '--name', 'Dry Run Town', '--customer', 'A Brand New Council', '--dry-run');
  check('--dry-run of a fresh import exits 0', fresh.status === 0, fresh.stderr);
  check('--dry-run says it would create the new owner', /would create customer "A Brand New Council"/.test(fresh.stdout), fresh.stdout);
  check('--dry-run says it would create the map', /would create map "Dry Run Town" \(slug: dry-run-town/.test(fresh.stdout), fresh.stdout);
  check('--dry-run names the payload file it would copy', /would copy 1 payload file\(s\) .*routes\.json/.test(fresh.stdout), fresh.stdout);
  check('--dry-run says nothing was written', /dry run complete — "Dry Run Town" would be imported; nothing written/.test(fresh.stdout), fresh.stdout);
  check('--dry-run of a fresh import writes no row in any table', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));
  check('--dry-run of a fresh import creates no pack', JSON.stringify(packs()) === JSON.stringify(packsBefore), packs().join(','));
  check('--dry-run did not create the new owner', !dbm.getCustomerByName('A Brand New Council'));

  const req = run('--request', String(requestId), '--src', src, '--dry-run');
  check('--dry-run of an approved request exits 0', req.status === 0, req.stderr);
  check('--dry-run says it would build the request in place', new RegExp(`would build approved request #${requestId} in place`).test(req.stdout), req.stdout);
  check('--dry-run of a request writes no row in any table', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));
  check('--dry-run left the request approved', dbm.getMap(requestId).status === 'approved', dbm.getMap(requestId).status);
  check('--dry-run of a request creates no pack', JSON.stringify(packs()) === JSON.stringify(packsBefore), packs().join(','));

  // A refusal is still a refusal: --dry-run must not turn one into a yes.
  const refused = run('--src', src, '--name', 'Busway Town', '--customer', 'A Brand New Council', '--external-style', 'busway', '--dry-run');
  check('--dry-run still refuses what a real run refuses', refused.status === 2 && /only area external template is 'radial'/.test(refused.stderr), `exit ${refused.status}: ${refused.stderr}`);
  const unowned = run('--src', src, '--name', 'Unowned Town', '--dry-run');
  check('--dry-run still refuses an unowned map', unowned.status === 1 && /refusing to import an unowned map/.test(unowned.stderr), `exit ${unowned.status}: ${unowned.stderr}`);

  // --- the control: without --dry-run it really writes ------------------------
  console.log('\nimport-map.mjs, the control');
  const real = run('--src', src, '--name', 'Dry Run Town', '--customer', 'A Brand New Council');
  const after = counts();
  check('without --dry-run it creates the new owner', !!dbm.getCustomerByName('A Brand New Council'), real.stdout + real.stderr);
  check('without --dry-run it creates the map row', !!dbm.getMapBySlug('dry-run-town') && after.map === before.map + 1, JSON.stringify(after));
  const newPacks = packs().filter((p) => !packsBefore.includes(p));
  check('without --dry-run it writes a pack holding the payload',
    newPacks.length === 1 && existsSync(path.join(scratch, 'maps', newPacks[0], 'data', 'routes.json')), packs().join(','));

  const afterReal = counts();
  const again = run('--request', String(requestId), '--src', src, '--dry-run');
  check('--dry-run after a real import exits 0', again.status === 0, again.stderr);
  check('--dry-run after a real import writes no row in any table', JSON.stringify(counts()) === JSON.stringify(afterReal), JSON.stringify(counts()));
} finally {
  try { db.close(); } catch { /* already closed */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
