#!/usr/bin/env node
// RETIRING A VERSION KEEPS THE ROW, AND NEVER TAKES ONE THE MAP STILL NEEDS.
//
//   node scripts/test-prune-versions.mjs        (or: npm run test:prune-versions)
//
// buses-data OA-572. scripts/prune-versions.mjs removes the render files of old
// versions and stamps `map_version.retired_at`, on Peter's ruling of 2026-10-10:
// retire, not erase. Two things could go wrong silently, and this file is about
// both. The RULE (src/publish/retire.js) could let go of a version the map still
// needs — the published one, the working head, the revert target, the highest
// number — and nothing would say so until the day somebody needed it. And the
// SCRIPT could remove the files without stamping the row, which leaves the editor
// listing a version it cannot show, or stamp without auditing, which leaves no
// record of who removed what.
//
// Section 1 asks the rule directly, case by case. Section 2 runs the real script
// against a throwaway database and a throwaway render store and reads back the
// rows, the folders and the audit log.
//
// It takes one optional positional argument, a tree to read src/ and scripts/
// from, so scripts/prove-red-prune-versions.mjs can point it at a mutated copy.

import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TREE = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
const SCRIPT = path.join(TREE, 'scripts', 'prune-versions.mjs');
const DBMOD = pathToFileURL(path.join(TREE, 'src', 'db', 'index.js')).href;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('1  the rule');

const { classifyVersions } = await import(pathToFileURL(path.join(TREE, 'src', 'publish', 'retire.js')).href);

// v1.0 published then superseded; v1.1 published then superseded (the revert
// target); v1.2 a draft nobody published; v1.3 the published one; v1.4 rejected;
// v1.5 under review; v1.6 the working head and the highest number.
const V = (id, minor, reviewState, extra = {}) => ({ id, major: 1, minor, storageKey: `v1.${minor}`, reviewState, retiredAt: null, ...extra });
const facts = {
  versions: [V(10, 0, 'superseded'), V(11, 1, 'superseded'), V(12, 2, 'draft'), V(13, 3, 'published'),
    V(14, 4, 'rejected'), V(15, 5, 'pending'), V(16, 6, 'draft')],
  currentVersionId: 16, publishedVersionId: 13,
  publishedOrder: [13, 11, 10], openRequestVersionIds: [15], keep: 0,
};
const by = (rows) => Object.fromEntries(rows.map((r) => [r.version, r]));
const r0 = by(classifyVersions(facts));

check('the published version is kept', r0['v1.3'].verdict === 'keep' && /published/.test(r0['v1.3'].why), JSON.stringify(r0['v1.3']));
check('the working head is kept', r0['v1.6'].verdict === 'keep', JSON.stringify(r0['v1.6']));
check('the revert target is kept', r0['v1.1'].verdict === 'keep' && /revert target/.test(r0['v1.1'].why), JSON.stringify(r0['v1.1']));
check('a version under review is kept', r0['v1.5'].verdict === 'keep' && /awaiting review/.test(r0['v1.5'].why), JSON.stringify(r0['v1.5']));
check('a never-published draft is retirable by an editor', r0['v1.2'].verdict === 'retirable' && !r0['v1.2'].adminOnly, JSON.stringify(r0['v1.2']));
check('a rejected version is retirable by an editor', r0['v1.4'].verdict === 'retirable' && !r0['v1.4'].adminOnly, JSON.stringify(r0['v1.4']));
check('a once-published, superseded version is retirable by an admin only', r0['v1.0'].verdict === 'retirable' && r0['v1.0'].adminOnly === true, JSON.stringify(r0['v1.0']));

{
  // The head is not always the highest: after a revert, or when the head is the published version.
  const f = { ...facts, currentVersionId: 13, openRequestVersionIds: [] };
  const r = by(classifyVersions(f));
  check('the highest number is kept even when it is not the head', r['v1.6'].verdict === 'keep' && /highest/.test(r['v1.6'].why), JSON.stringify(r['v1.6']));
}
{
  // Once the revert target is retired, the one before it becomes the revert target.
  const f = { ...facts, versions: facts.versions.map((v) => (v.id === 11 ? { ...v, retiredAt: '2026-10-10 12:00:00' } : v)) };
  const r = by(classifyVersions(f));
  check('a retired version is reported as retired', r['v1.1'].verdict === 'retired', JSON.stringify(r['v1.1']));
  check('and the revert target moves to the publication before it', r['v1.0'].verdict === 'keep' && /revert target/.test(r['v1.0'].why), JSON.stringify(r['v1.0']));
}
{
  const r = by(classifyVersions({ ...facts, keep: 3 }));
  check('--keep protects the newest n live versions', r['v1.4'].verdict === 'keep' && /newest 3/.test(r['v1.4'].why), JSON.stringify(r['v1.4']));
  check('and nothing older than them', r['v1.2'].verdict === 'retirable', JSON.stringify(r['v1.2']));
}
{
  // Published by publish-baseline.mjs, which sets the state and no publish_request.
  const f = { ...facts, publishedOrder: [], versions: facts.versions.map((v) => (v.id === 12 ? { ...v, reviewState: 'superseded' } : v)) };
  check('a superseded version with no publish request still counts as once published',
    by(classifyVersions(f))['v1.2'].adminOnly === true);
}

console.log('');
console.log('2  the script, against a throwaway portal');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-prune-'));
const env = { ...process.env, DATA_DIR: scratch, DB_PATH: path.join(scratch, 'portal.sqlite'), NODE_ENV: 'test' };
const node = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
};
const evalDb = (body) => node(['--input-type=module', '-e', `const db = await import(${JSON.stringify(DBMOD)});\n${body}`]);

