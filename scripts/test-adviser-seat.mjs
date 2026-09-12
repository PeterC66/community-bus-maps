#!/usr/bin/env node
// THE LOCAL ADVISER'S SEAT, as assertions — buses-data OA-154 Phase D1.
//
//   node scripts/test-adviser-seat.mjs        (or: npm run test:adviser-seat)
//
// A local adviser is a member of the public who has been asked for a view on a
// draft bus map. The whole of what the portal owes them is: see the current
// draft of the map they were asked about, and nothing else. So this file is
// mostly refusals — and refusals are the shape of assertion that lies most
// easily, because a route broken for EVERYBODY passes every one of them.
//
// EVERY REFUSAL HERE IS THEREFORE PAIRED WITH A CONTROL that makes the same
// request and is allowed through: the same URL with the owning editor's cookie,
// or the same adviser against the map they DO hold a grant on. That is this
// repository's own rule (scripts/test-access-model.mjs states it), and it is
// worth more here than anywhere else in the suite, because the adviser seat is
// the first thing in this portal whose user is not a customer.
//
// THE FOUR PROPERTIES OA-154 NAMED, in the order it named them: an adviser
// cannot edit, cannot publish, cannot reach another map, and cannot hold a
// `customer_id`. The last is the architectural one — loadOwnedMap() grants EDIT
// to any non-admin whose customer_id matches a map's and never consults role, so
// an adviser carrying one would be an editor of that organisation's whole estate
// — and it is asserted twice over: once against the HTTP route that could set it,
// and once against the database, which refuses it whatever the route believes.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-adviser-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
delete process.env.OPERATOR_TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const store = await import('../src/maps/store.js');
const { app } = await import('../src/server.js');
await app.ready();

const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}-${Math.random().toString(36).slice(2)}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const CSRF = 'test-csrf-token-value';
const get = async (url, token) => {
  const r = await app.inject({ method: 'GET', url, headers: token ? { cookie: `cbm_session=${token}` } : {} });
  let json = null; try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json, body: r.body, headers: r.headers };
};
const send = async (method, url, token, body) => {
  const r = await app.inject({
    method, url, payload: body || {},
    headers: { cookie: `cbm_session=${token}; cbm_csrf=${CSRF}`, 'x-csrf-token': CSRF, 'content-type': 'application/json' },
  });
  let json = null; try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json };
};
const post = (url, token, body) => send('POST', url, token, body);
const del = (url, token) => send('DELETE', url, token);

// ---------------------------------------------------------------------------
// The world: one organisation with two maps, and a second organisation whose map
// the adviser must never see either.
// ---------------------------------------------------------------------------
const custId = db.insertCustomer({ name: 'Ramsey Parish Council', type: 'council', quota_areas: 4, quota_places: 4 });
const otherCust = db.insertCustomer({ name: 'Somewhere Else Council', type: 'council', quota_areas: 1, quota_places: 1 });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: custId });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: custId });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'approver', customer_id: null });

const advisedMap = db.insertMap({ customer_id: custId, slug: 'ramsey', name: 'Ramsey', kind: 'area', subject: 'Ramsey', status: 'draft' });
const otherMapSameCustomer = db.insertMap({ customer_id: custId, slug: 'warboys', name: 'Warboys', kind: 'area', subject: 'Warboys', status: 'draft' });
const otherCustomersMap = db.insertMap({ customer_id: otherCust, slug: 'elsewhere', name: 'Elsewhere', kind: 'area', status: 'draft' });

/* A payload just real enough for the sheet route to have something to serve: the
 * generator file and data file `internal_geographic` requires (resolveGen only
 * asks whether they EXIST), and one rendered sheet carrying the footer line
 * draftStamp.js rewrites.
 *
 * `gen_internal.js` IS A STUB THAT DRAWS NOTHING, and `data/internal.svg` is
 * written beside it because generateSvg() runs the generator and then reads that
 * file — so an editor-side control asking for the map's own detail (which
 * enumerates POIs, which runs it) gets a real 200 rather than a 500 about a
 * missing file. A control that cannot be distinguished from a broken route is
 * not a control. */
