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
// rows, the folders and the audit log. Section 3 drives the admin button's two
// routes in-process (OA-622) and pins what a public link to a retired version gets.
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

const { classifyVersions, decideRetire } = await import(pathToFileURL(path.join(TREE, 'src', 'publish', 'retire.js')).href);

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

{
  // decideRetire() is the question a button asks of those same verdicts (OA-622).
  const rows = classifyVersions(facts);
  check('decideRetire lets an editor retire a never-published draft', !!decideRetire(rows, 12, { admin: false }).verdict);
  const ed = decideRetire(rows, 10, { admin: false, reason: 'x' });
  check('decideRetire refuses an editor a once-published version (admin only)', ed.code === 403, JSON.stringify(ed));
  const noWhy = decideRetire(rows, 10, { admin: true, reason: '  ' });
  check('decideRetire refuses an admin a once-published version without a reason', noWhy.code === 400, JSON.stringify(noWhy));
  check('decideRetire lets an admin retire it with a reason', !!decideRetire(rows, 10, { admin: true, reason: 'dev build' }).verdict);
  const pub = decideRetire(rows, 13, { admin: true, reason: 'x' });
  check('decideRetire refuses the published version even to an admin', pub.code === 409, JSON.stringify(pub));
  check('decideRetire answers 404 for a version not on this map', decideRetire(rows, 999, { admin: true }).code === 404);
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
console.log('3  the admin button and the public site, in-process (OA-622)');
// The server is imported from the repository, not from TREE: a scratch copy of
// src/ has no node_modules to resolve fastify from. It writes through the same
// retireVersion() the script does, so section 2 covers the write itself.
{
  const s3 = mkdtempSync(path.join(os.tmpdir(), 'cbm-retire-btn-'));
  Object.assign(process.env, { DATA_DIR: s3, DB_PATH: path.join(s3, 'portal.sqlite'), CBM_NO_LISTEN: '1', NODE_ENV: 'test' });
  const db = await import(pathToFileURL(path.join(ROOT, 'src', 'db', 'index.js')).href);
  const { versionDir } = await import(pathToFileURL(path.join(ROOT, 'src', 'maps', 'store.js')).href);
  const { app } = await import(pathToFileURL(path.join(ROOT, 'src', 'server.js')).href);
  await app.ready();

  const cust = db.insertCustomer({ name: 'Button Council', type: 'council', quota_areas: 2, quota_places: 2 });
  const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: cust });
  const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: cust });
  const mapId = db.insertMap({ customer_id: cust, slug: 'buttonville', name: 'Buttonville', kind: 'area', data_dir: '', status: 'published' });
  const ids = {};
  for (let minor = 0; minor <= 4; minor++) {
    ids['v1.' + minor] = db.insertVersion({ map_id: mapId, major: 1, minor, storage_key: 'v1.' + minor, overrides: {} });
    const dir = versionDir(mapId, 'v1.' + minor);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'internal.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><text>v1.${minor}</text></svg>`);
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
  db.setMapPublicListed(mapId, true);

  const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
  const tok = (uid) => { const t = `tok-${uid}-${Math.random()}`; db.insertSession(t, uid, sqlPlus(86_400_000)); return t; };
  const adminTok = tok(adminId), editorTok = tok(editorId);
  const CSRF = 'test-csrf-token-value';
  const send = (method, url, token, body) => app.inject({
    method, url,
    headers: { cookie: `cbm_session=${token}; cbm_csrf=${CSRF}`, 'x-csrf-token': CSRF, 'content-type': 'application/json' },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const base = `/api/admin/maps/${mapId}/versions`;

  const list = await send('GET', `${base}/retire-verdicts`, adminTok);
  const vs = Object.fromEntries(((list.json() || {}).verdicts || []).map((v) => [v.version, v]));
  check('the admin GET lists every version with the verdict the rule gives', list.statusCode === 200
    && vs['v1.2'] && vs['v1.2'].verdict === 'retirable' && vs['v1.3'].verdict === 'keep' && vs['v1.0'].adminOnly === true,
    `${list.statusCode} ${list.body.slice(0, 200)}`);
  check('an editor is refused the admin GET', (await send('GET', `${base}/retire-verdicts`, editorTok)).statusCode === 403);
  const kept = await send('POST', `${base}/${ids['v1.3']}/retire`, adminTok, { reason: 'x' });
  check('the button refuses the published version (409)', kept.statusCode === 409, `${kept.statusCode} ${kept.body}`);
  const noWhy = await send('POST', `${base}/${ids['v1.0']}/retire`, adminTok, {});
  check('the button refuses a once-published version without a reason (400)', noWhy.statusCode === 400, `${noWhy.statusCode} ${noWhy.body}`);
  const draft = await send('POST', `${base}/${ids['v1.2']}/retire`, adminTok, {});
  check('the button retires a never-published draft', draft.statusCode === 200 && (draft.json() || {}).retired === 'v1.2', `${draft.statusCode} ${draft.body}`);
  check('the button leaves the draft with no files and off listVersions', !existsSync(versionDir(mapId, 'v1.2'))
    && !db.listVersions(mapId).some((v) => v.storage_key === 'v1.2'));
  const old = await send('POST', `${base}/${ids['v1.0']}/retire`, adminTok, { reason: 'development build nobody linked to' });
  check('the button retires a once-published version with a reason', old.statusCode === 200 && (old.json() || {}).oncePublished === true, `${old.statusCode} ${old.body}`);
  const audit = db.db.prepare("SELECT actor_email AS who, detail_json AS d FROM audit_log WHERE action = 'version.retire' AND version_id = ?").get(ids['v1.0']);
  const ad = audit ? JSON.parse(audit.d) : {};
  check('the button writes one version.retire audit row naming the admin, the reason and the door',
    audit && audit.who === 'admin@example.com' && ad.reason === 'development build nobody linked to' && ad.via === 'admin-button', JSON.stringify(audit));
  const twice = await send('POST', `${base}/${ids['v1.0']}/retire`, adminTok, { reason: 'again' });
  check('retiring it again is refused as already retired (409)', twice.statusCode === 409, `${twice.statusCode} ${twice.body}`);

  // What retiring a superseded publication does NOT do: break a public link. Every
  // public route serves the published key looked up by slug, so a link that still
  // carries the retired key gets the CURRENT file, on the short cache, not a 404.
  const pubOld = await app.inject({ method: 'GET', url: '/api/public/maps/buttonville/internal.svg?v=v1.0' });
  check('a public link carrying a retired version key is answered 200 with the published file',
    pubOld.statusCode === 200 && pubOld.body.includes('<text>v1.3</text>'), `${pubOld.statusCode} ${pubOld.body.slice(0, 120)}`);
  check('a public link carrying a retired version key gets the short cache, not the immutable one',
    String(pubOld.headers['cache-control']).includes('max-age=300'), String(pubOld.headers['cache-control']));
  await app.close();
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Retiring a version keeps the row and never takes one the map still needs.');
