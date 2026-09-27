// test-publish-baseline.mjs — publish-baseline.mjs's --dry-run writes no row in
// any table and no place-name sidecar (buses-data OA-228, 2026-09-27).
//
//   node scripts/test-publish-baseline.mjs   (or: npm run test:publish-baseline)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments, there are no placeholders, and it works in a throwaway DATA_DIR — it
// never touches the real portal data and needs no network.
//
// publish-baseline.mjs moves a map's published pointer through the P4 gate: a
// publish request, the version's state, the pointer, the map's status, two audit
// rows and a places.json sidecar. It now takes cli.mjs's confirm('remote'): the
// default is to do it, and --dry-run names each map it would publish and writes
// nothing.
//
// THE PROPERTY IS "NO ROW IN ANY TABLE AND NO FILE", NOT "EXIT 0". Every case
// counts the rows of every table after the script has run in a separate process,
// and compares them with the counts before. The real run is asserted alongside
// as the control: a script that never wrote at all would pass every dry-run
// case perfectly. Copies the shape of test-seed-demo.mjs, and the draft map of
// test-publish-baseline-search.mjs.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'publish-baseline.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-publish-baseline-dry-'));
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
const { versionDir } = await import('../src/maps/store.js');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const counts = () => Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));

// --- two draft maps, rendered and awaiting their first publication -----------
const ACTOR = 'baseline-dry-admin@example.com';
const customerId = dbm.insertCustomer({ name: 'Baseline Dry Run Test Council' });
dbm.insertUser({ customer_id: customerId, email: ACTOR, name: 'Baseline Dry Admin', role: 'admin' });
const maps = {};
for (const slug of ['dry-run-town-a', 'dry-run-town-b']) {
  const mapId = dbm.insertMap({
    customer_id: customerId, slug, name: slug, kind: 'area',
    subject: `${slug}, Testshire`, data_dir: `maps/${slug}`, status: 'draft',
  });
  const versionId = dbm.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
  dbm.setCurrentVersion(mapId, versionId);
  mkdirSync(versionDir(mapId, 'v1.0'), { recursive: true });
  writeFileSync(path.join(versionDir(mapId, 'v1.0'), 'internal.svg'), '<svg/>');
  maps[slug] = mapId;
}
const sidecar = (slug) => existsSync(path.join(versionDir(maps[slug], 'v1.0'), 'places.json'));
const mapRow = (slug) => dbm.getMapBySlug(slug);

try {
  console.log('publish-baseline.mjs --dry-run');
  check('the database has tables to count', tables.includes('map') && tables.includes('publish_request'), tables.join(','));

  const before = counts();
  const one = run('--actor', ACTOR, '--slug', 'dry-run-town-a', '--dry-run');
  check('--dry-run --slug exits 0', one.status === 0, one.stderr);
  check('--dry-run --slug says it would publish the map', /would publish dry-run-town-a v1\.0/.test(one.stdout), one.stdout);
  check('--dry-run --slug says nothing was written', /dry run complete — 1 map\(s\) would be published; nothing written/.test(one.stdout), one.stdout);
  check('--dry-run --slug writes no row in any table', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));

  const all = run('--actor', ACTOR, '--all-drafts', '--dry-run');
  check('--dry-run --all-drafts exits 0', all.status === 0, all.stderr);
  check('--dry-run --all-drafts names both drafts', /would publish dry-run-town-a/.test(all.stdout) && /would publish dry-run-town-b/.test(all.stdout), all.stdout);
  check('--dry-run --all-drafts writes no row in any table', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));
  check('the dry runs left both maps draft and unpublished',
    ['dry-run-town-a', 'dry-run-town-b'].every((s) => mapRow(s).status === 'draft' && !mapRow(s).published_version_id));
  check('the dry runs wrote no place-name sidecar', !sidecar('dry-run-town-a') && !sidecar('dry-run-town-b'));

  // --- the control: without --dry-run it really publishes ---------------------
  console.log('\npublish-baseline.mjs, the control');
  const real = run('--actor', ACTOR, '--slug', 'dry-run-town-a');
  check('without --dry-run it exits 0', real.status === 0, real.stderr);
  check('without --dry-run it publishes the map', /published dry-run-town-a v1\.0/.test(real.stdout) && mapRow('dry-run-town-a').status === 'published', real.stdout);
  check('without --dry-run it writes the place-name sidecar', sidecar('dry-run-town-a'));
  const after = counts();
  check('the control run wrote a publish request and audit rows the dry runs did not',
    after.publish_request === before.publish_request + 1 && after.audit_log >= (before.audit_log || 0) + 2, JSON.stringify(after));

  const again = run('--actor', ACTOR, '--all-drafts', '--dry-run');
  check('--dry-run after a publish exits 0', again.status === 0, again.stderr);
  check('--dry-run after a publish names only the remaining draft',
    /would publish dry-run-town-b/.test(again.stdout) && !/would publish dry-run-town-a/.test(again.stdout), again.stdout);
  check('--dry-run after a publish writes no row in any table', JSON.stringify(counts()) === JSON.stringify(after), JSON.stringify(counts()));
} finally {
  try { db.close(); } catch { /* already closed */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