const SHEET = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="297mm" height="210mm">'
  + '<rect x="0" y="0" width="297" height="210" fill="#ffffff"/>'
  + '<text x="20" y="30" font-size="6">Buses within Ramsey</text>'
  + '<text x="277" y="200" text-anchor="end" font-size="2.8" fill="#666666">Map version 1.0</text>'
  + '</svg>';
function seedRender(mapId, storageKey) {
  const data = store.mapDataDir(mapId);
  mkdirSync(data, { recursive: true });
  writeFileSync(path.join(data, 'gen_internal.js'), '// fixture: draws nothing; internal.svg is already there\n');
  writeFileSync(path.join(data, 'routes_paths.json'), '{}');
  writeFileSync(path.join(data, 'routes.json'), '{}');
  writeFileSync(path.join(data, 'internal.svg'), SHEET);
  const dir = store.versionDir(mapId, storageKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'internal.svg'), SHEET);
}
const VKEY = 'v1.0';
seedRender(advisedMap, VKEY);
const versionId = db.insertVersion({ map_id: advisedMap, major: 1, minor: 0, note: 'first', overrides_json: '{}', storage_key: VKEY });
db.setCurrentVersion(advisedMap, versionId);

const adminTok = openSession(adminId);
const editorTok = openSession(editorId);
const approverTok = openSession(approverId);

// ===========================================================================
console.log('\nan adviser belongs to no organisation — the property the whole model rests on');
// ===========================================================================
const adviserId = db.insertUser({ email: 'adviser@example.com', name: 'Adviser', role: 'adviser', customer_id: null });
const adviserTok = openSession(adviserId);
eq('the account exists and its customer_id is NULL', db.getUser(adviserId).customer_id, null);

// THE DATABASE, not the route. A check in one handler covers one path; this
// covers every path there will ever be, including a hand-run UPDATE on the live
// box. src/db/guards.js carries the argument.
{
  let refused = false, msg = '';
  try { db.db.prepare('UPDATE user SET customer_id = ? WHERE id = ?').run(custId, adviserId); }
  catch (e) { refused = true; msg = e.message; }
  check('the DATABASE refuses an UPDATE that gives an adviser a customer_id',
    refused && /adviser/i.test(msg), refused ? `refused, but not by the guard: ${msg}` : 'the database accepted it');
  eq('  …and the row is unchanged', db.getUser(adviserId).customer_id, null);
}
{
  let refused = false;
  try { db.insertUser({ email: 'nope@example.com', role: 'adviser', customer_id: custId }); } catch { refused = true; }
  check('the DATABASE refuses an INSERT of one, too — the insert trigger alone is half a guard', refused);
}
// THE CONTROL. The guard must bite on the ROLE and not on the column: an editor
// with a customer_id is the ordinary case and must still be writable.
{
  let ok = true, why = '';
  try { db.db.prepare('UPDATE user SET customer_id = ? WHERE id = ?').run(otherCust, editorId); }
  catch (e) { ok = false; why = e.message; }
  check('CONTROL: an EDITOR may still be moved between organisations', ok, why);
  db.db.prepare('UPDATE user SET customer_id = ? WHERE id = ?').run(custId, editorId);
}

// The HTTP half, on the two routes that could do it.
{
  const r = await post('/api/admin/users', adminTok, { email: 'new-adviser@example.com', role: 'adviser', customerId: custId });
  eq('POST /api/admin/users refuses an adviser WITH an organisation', r.status, 400);
  const c = await post('/api/admin/users', adminTok, { email: 'new-adviser@example.com', role: 'adviser' });
  eq('CONTROL: the same request without one is accepted', c.status, 200);
  eq('  …and the account it made holds no customer_id', c.json.user.customerId, null);
}
{
  const r = await send('PATCH', `/api/admin/users/${adviserId}`, adminTok, { customerId: custId });
  eq('PATCH /api/admin/users/:id refuses giving an existing adviser one', r.status, 400);
  const c = await send('PATCH', `/api/admin/users/${adviserId}`, adminTok, { name: 'Adviser Renamed' });
  eq('CONTROL: an ordinary edit of the same account is accepted', c.status, 200);
}

