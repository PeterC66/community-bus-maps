// test-propose-update.mjs — propose-update.mjs's --dry-run writes no row in any
// table, no file in the object store, and emails nobody (buses-data OA-228,
// 2026-09-27).
//
//   node scripts/test-propose-update.mjs   (or: npm run test:propose-update)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments, there are no placeholders, and it works in a throwaway DATA_DIR — it
// never touches the real portal data, needs no network, and removes
// EMAIL_PROVIDER from the child's environment so nothing can actually be sent.
//
// propose-update.mjs supersedes any pending proposed update, inserts a
// proposed_update row, stages the payload under the map's pack, stores the diff
// and emails the customer. It now takes cli.mjs's confirm('remote'): the default
// is to do all of that, and --dry-run runs every refusal and then says what it
// would do.
//
// THE PROPERTY IS "NO ROW, NO FILE, NO EMAIL", NOT "EXIT 0". Every case counts
// the rows of every table and lists every file under the object store's maps/
// folder after the script has run in a separate process, and compares them with
// before. The real run is the control: a script that never wrote at all would
// pass every dry-run case perfectly. notify() logs that it tried even with no
// EMAIL_PROVIDER, which is how "no email" is asserted — the same signal
// test-propose-update-no-notify.mjs uses. Copies the shape of test-import-map.mjs.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'propose-update.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-propose-update-dry-'));
const env = { ...process.env, DATA_DIR: scratch, DB_PATH: path.join(scratch, 'portal.sqlite'), NODE_ENV: 'test' };
delete env.EMAIL_PROVIDER;
for (const k of ['DATA_DIR', 'DB_PATH', 'NODE_ENV']) process.env[k] = env[k];
delete process.env.EMAIL_PROVIDER;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
};
const TRIED = /notification not sent|notification sent/;

const dbm = await import('../src/db/index.js');
const store = await import('../src/maps/store.js');
const { db } = dbm;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const counts = () => Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
const files = () => {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(scratch, p)); } };
  if (existsSync(path.join(scratch, 'maps'))) walk(path.join(scratch, 'maps'));
  return out.sort();
};
const proposed = () => db.prepare('SELECT id, status FROM proposed_update ORDER BY id').all();

// --- a built area map with one deliverable user, and a fresh payload ---------
const liveRoutes = JSON.stringify({ palette: { 55: '#000000' } });
const custId = dbm.insertCustomer({ name: 'Propose Dry Run Council', type: 'council' });
dbm.insertUser({ email: 'clerk@propose-dry-run.org.uk', name: 'The Clerk', role: 'editor', customer_id: custId });
const mapId = dbm.insertMap({ customer_id: custId, slug: 'dryville', name: 'Dryville', kind: 'area', data_dir: 'x', status: 'draft' });
const live = store.mapDataDir(mapId);
mkdirSync(live, { recursive: true });
writeFileSync(path.join(live, 'routes.json'), liveRoutes);
db.prepare('UPDATE map SET data_dir = ? WHERE id = ?').run(live, mapId);
dbm.setCurrentVersion(mapId, dbm.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} }));

const src = path.join(scratch, 'fresh-render');
mkdirSync(src, { recursive: true });
writeFileSync(path.join(src, 'gen_internal.js'), '// placeholder generator\n');
writeFileSync(path.join(src, 'routes.json'), JSON.stringify({ palette: { 55: '#000000', 66: '#ffffff' } }));
writeFileSync(path.join(src, 'notes.txt'), 'not staged');
const noGens = path.join(scratch, 'no-generators');
mkdirSync(noGens, { recursive: true });
writeFileSync(path.join(noGens, 'routes.json'), liveRoutes);

try {
  console.log('propose-update.mjs --dry-run');
  check('the database has tables to count', tables.includes('proposed_update') && tables.includes('map'), tables.join(','));

  const before = counts();
  const filesBefore = files();
  const dry = run('--map', 'dryville', '--src', src, '--note', 'Dry run refresh', '--dry-run');
  check('--dry-run exits 0', dry.status === 0, dry.stderr);
  check('--dry-run names the files it would stage, and only those', /would stage 2 payload file\(s\) .*: gen_internal\.js, routes\.json/.test(dry.stdout), dry.stdout);
  check('--dry-run prints the diff it would store', /routes added: +66/.test(dry.stdout), dry.stdout);
  check('--dry-run says who it would email', /would email "Propose Dry Run Council"/.test(dry.stdout), dry.stdout);
  check('--dry-run says nothing was written', /dry run complete — nothing staged for "Dryville"/.test(dry.stdout), dry.stdout);
  check('--dry-run writes no row in any table', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));
  check('--dry-run writes no file in the object store', JSON.stringify(files()) === JSON.stringify(filesBefore), files().join(','));
  check('--dry-run emails nobody', !TRIED.test(dry.out), dry.out.split('\n').filter((l) => TRIED.test(l)).join(' | '));

  const quiet = run('--map', 'dryville', '--src', src, '--no-notify', '--dry-run');
  check('--dry-run --no-notify says it would email nobody', quiet.status === 0 && /would email nobody: --no-notify/.test(quiet.stdout), quiet.out);

  // A refusal is still a refusal: --dry-run must not turn one into a yes.
  const shape = run('--map', 'dryville', '--src', noGens, '--dry-run');
  check('--dry-run still refuses a payload with no generator', shape.status === 3 && /carries none of the area generators/.test(shape.stderr), `exit ${shape.status}: ${shape.stderr}`);
  const nomap = run('--map', 'nowhere', '--src', src, '--dry-run');
  check('--dry-run still refuses an unknown map', nomap.status === 1 && /no map matching "nowhere"/.test(nomap.stderr), `exit ${nomap.status}: ${nomap.stderr}`);
  check('the refusals wrote nothing either', JSON.stringify(counts()) === JSON.stringify(before) && JSON.stringify(files()) === JSON.stringify(filesBefore));

  // --- the control: without --dry-run it really stages and really notifies --
  console.log('\npropose-update.mjs, the control');
  const real = run('--map', 'dryville', '--src', src, '--note', 'Real refresh');
  check('without --dry-run it exits 0', real.status === 0, real.out);
  const staged = proposed();
  check('without --dry-run it inserts a proposed update', staged.length === 1 && counts().proposed_update === before.proposed_update + 1, JSON.stringify(staged));
  const newFiles = files().filter((f) => !filesBefore.includes(f));
  check('without --dry-run it stages the payload files', newFiles.some((f) => f.endsWith('routes.json')) && newFiles.some((f) => f.endsWith('gen_internal.js')) && !newFiles.some((f) => f.endsWith('notes.txt')), newFiles.join(','));
  check('without --dry-run it reaches notify()', TRIED.test(real.out), 'if this fails, "--dry-run emails nobody" proves nothing');

  // --- a dry run over a pending update names it and supersedes nothing ------
  const afterReal = counts();
  const filesAfterReal = files();
  const again = run('--map', 'dryville', '--src', src, '--dry-run');
  check('--dry-run over a pending update exits 0', again.status === 0, again.stderr);
  check('--dry-run names the pending update it would supersede', new RegExp(`would supersede still-pending proposed update #${staged[0].id}`).test(again.stdout), again.stdout);
  check('--dry-run left the pending update as it was', JSON.stringify(proposed()) === JSON.stringify(staged), JSON.stringify(proposed()));
  check('--dry-run over a pending update writes no row and no file',
    JSON.stringify(counts()) === JSON.stringify(afterReal) && JSON.stringify(files()) === JSON.stringify(filesAfterReal), JSON.stringify(counts()));
} finally {
  try { db.close(); } catch { /* already closed */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
