// test-check-upcoming-refreshes.mjs — check-upcoming-refreshes.mjs's --dry-run
// queues no message and sets no banner (buses-data OA-228, 2026-09-27).
//
//   node scripts/test-check-upcoming-refreshes.mjs        (or: npm run test:check-upcoming-refreshes)
//
// check-upcoming-refreshes.mjs writes two things into the live store for every
// map the monthly scan names: a 'refresh-flag' message in the admin inbox, and
// the map's public "changes coming" banner. It now takes cli.mjs's
// confirm('remote'): the default is to do both, and --dry-run reports and writes
// neither.
//
// THE PROPERTY IS "NOTHING IN THE STORE", NOT "EXIT 0". A dry run that printed
// "would flag" and then wrote anyway would exit 0 with the right words, so every
// case reads the message table and both banners back after the script has run.
// The real run is asserted alongside as the control: a script that never wrote at
// all would pass every dry-run case perfectly. The second map carries a banner
// typed by hand, so the dry run's banner count is checked against the one case
// the real run refuses to overwrite.
//
// Seeds two built maps and a report into a throwaway DATA_DIR and runs the script
// as a child process against them; it never touches real portal data and needs
// no network. Copies the shape of test-build-place-index.mjs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-upcoming-refreshes.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-check-upcoming-'));
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

const REPORT = path.join(scratch, 'upcoming-report_2026-10-01.md');
writeFileSync(REPORT, [
  '# Upcoming bus changes — get ahead of the game',
  '',
  '## Testtown — 1 upcoming',
  '_region east_anglia_',
  '- **[NEW] T1** — not currently running; service registered to start 2026-11-02',
  '',
  '## Handtown — 1 upcoming',
  '_region east_anglia_',
  '- **[CHANGE] H2** — already running; service registered to start 2026-11-02',
  '',
].join('\n'));
const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--report', REPORT, ...args], { env, encoding: 'utf8' });

const { db, insertMap, insertVersion, setCurrentVersion, setMapBannerNote, getMap, listMessages } = await import('../src/db/index.js');

const HAND = 'Typed by hand — leave alone';
const seed = (slug, name) => {
  const id = insertMap({ slug, name, kind: 'area', subject: name, status: 'published' });
  setCurrentVersion(id, insertVersion({ map_id: id, major: 1, minor: 0, storage_key: 'v1.0' }));
  return id;
};

try {
  const auto = seed('testtown', 'Testtown');
  const hand = seed('handtown', 'Handtown');
  setMapBannerNote(hand, HAND, 'manual');
  const flags = () => listMessages().filter((m) => m.kind === 'refresh-flag').length;

  console.log('check-upcoming-refreshes.mjs --dry-run');

  const dry = run('--dry-run');
  check('--dry-run exits 0', dry.status === 0, dry.stderr);
  check('--dry-run names the maps it would flag', /would flag map "testtown"/.test(dry.stdout) && /would flag map "handtown"/.test(dry.stdout), dry.stdout);
  check('--dry-run counts one banner, not the hand-written one', /2 flag\(s\) would be queued .* 1 public banner\(s\) would be set\/refreshed — --dry-run, nothing written/.test(dry.stdout), dry.stdout);
  check('--dry-run queues no message', flags() === 0, `${flags()} message(s)`);
  check('--dry-run sets no banner', getMap(auto).banner_note == null, getMap(auto).banner_note);
  check('--dry-run leaves the hand-written banner', getMap(hand).banner_note === HAND, getMap(hand).banner_note);

  const real = run();
  check('without --dry-run it exits 0', real.status === 0, real.stderr);
  check('without --dry-run it says it flagged and set one banner', /2 flag\(s\) queued .* 1 public banner\(s\) set\/refreshed\./.test(real.stdout), real.stdout);
  check('without --dry-run both messages are queued', flags() === 2, `${flags()} message(s)`);
  check('without --dry-run the banner is set', /T1/.test(getMap(auto).banner_note || ''), getMap(auto).banner_note);
  check('without --dry-run the hand-written banner survives', getMap(hand).banner_note === HAND, getMap(hand).banner_note);

  const again = run('--dry-run');
  check('a second --dry-run sees both as already flagged', again.status === 0 && /0 flag\(s\) would be queued .* 2 already flagged/.test(again.stdout), again.stdout);
  check('a second --dry-run still queues nothing', flags() === 2, `${flags()} message(s)`);
} finally {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nall check-upcoming-refreshes checks passed.');