// THE SAME RULE, ASSERTED ON THE FUNCTION RATHER THAN THROUGH A REQUEST.
//
// loadOwnedMap() opens with a line that refuses an adviser BY ROLE, before it
// looks at any customer id. Every check above makes that line unreachable — the
// database will not let an adviser hold a customer_id, so the customer comparison
// refuses them anyway — and a guard nothing can reach is a guard nothing can
// falsify: delete the line and not one HTTP assertion in this file moves. So it
// is asserted here directly, with a user object the database would never allow to
// exist, which is exactly the state a future bug would create.
{
  const detail = await import('../src/maps/detail.js');
  const impossible = { id: adviserId, role: 'adviser', customer_id: custId };
  eq('loadOwnedMap refuses an adviser whose customer_id matches the map',
    detail.loadOwnedMap(advisedMap, impossible).code, 403);
  eq('loadReadableMap refuses them too', detail.loadReadableMap(advisedMap, impossible).code, 403);
  // CONTROL: the identical object under the role it is written for is admitted,
  // so the refusal above is about the ROLE and not about the fabrication.
  eq('CONTROL: the same customer_id as an editor is admitted',
    detail.loadOwnedMap(advisedMap, { ...impossible, role: 'editor' }).map.id, advisedMap);
}

// ===========================================================================
console.log('\nthe GRANT is the whole of the reach — the role admits nobody to anything');
// ===========================================================================
{
  const before = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  eq('with no grant, an adviser cannot open the map', before.status, 403);
  const list = await get('/api/adviser/maps', adviserTok);
  eq('  …and their list of maps is empty', list.json.maps.length, 0);
}
db.grantAdviser({ mapId: advisedMap, userId: adviserId, grantedBy: adminId, note: 'Wrote in about the 31A' });
{
  const after = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  eq('CONTROL: with the grant, the same request is allowed', after.status, 200);
  eq('  …and names the map they were asked about', after.json.map.name, 'Ramsey');
  eq('  …and says which version they are looking at', after.json.map.version.number, '1.0');
  eq('  …which is a DRAFT, not the published one', after.json.map.version.published, false);
  check('  …and the sheet list is not empty', after.json.map.sheets.length === 1, JSON.stringify(after.json.map.sheets));

  // NOTHING ABOUT THE ORGANISATION. An adviser was asked about a TOWN; the
  // customer's name, branding and quota are none of their business, and the
  // cheapest way to be sure is to look for the name in the whole response.
  check('  …and the response says nothing about the paying organisation',
    !JSON.stringify(after.json).includes('Ramsey Parish Council'), JSON.stringify(after.json));
}

// ===========================================================================
console.log('\nan adviser cannot reach another map — including one of the same customer');
// ===========================================================================
for (const [what, id] of [['another map of the same organisation', otherMapSameCustomer], ["another organisation's map", otherCustomersMap]]) {
  const r = await get(`/api/adviser/maps/${id}`, adviserTok);
  eq(`${what} is refused`, r.status, 403);
}
{
  const r = await get(`/api/adviser/maps/${otherMapSameCustomer}/sheets/internal`, adviserTok);
  eq('and so is its sheet, by the same loader rather than by a second rule', r.status, 403);
}
{
  const list = await get('/api/adviser/maps', adviserTok);
  eq('the list holds exactly the one map they were asked about', list.json.maps.map((m) => m.id), [advisedMap]);
  eq('  …and says the list is theirs rather than an admin overview', list.json.mine, true);
}