const seed = evalDb(`
  const cust = db.insertCustomer({ name: 'Test Council', type: 'council' });
  const mapId = db.insertMap({ customer_id: cust, slug: 'testville', name: 'Testville', kind: 'area', data_dir: '', status: 'draft' });
  const ids = {};
  for (let minor = 0; minor <= 4; minor++) {
    ids['v1.' + minor] = db.insertVersion({ map_id: mapId, major: 1, minor, storage_key: 'v1.' + minor, overrides: {} });
  }
  const publish = (key, prev) => {
    const pr = db.insertPublishRequest({ map_id: mapId, version_id: ids[key] });
    db.decidePublishRequest(pr, { status: 'approved', decisionNote: 'ok' });
    if (prev) db.setVersionState(ids[prev], 'superseded');
    db.setVersionState(ids[key], 'published');
    db.setPublishedVersion(mapId, ids[key]);
  };
  publish('v1.0'); publish('v1.1', 'v1.0'); publish('v1.3', 'v1.1');
  db.setCurrentVersion(mapId, ids['v1.4']);
  console.log(JSON.stringify({ mapId, ids }));
`);
if (seed.code !== 0) {
  check('the fixture seeds', false, seed.out.split('\n').slice(0, 4).join(' | '));
} else {
  const { mapId, ids } = JSON.parse(seed.stdout.trim().split('\n').pop());
  const renders = path.join(scratch, 'maps', String(mapId), 'renders');
  for (const k of Object.keys(ids)) {
    mkdirSync(path.join(renders, k), { recursive: true });
    writeFileSync(path.join(renders, k, 'internal.svg'), '<svg/>');
  }
  const state = () => {
    const r = evalDb(`
      const rows = db.db.prepare('SELECT storage_key AS k, retired_at AS r FROM map_version WHERE map_id = ?').all(${mapId});
      const audit = db.db.prepare("SELECT version_id AS v, detail_json AS d FROM audit_log WHERE action = 'version.retire' ORDER BY id").all();
      console.log(JSON.stringify({
        retired: rows.filter((x) => x.r).map((x) => x.k).sort(),
        listed: db.listVersions(${mapId}).map((v) => v.storage_key),
        next: db.nextVersion(${mapId}),
        audit: audit.map((a) => ({ v: a.v, ...JSON.parse(a.d) })),
      }));
    `);
    return r.code === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : { error: r.out };
  };
  const onDisk = (k) => existsSync(path.join(renders, k));

  const dry = node([SCRIPT, '--map', String(mapId), '--keep', '0']);
  check('the dry run exits 0', dry.code === 0, `exit ${dry.code}: ${dry.out.slice(-300)}`);
  check('the dry run names the draft it would retire', /v1\.2\s+would retire/.test(dry.out), dry.out);
  check('and holds the once-published one back', /v1\.0\s+held/.test(dry.out), dry.out);
  const s0 = state();
  check('and changes nothing', s0.retired && s0.retired.length === 0 && onDisk('v1.2'), JSON.stringify(s0));

  check('--include-published without a reason is refused', node([SCRIPT, '--map', String(mapId), '--include-published', '--yes']).code === 2);
  check('--all with --yes is refused', node([SCRIPT, '--all', '--yes']).code === 2);
  check('--all on its own is a dry run that lists the map', /Testville/.test(node([SCRIPT, '--all', '--keep', '0']).out));

  const run = node([SCRIPT, '--map', String(mapId), '--keep', '0', '--yes']);
  check('retiring exits 0', run.code === 0, `exit ${run.code}: ${run.out.slice(-300)}`);
  const s1 = state();
  check('the never-published draft is stamped retired', JSON.stringify(s1.retired) === JSON.stringify(['v1.2']), JSON.stringify(s1));
  check('and its render folder is gone', !onDisk('v1.2'));
  check('the once-published one is untouched without --include-published', onDisk('v1.0') && !(s1.retired || []).includes('v1.0'));
  check('the published version, revert target and head keep their files', onDisk('v1.3') && onDisk('v1.1') && onDisk('v1.4'));
  check('listVersions leaves the retired version out', s1.listed && !s1.listed.includes('v1.2') && s1.listed.includes('v1.0'), JSON.stringify(s1.listed));
  check('the version number is not reused', s1.next && s1.next.major === 1 && s1.next.minor === 5, JSON.stringify(s1.next));
  check('one version.retire audit row was written for it', s1.audit && s1.audit.length === 1 && s1.audit[0].v === ids['v1.2'], JSON.stringify(s1.audit));

  const pub = node([SCRIPT, '--map', String(mapId), '--keep', '0', '--include-published', '--reason', 'development build nobody linked to', '--yes']);
  check('an admin can retire a once-published version with a reason', pub.code === 0, pub.out.slice(-300));
  const s2 = state();
  check('it is stamped and its files are gone', (s2.retired || []).includes('v1.0') && !onDisk('v1.0'), JSON.stringify(s2));
  const a = (s2.audit || []).find((x) => x.v === ids['v1.0']) || {};
  check('and its audit row carries the reason', a.reason === 'development build nobody linked to' && a.oncePublished === true, JSON.stringify(a));
  check('the revert target still was not retired', onDisk('v1.1') && !(s2.retired || []).includes('v1.1'), JSON.stringify(s2.retired));

  const again = node([SCRIPT, '--map', String(mapId), '--keep', '0', '--include-published', '--reason', 'again', '--yes']);
  check('a second run retires nothing more', again.code === 0 && (state().audit || []).length === 2, again.out.slice(-300));
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Retiring a version keeps the row and never takes one the map still needs.');
