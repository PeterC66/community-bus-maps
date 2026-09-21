// Lifecycle-seam checks — the two rough edges closed in 0.8.1.
//
//   node scripts/test-lifecycle.mjs        (or: npm run test:lifecycle)
//
//   1. importer ↔ map-request seam. An approved request row is BUILT IN PLACE by
//      `import-map.mjs --request <id>`, so the placeholder becomes the built map:
//      one row, quota counted once, nothing to archive. What is worth testing is
//      the queue query, the in-place adoption, and every refusal the importer
//      makes before it touches anything (wrong status, already built, wrong kind,
//      wrong owner, a slug that belongs to someone else).
//   2. rollback. `chooseRevertTarget()` decides which version a revert serves; the
//      only candidates are versions this map already published whose renders are
//      still on disk. Plus listPublishedHistory(), which is where "was it ever
//      reviewed?" is answered from.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-lifecycle-'));
process.env.DATA_DIR = scratch;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const IMPORTER = path.resolve(import.meta.dirname, 'import-map.mjs');

/** Run the importer and capture its output + exit code (it must never throw here). */
function runImporter(args) {
  try {
    const stdout = execFileSync(process.execPath, [IMPORTER, ...args], {
      env: { ...process.env, DATA_DIR: scratch }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// ===========================================================================
// 1. importer ↔ map-request seam
// ===========================================================================
console.log('\nthe build queue');

const custId = db.insertCustomer({ name: 'Seam Parish Council', type: 'council', quota_areas: 1, quota_places: 3 });
const otherCust = db.insertCustomer({ name: 'Other Council', type: 'council' });
const userId = db.insertUser({ customer_id: custId, email: 'clerk@seam.example', role: 'editor' });

// What a customer's request creates, and what an admin's approval does to it.
const reqId = db.insertMap({
  customer_id: custId, slug: 'seam-village', name: 'Seam Village', kind: 'area',
  subject: 'Seam Village', request_note: 'Please show the 55 and the school bus',
  requested_by: userId, status: 'requested',
});
eq('a pending request is not in the build queue', db.listAwaitingBuild().map((m) => m.id), []);
db.setMapStatus(reqId, 'approved');
eq('an approved, unbuilt request IS in the build queue', db.listAwaitingBuild().map((m) => m.id), [reqId]);
eq('the queue row carries who asked and what for',
  db.listAwaitingBuild().map((m) => [m.customer_name, m.requested_by_email, m.request_note]),
  [['Seam Parish Council', 'clerk@seam.example', 'Please show the 55 and the school bus']]);

// The request already occupies its quota slot — that is the whole point of the
// in-place fulfilment: building it must not consume a SECOND slot.
eq('an approved request counts against quota', db.quotaUsage(custId), { area: 1, place: 0 });

console.log('\nimporter refusals (nothing is touched)');
const missingSrc = path.join(scratch, 'no-such-dir');
let r = runImporter(['--request', '999', '--src', missingSrc]);
check('an unknown request id is refused', r.code === 1 && /no map #999/.test(r.out), r.out);
r = runImporter(['--request', 'abc', '--src', missingSrc]);
check('a non-numeric --request is refused', r.code === 2 && /must be a map id/.test(r.out), r.out);

// A 'requested' (un-approved) row must not be buildable — approval is the gate.
const unapproved = db.insertMap({ customer_id: custId, slug: 'not-approved', name: 'Not Approved', kind: 'area', status: 'requested' });
r = runImporter(['--request', String(unapproved), '--src', missingSrc]);
check('an un-approved request is refused', r.code === 1 && /not an approved request/.test(r.out), r.out);
check('…and it says to approve it first', /Approve it in the admin console/.test(r.out), r.out);

// Kind mismatch: the src dir must exist for this check to be reached.
const emptySrc = path.join(scratch, 'empty-src');
mkdirSync(emptySrc, { recursive: true });
r = runImporter(['--request', String(reqId), '--src', emptySrc, '--kind', 'place']);
check('building the wrong KIND into a request is refused', r.code === 1 && /was requested as a "area" map/.test(r.out), r.out);

// A payload that looks like an area map, for the checks past generator validation.
const areaSrc = path.join(scratch, 'area-src');
mkdirSync(areaSrc, { recursive: true });
writeFileSync(path.join(areaSrc, 'routes.json'), JSON.stringify({ palette: { 55: '#000000' } }));
for (const g of ['gen_internal.js', 'gen_external.js']) writeFileSync(path.join(areaSrc, g), '// stub\n');

r = runImporter(['--request', String(reqId), '--src', areaSrc, '--customer', 'Other Council']);
check('re-owning a request via --customer is refused',
  r.code === 1 && /belongs to "Seam Parish Council"/.test(r.out), r.out);

// A fresh import that collides with a queued request must point at --request
// instead of quietly creating the duplicate row this fix exists to prevent.
r = runImporter(['--src', areaSrc, '--name', 'Seam Village', '--customer', 'Seam Parish Council']);
check('a slug collision is still refused', r.code === 1 && /already exists/.test(r.out), r.out);
check('…and names the approved request to build instead',
  new RegExp(`APPROVED REQUEST #${reqId}`).test(r.out) && new RegExp(`--request ${reqId}`).test(r.out), r.out);
eq('the refused import created nothing', db.listMaps({ customerId: custId }).length, 2);
eq('quota is unchanged by a refused import', db.quotaUsage(custId), { area: 2, place: 0 });

console.log('\n--list-requests');
r = runImporter(['--list-requests']);
check('the queue is printable without a --src', r.code === 0 && /Seam Village/.test(r.out), r.out);
check('it prints the exact fulfil command',
  new RegExp(`--request ${reqId} --src`).test(r.out), r.out);

// ---- the adoption itself ----------------------------------------------------
// Rendering needs the real engine + a real payload, so the DB half of what the
// importer does is asserted directly here; the render path is proven by the
// byte-identical gate (npm run verify).
console.log('\nin-place fulfilment');
{
  const before = db.getMap(reqId);
  db.updateMapIdentity(reqId, { slug: 'seam-village', name: 'Seam Village', subject: 'Seam Village, Cambs' });
  const vid = db.insertVersion({ map_id: reqId, major: 1, minor: 0, note: 'Imported baseline', overrides: {}, storage_key: 'v1.0' });
  db.setCurrentVersion(reqId, vid);
  db.setMapStatus(reqId, 'draft');
  const after = db.getMap(reqId);
  eq('the SAME row is now the built map', after.id, before.id);
  eq('it keeps its owner', after.customer_id, custId);
  eq('it keeps who requested it', after.requested_by, userId);
  eq('it keeps the request note', after.request_note, before.request_note);
  eq('a fulfilled request becomes a draft', after.status, 'draft');
  eq('the subject can be corrected at build time', after.subject, 'Seam Village, Cambs');
  eq('it is out of the build queue', db.listAwaitingBuild().map((m) => m.id), []);
  eq('quota still counts ONE area map for the request', db.quotaUsage(custId).area, 2); // 2 = this + the un-approved row
  check('the built map is not published yet', !after.published_version_id);
}

console.log('\nidentity whitelist');
{
  const m = db.getMap(reqId);
  check('updateMapIdentity ignores anything else', db.updateMapIdentity(reqId, { customer_id: otherCust, kind: 'place', status: 'published' }) === false);
  const same = db.getMap(reqId);
  eq('owner untouched', same.customer_id, m.customer_id);
  eq('kind untouched', same.kind, m.kind);
  eq('status untouched', same.status, m.status);
}

// ===========================================================================
// 2. rollback to a previously published version
// ===========================================================================
console.log('\npublication history');

const { chooseRevertTarget } = await import('../src/publish/index.js');

// A map that has published v1.0, then v1.1 — with v1.2 saved but never published.
const mapId = db.insertMap({ customer_id: custId, slug: 'rollback-town', name: 'Rollback Town', kind: 'area', status: 'draft' });
const versions = {};
for (const [key, minor] of [['v1.0', 0], ['v1.1', 1], ['v1.2', 2]]) {
  versions[key] = db.insertVersion({ map_id: mapId, major: 1, minor, overrides: {}, storage_key: key });
}
db.setCurrentVersion(mapId, versions['v1.2']);

function publish(versionId) {
  const prId = db.insertPublishRequest({ map_id: mapId, version_id: versionId, requested_by: userId, note: 'please publish' });
  db.decidePublishRequest(prId, { status: 'approved', reviewedBy: userId, decisionNote: `reviewed ${versionId}`, evidence: {} });
  const cur = db.getMap(mapId).published_version_id;
  if (cur && cur !== versionId) db.setVersionState(cur, 'superseded');
  db.setVersionState(versionId, 'published');
  db.setPublishedVersion(mapId, versionId);
  db.setMapStatus(mapId, 'published');
}
publish(versions['v1.0']);
publish(versions['v1.1']);

const history = db.listPublishedHistory(mapId);
eq('history lists every published version, newest first', history.map((h) => h.storage_key), ['v1.1', 'v1.0']);
eq('the current pointer is flagged', history.filter((h) => h.is_current).map((h) => h.storage_key), ['v1.1']);
check('a never-published version is absent', !history.some((h) => h.storage_key === 'v1.2'));
eq('the approver and their note are recorded', history[0].decision_note, `reviewed ${versions['v1.1']}`);

// A withdrawn/rejected request must NOT make its version look publishable.
const rejected = db.insertPublishRequest({ map_id: mapId, version_id: versions['v1.2'], requested_by: userId, note: 'x' });
db.decidePublishRequest(rejected, { status: 'rejected', reviewedBy: userId, decisionNote: 'no', evidence: {} });
check('a rejected submission never enters the history',
  !db.listPublishedHistory(mapId).some((h) => h.storage_key === 'v1.2'));

eq('the rollback picker lists the map with a target available',
  db.listPublishedMaps().map((m) => [m.slug, m.pub_key, m.published_versions]),
  [['rollback-town', 'v1.1', 2]]);

console.log('\nchoosing what to serve again');
// Shape mirrors publishedHistoryFor() in server.js.
const shaped = [
  { versionId: versions['v1.1'], version: 'v1.1', isCurrent: true, files: [{ file: 'internal.jpg' }], revertable: false },
  { versionId: versions['v1.0'], version: 'v1.0', isCurrent: false, files: [{ file: 'internal.jpg' }], revertable: true },
];
eq('with no pick, the previous published version is chosen',
  chooseRevertTarget(shaped).target.version, 'v1.0');
eq('an explicit pick is honoured',
  chooseRevertTarget(shaped, versions['v1.0']).target.version, 'v1.0');
eq('the version already published is refused',
  chooseRevertTarget(shaped, versions['v1.1']).code, 409);
eq('a version that was never published is refused',
  chooseRevertTarget(shaped, versions['v1.2']).code, 400);
check('…with a message that says only reviewed versions qualify',
  /only reviewed versions/.test(chooseRevertTarget(shaped, versions['v1.2']).error));
eq('a first-ever publication has nothing to revert to',
  chooseRevertTarget([shaped[0]]).code, 400);
eq('a version whose renders are gone cannot be served',
  chooseRevertTarget([shaped[0], { ...shaped[1], files: [] }], versions['v1.0']).code, 409);
check('…and it says to publish a correction instead',
  /Publish a corrected version through the gate/.test(
    chooseRevertTarget([shaped[0], { ...shaped[1], files: [] }], versions['v1.0']).error));

// ---- the pointer move ------------------------------------------------------
console.log('\nreverting the pointer');
{
  db.setVersionState(db.getMap(mapId).published_version_id, 'superseded');
  db.setVersionState(versions['v1.0'], 'published');
  db.setPublishedVersion(mapId, versions['v1.0']);
  const m = db.getMap(mapId);
  eq('the public pointer moved back', m.pub_key, 'v1.0');
  eq("the editor's head is untouched", m.cur_key, 'v1.2');
  eq('the reverted-away version is no longer published', db.getVersionById(versions['v1.1']).review_state, 'superseded');
  eq('the restored version is published again', db.getVersionById(versions['v1.0']).review_state, 'published');
  eq('v1.1 stays in the history, so it can be re-published or reverted to again',
    db.listPublishedHistory(mapId).map((h) => h.storage_key), ['v1.1', 'v1.0']);
  eq('the picker now offers v1.1 as the target', db.listPublishedMaps()[0].pub_key, 'v1.0');
}

// ---- the route's own guards (server-only, asserted against the source) ------
//
// THE SUBJECT MOVED ON 2026-09-02 and these read src/routes/review.js now: the P4
// section became a Fastify plugin under /api/review (OA-231, Tier 4.4). They are
// still source-level assertions because what they claim is that the handler is
// WRITTEN a particular way — a message it must print, a pure chooser it must call
// rather than inline — and no request can tell you that.
//
// THE GATING ONE CHANGED RATHER THAN MOVED. It used to look for
// `const user = requireApprover` immediately inside the revert handler, which
// stopped being true the moment the guard became the plugin's single preHandler.
// What replaced it is the stronger claim: the plugin declares the guard ONCE, and
// no handler in the file carries a copy — a second call site is how eight guards
// drift apart again. That the door actually refuses is asserted BEHAVIOURALLY, by
// scripts/test-review-plugin.mjs against a running app, with three mutations in
// scripts/prove-red-review-plugin.mjs. Nothing was lost here; the claim was moved
// somewhere a regex cannot reach and strengthened on the way.
console.log('\nroute guards');
{
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/routes/review.js', import.meta.url), 'utf8'));
  // COUNTED IN CODE, NOT IN PROSE. The plugin's header explains the guard and
  // names requireApprover() twice while doing so, so a count over the whole file
  // reads 3 and the check fails for a reason that has nothing to do with the
  // door — this repository has that failure shape written down as "a search that
  // matches its own subject". Comment lines are dropped before counting.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('the review plugin declares the approver guard exactly once, as a preHandler',
    /addHook\('preHandler'[\s\S]{0,160}requireApprover\(req, reply\)/.test(code)
      && (code.match(/requireApprover\(/g) || []).length === 1);
  check('a reason is required', /Please record why you are reverting/.test(src));
  check('an open publish request blocks a revert', /awaiting review\. Decide that request first/.test(src));
  check('the revert is audited', /'version\.revert'/.test(src));
  check('the pure chooser is used, not an inline copy', /chooseRevertTarget\(publishedHistoryFor\(m\)/.test(src));
}

try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all lifecycle checks passed');
process.exit(failures ? 1 : 0);