// ===========================================================================
console.log('\nan adviser cannot edit, cannot publish, and cannot download');
// ===========================================================================
// Each of these is the route an EDITOR of this map uses every day, asked with the
// adviser's cookie. The control for each is the editor making the same request.
{
  const r = await get(`/api/maps/${advisedMap}`, adviserTok);
  eq('GET /api/maps/:id (the editor detail) is refused', r.status, 403);
  const c = await get(`/api/maps/${advisedMap}`, editorTok);
  eq('CONTROL: the owning editor is allowed', c.status, 200);
}
{
  const r = await post(`/api/maps/${advisedMap}/save`, adviserTok, { overrides: {}, note: 'x' });
  eq('POST /api/maps/:id/save is refused', r.status, 403);
}
{
  const r = await post(`/api/maps/${advisedMap}/preview`, adviserTok, { overrides: {} });
  eq('POST /api/maps/:id/preview is refused', r.status, 403);
}
{
  const r = await post(`/api/maps/${advisedMap}/publish-request`, adviserTok, { note: 'please publish' });
  eq('POST /api/maps/:id/publish-request is refused', r.status, 403);
}
{
  const r = await post(`/api/review/${versionId}/approve`, adviserTok, {});
  eq('POST /api/review/:id/approve is refused', r.status, 403);
  const c = await post(`/api/review/${versionId}/approve`, approverTok, {});
  check('CONTROL: an approver reaches the handler on the same route', c.status !== 403, `${c.status}`);
}
{
  const r = await get(`/api/maps/${advisedMap}/versions/${VKEY}/internal.svg`, adviserTok);
  eq('the per-version FILE route is refused — there is no download of any kind', r.status, 403);
  const c = await get(`/api/maps/${advisedMap}/versions/${VKEY}/internal.svg`, editorTok);
  eq('CONTROL: the owning editor downloads it as before', c.status, 200);
}
{
  const r = await get('/api/admin/summary', adviserTok);
  eq('the admin console is refused', r.status, 403);
  const r2 = await get('/api/review/queue', adviserTok);
  eq('the review queue is refused', r2.status, 403);
}

// ===========================================================================
console.log('\nand the seat refuses everybody else, which is the half a wider role would break');
// ===========================================================================
for (const [who, tok] of [['an editor', editorTok], ['an approver', approverTok]]) {
  const r = await get('/api/adviser/maps', tok);
  eq(`${who} is refused the adviser's list`, r.status, 403);
  const s = await get(`/api/adviser/maps/${advisedMap}/sheets/internal`, tok);
  eq(`${who} is refused the adviser's sheet`, s.status, 403);
}
{
  const r = await get('/api/adviser/maps', null);
  eq('an anonymous caller is refused with 401, not 403', r.status, 401);
}
{
  const r = await get(`/api/adviser/maps/${advisedMap}`, adminTok);
  eq('CONTROL: an admin passes, so the seat can be inspected without signing in as them', r.status, 200);
  const l = await get('/api/adviser/maps', adminTok);
  eq('  …and their list is the maps that HAVE an adviser, flagged as not their own', l.json.mine, false);
  eq('  …which is the one map granted so far', l.json.maps.map((m) => m.id), [advisedMap]);
}

// ===========================================================================
console.log('\nthe sheet is served marked, in both the ways that matter');
// ===========================================================================
{
  const r = await get(`/api/adviser/maps/${advisedMap}/sheets/internal`, adviserTok);
  eq('the sheet is served', r.status, 200);
  check('  …as SVG', String(r.headers['content-type'] || '').includes('image/svg+xml'), String(r.headers['content-type']));
  check('  …never cached, because the working head moves on every save',
    String(r.headers['cache-control'] || '').includes('no-store'), String(r.headers['cache-control']));
  check('  …with the footer line rewritten to say which copy this is',
    /Draft 1\.0/.test(r.body), r.body.slice(0, 200));
  check('  …and NOT still claiming to be a plain version number',
    !/>Map version 1\.0</.test(r.body), 'the draft stamp did not replace the version line');
  check('  …watermarked, so a screenshot of it still says what it is',
    r.body.includes('DRAFT'), 'no watermark layer in the response');
  check('  …and the watermark is inside the document, not appended after it',
    r.body.trim().endsWith('</svg>'), r.body.trim().slice(-80));
}
{
  const r = await get(`/api/adviser/maps/${advisedMap}/sheets/nonsense`, adviserTok);
  eq('a sheet this map does not have is a 404, not a path to read with', r.status, 404);
  const t = await get(`/api/adviser/maps/${advisedMap}/sheets/..%2F..%2Fportal.sqlite`, adviserTok);
  check('and neither is a traversal', t.status === 404 || t.status === 400, `${t.status}`);
}

// ===========================================================================
console.log('\nasking somebody, and stopping asking them');
// ===========================================================================
{
  const r = await post(`/api/admin/maps/${advisedMap}/advisers`, adminTok, { email: 'New.Person@example.com', name: 'New Person', note: 'knows the estate' });
  eq('an admin can ask a new person in one request', r.status, 200);
  eq('  …and it created the account', r.json.created, true);
  const u = db.getUserByEmail('new.person@example.com');
  eq('  …as an adviser', u.role, 'adviser');
  eq('  …with no organisation', u.customer_id, null);
  const g = db.getAdviserGrant(advisedMap, u.id);
  check('  …holding a live grant on the map', !!g, 'no grant row');

  const dup = await post(`/api/admin/maps/${advisedMap}/advisers`, adminTok, { email: 'editor@example.com' });
  eq('asking somebody who already has an EDITOR account is refused', dup.status, 409);

  const listed = await get(`/api/admin/maps/${advisedMap}/advisers`, adminTok);
  eq('the map lists both advisers', listed.json.advisers.length, 2);
}
{
  const before = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  eq('CONTROL: the adviser can still open the map', before.status, 200);
  const r = await del(`/api/admin/maps/${advisedMap}/advisers/${adviserId}`, adminTok);
  eq('the grant can be revoked', r.status, 200);
  const after = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  eq('and then the same request is refused', after.status, 403);
  const sheet = await get(`/api/adviser/maps/${advisedMap}/sheets/internal`, adviserTok);
  eq('  …including the sheet', sheet.status, 403);

  const listed = await get(`/api/admin/maps/${advisedMap}/advisers`, adminTok);
  const row = listed.json.advisers.find((a) => a.userId === adviserId);
  check('the revoked grant is still RECORDED — who saw a draft is asked months later', !!row && !!row.revokedAt,
    JSON.stringify(listed.json.advisers));

  const again = await del(`/api/admin/maps/${advisedMap}/advisers/${adviserId}`, adminTok);
  eq('revoking twice says so rather than pretending', again.status, 404);
}
{
  // Re-granting is the same row, not a second one: one person's history with one
  // map stays one row, which is what makes the list above readable.
  db.grantAdviser({ mapId: advisedMap, userId: adviserId, grantedBy: adminId, note: 'asked again' });
  const listed = await get(`/api/admin/maps/${advisedMap}/advisers`, adminTok);
  eq('re-granting reuses the row rather than making a second', listed.json.advisers.filter((a) => a.userId === adviserId).length, 1);
  const r = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  eq('  …and the adviser is back in', r.status, 200);
}

// ===========================================================================
console.log('\nand when the working head IS the published version, it says so — the ORDINARY case');
// ===========================================================================
// THE FAULT THIS SECTION EXISTS FOR, found on 2026-09-12 by asking what the first
// real grantee would actually see. A map's working head is its published version
// for as long as nobody edits it after publishing, which is true of every map in
// the live estate — so the first thing the seat was ever going to show anybody was
// a published sheet, and the first cut called it "Draft 8.0" in bold, watermarked
// it DRAFT — not published, and told a member of the public not to pass it on.
// Every assertion above passed throughout, because every one of them was about a
// draft. The state nobody tested was the only state that existed.
db.setVersionState(versionId, 'published');
db.setPublishedVersion(advisedMap, versionId);
{
  const r = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  eq('the map still opens', r.status, 200);
  eq('  …and the version reports itself published', r.json.map.version.published, true);
  check('  …and its label says Published, not Draft', /^Published 1\.0/.test(r.json.map.version.label),
    r.json.map.version.label);

  const sheet = await get(`/api/adviser/maps/${advisedMap}/sheets/internal`, adviserTok);
  eq('the sheet is still served', sheet.status, 200);
  check('  …watermarked BusMaps.uk rather than DRAFT', sheet.body.includes('BusMaps.uk'), 'no BusMaps.uk mark');
  check('  …and NOT claiming to be unpublished', !sheet.body.includes('DRAFT'),
    'a published sheet is still stamped DRAFT — the fault this section exists for');
  check('  …with the footer left alone, because a published render carries the plain number',
    />Map version 1\.0</.test(sheet.body), 'the footer of a published version was rewritten');
}
// THE CONTROL, and it is what makes the four rows above mean anything: put the
// version back to a draft and every one of them must flip. Without it, a change
// that simply removed the DRAFT marking altogether would pass this section.
db.setVersionState(versionId, 'draft');
{
  const r = await get(`/api/adviser/maps/${advisedMap}`, adviserTok);
  check('CONTROL: back in draft, the label says Draft again', /^Draft 1\.0/.test(r.json.map.version.label),
    r.json.map.version.label);
  eq('CONTROL: …and it no longer reports itself published', r.json.map.version.published, false);
  const sheet = await get(`/api/adviser/maps/${advisedMap}/sheets/internal`, adviserTok);
  check('CONTROL: …and the sheet is watermarked DRAFT again', sheet.body.includes('DRAFT'), 'no DRAFT mark');
}

// ===========================================================================
console.log('\nand the adviser can get back OUT again');
// ===========================================================================
// Found by Peter on 2026-09-12, using it: Sign out did nothing. The page was the
// only one of ten shells not loading /js/csrf.js, so its logout POST was refused
// 403 by the CSRF hook — and the handler navigated away without reading the
// answer, so it looked like it had worked. Somebody on a shared computer would
// have believed they had signed out.
//
// The shell's script tags are asserted in test-access-model.mjs, across every
// shell, which is where that class of fault belongs. What is asserted HERE is the
// thing an adviser actually does: the round trip, with the header the page now
// sends, ending in a session that is gone.
{
  const outTok = openSession(adviserId);
  eq('CONTROL: the session works before signing out', (await get('/api/me', outTok)).status, 200);
  const bye = await post('/api/auth/logout', outTok, {});
  eq('signing out is accepted', bye.status, 200);
  eq('  …and the session is REALLY gone, which is the half the button could not see', (await get('/api/me', outTok)).status, 401);
  const sheet = await get(`/api/adviser/maps/${advisedMap}/sheets/internal`, outTok);
  eq('  …so the sheet is refused too', sheet.status, 401);
}
{
  // The refusal that WAS happening, asserted from the other side: without the
  // header the hook refuses and the session survives. This is what the page was
  // doing, and it is why the fix is a script tag rather than a wording change.
  const keepTok = openSession(adviserId);
  const r = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: `cbm_session=${keepTok}; cbm_csrf=${CSRF}` } });
  eq('a logout with no CSRF header is refused', r.statusCode, 403);
  eq('  …and leaves the session open — a logout that fails silently is worse than no button',
    (await get('/api/me', keepTok)).status, 200);
}

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('The local adviser can see the version they were asked about, told truthfully what it is, and nothing else.');
process.exit(0);
