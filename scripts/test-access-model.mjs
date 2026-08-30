// The access-model round, as assertions (OA-008, OA-183, OA-184; 2026-08-30).
//
//   node scripts/test-access-model.mjs        (or: npm run test:access-model)
//
// Three findings that are one subject — who may SEE a map, and who may still USE
// an account:
//
//   OA-008  a map with no owning organisation is dropped by every public query,
//           however published it says it is, and until now nothing refused the
//           import and no HTTP route could repair it
//   OA-183  user.status was checked only on the way IN, so disabling somebody
//           left the browser session they were holding working indefinitely —
//           the seven-day window SLIDES, so it never even expired
//   OA-184  the documents describing both said something else
//
// EVERY REFUSAL HERE IS PAIRED WITH A CONTROL that makes the identical request
// and is allowed through. A test that only asserts a refusal passes just as well
// when the route is broken for everybody, and that is precisely the mistake this
// round is correcting: `scripts/test-audit-p1.mjs` already covers a disabled
// user SIGNING IN, and would have stayed green through every fault above.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-access-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');

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
  return { status: r.statusCode, json, cookies: r.headers['set-cookie'] };
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
const patch = (url, token, body) => send('PATCH', url, token, body);

const custId = db.insertCustomer({ name: 'Test Council', type: 'council', quota_areas: 4, quota_places: 4 });
const otherCust = db.insertCustomer({ name: 'Other Council', type: 'council', quota_areas: 1, quota_places: 1 });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: custId });
const victimId = db.insertUser({ email: 'victim@example.com', name: 'Victim', role: 'editor', customer_id: custId });
const controlId = db.insertUser({ email: 'control@example.com', name: 'Control', role: 'editor', customer_id: custId });

// ===========================================================================
// OA-183 — a switched-off account stops working
// ===========================================================================
console.log('\nOA-183 — a switched-off account');

// The CONTROL, taken first and on the same route, so that every refusal below
// is demonstrably about the account's status rather than about the route.
const controlTok = openSession(controlId);
eq('an active user reaches /api/me', (await get('/api/me', controlTok)).status, 200);

// 1. The session is opened while the account is ACTIVE and the account is
//    switched off underneath it. That is the whole finding: signing in was
//    always refused, and this is the case nothing looked at.
const victimTok = openSession(victimId);
eq('…and so does the user about to be disabled', (await get('/api/me', victimTok)).status, 200);
db.updateUserAdmin(victimId, { status: 'disabled' });

const refused = await get('/api/me', victimTok);
eq('a disabled account is refused (403)', refused.status, 403);
eq('…with a code the UI can act on', refused.json && refused.json.code, 'account_disabled');
check('…and the message names the account rather than saying "please sign in"',
  !!(refused.json && /switched off/i.test(refused.json.error || '')), JSON.stringify(refused.json));
check('…and the dead cookie is cleared',
  /cbm_session=;|cbm_session=[^;]*;\s*Max-Age=0/i.test(String(refused.cookies || '')), String(refused.cookies));

// 2. The credential destroys itself: the row is gone, so the admin Sessions tab
//    stops listing a phantom and the two-step workaround is unnecessary.
check('…and the session row was deleted', !db.getSession(victimTok));

// 3. Not just /api/me. A route behind a guard refuses the same way — the point
//    of putting the rule at the single site that SETS req.user rather than in
//    the three guards, which /api/me does not use at all.
const victimTok2 = openSession(victimId);
const guarded = await get('/api/maps', victimTok2);
eq('a guarded route refuses a disabled account too', guarded.status, 403);
eq('…with the same code', guarded.json && guarded.json.code, 'account_disabled');
eq('…while the active control still reaches it', (await get('/api/maps', controlTok)).status, 200);

// 4. Logout is exempt as a PROPERTY — /api/auth/ routes only ever end a
//    credential or ask for a new one, and both already refuse a non-active user
//    on their own terms. A disabled person must still be able to clear their
//    own cookie rather than be told 403 by the only route that would help.
const victimTok3 = openSession(victimId);
eq('a disabled account may still log out', (await post('/api/auth/logout', victimTok3, {})).status, 200);

// 5. Disabling THROUGH THE ADMIN ROUTE revokes the sessions in the same action,
//    and reports how many — the count is the point, because the console used to
//    promise that disabling was the audit-preserving equivalent of a delete,
//    which was true about the record and silent about the credential.
const laterId = db.insertUser({ email: 'later@example.com', name: 'Later', role: 'editor', customer_id: custId });
openSession(laterId); openSession(laterId); openSession(laterId);
const adminTok = openSession(adminId);
const disabled = await patch(`/api/admin/users/${laterId}`, adminTok, { status: 'disabled' });
eq('the admin route disables the account', disabled.status, 200);
eq('…and revokes all three of its live sessions', disabled.json && disabled.json.revokedSessions, 3);
check('…and says so in the audit trail', db.listAudit({ limit: 30 }).some((a) => a.action === 'session.revoke-all'));

// 6. …and does NOT revoke on an ordinary edit. Without this the assertion above
//    passes just as well if every save signed everybody out.
const keepId = db.insertUser({ email: 'keep@example.com', name: 'Keep', role: 'editor', customer_id: custId });
openSession(keepId);
const renamed = await patch(`/api/admin/users/${keepId}`, adminTok, { name: 'Keep Renamed' });
eq('renaming a user revokes nothing', renamed.json && renamed.json.revokedSessions, 0);

// 7. The client half. The server's 403 arrives in the middle of a page that was
//    only testing for 401, so every app shell loads the guard that announces it.
//    Asserted rather than remembered: eight script tags is exactly the kind of
//    list that is right on the day it is written.
const SHELLS = readdirSync(path.join(ROOT, 'views', 'app')).filter((f) => f.endsWith('.html'));
check('there are app shells to check', SHELLS.length >= 8, `found ${SHELLS.length}`);
const missingGuard = SHELLS.filter((f) => !readFileSync(path.join(ROOT, 'views', 'app', f), 'utf8').includes('/js/account-guard.js'));
eq('every app shell loads /js/account-guard.js', missingGuard, []);
check('…and the file it loads exists', existsSync(path.join(ROOT, 'public', 'js', 'account-guard.js')));

// ===========================================================================
// OA-008 — a map with no owning organisation
// ===========================================================================
console.log('\nOA-008 — an unowned map');

const mapId = db.insertMap({ customer_id: custId, slug: 'owned-town', name: 'Owned Town', kind: 'area', status: 'published' });
const verId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
db.setPublishedVersion(mapId, verId);
db.setMapPublicListed(mapId, true);

// The control first: the map is genuinely public before anything is done to it.
check('an owned, published, listed map is publicly visible', !!db.getPublicMapBySlug('owned-town'));

// 1. The finding, stated as an assertion. Un-owning it changes NOTHING the map
//    itself reports — status is still published, public_listed is still 1 — and
//    it disappears from the public site anyway, because both public queries
//    JOIN customer. That join is deliberate (a suspended organisation vanishes);
//    it is the NULL that nothing was saying anything about.
db.setMapCustomer(mapId, null);
const unowned = db.getMap(mapId);
eq('un-owning it leaves status=published', unowned.status, 'published');
eq('…and public_listed=1', unowned.public_listed, 1);
check('…and yet it is invisible to the public site', !db.getPublicMapBySlug('owned-town'));
check('…and absent from the public list', !db.listPublicMaps().some((m) => m.slug === 'owned-town'));

// 2. The repair, which was a hand-written UPDATE against the live database until
//    this route existed.
eq('an admin can set the owner over HTTP', (await post(`/api/admin/maps/${mapId}/owner`, adminTok, { customerId: custId })).status, 200);
check('…and the map is publicly visible again', !!db.getPublicMapBySlug('owned-town'));
check('…and it is in the audit trail', db.listAudit({ limit: 30 }).some((a) => a.action === 'map.reassign'));

// 3. Quota is counted per organisation, so moving a map INTO one spends a slot
//    there. Other Council's quota is one area map and it already holds one.
db.insertMap({ customer_id: otherCust, slug: 'their-town', name: 'Their Town', kind: 'area', status: 'draft' });
check('the receiving organisation is at its quota', db.quotaUsage(otherCust).area >= 1);
const overQuota = await post(`/api/admin/maps/${mapId}/owner`, adminTok, { customerId: otherCust });
eq('a move that would overspend quota is refused', overQuota.status, 409);
eq('…with a code', overQuota.json && overQuota.json.code, 'quota');

// 4. …and the refusal is about the QUOTA, not about the route: the same request
//    to an organisation with room goes through.
const roomy = db.insertCustomer({ name: 'Roomy Council', type: 'council', quota_areas: 5, quota_places: 5 });
eq('the same move to an organisation with room is allowed',
  (await post(`/api/admin/maps/${mapId}/owner`, adminTok, { customerId: roomy })).status, 200);

// 5. A non-admin cannot re-home anybody's map.
eq('an editor is refused the owner route',
  (await post(`/api/admin/maps/${mapId}/owner`, controlTok, { customerId: custId })).status, 403);

// 6. The importer refuses rather than warning. Run as a real process, because
//    the finding was that it printed a note and carried on.
const run = (args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-map.mjs'), ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_PATH: path.join(scratch, 'import.sqlite') },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const nowhere = path.join(scratch, 'no-such-dir');
const noOwner = run(['--src', nowhere, '--name', 'Nowhere']);
// The MESSAGE, not the exit code. prove-red-access-model.mjs caught this suite
// asserting `code === 1` first: with the refusal removed the same run still
// exits 1, on "--src not found", and the assertion named for the owner check
// was satisfied by an unrelated failure two lines later. A named failure shape
// in this project's own list — one clause answered by another.
check('the importer refuses a map with no --customer', /refusing to import an unowned map/.test(noOwner.out), noOwner.out.slice(0, 300));
eq('…and exits non-zero', noOwner.code, 1);
// The control: the SAME invocation with an owner gets past the owner check and
// fails on the missing --src instead. Without this the assertion above passes
// just as well if the importer refused everything.
const withOwner = run(['--src', nowhere, '--name', 'Nowhere', '--customer', 'Someone']);
check('…while the same run WITH an owner gets past that check', /--src not found/.test(withOwner.out), withOwner.out.slice(0, 300));
check('…and --unowned is still an explicit way through',
  /--src not found/.test(run(['--src', nowhere, '--name', 'Nowhere', '--unowned']).out));

// ===========================================================================
console.log(failures ? `\n${failures} FAILED\n` : '\nAll access-model assertions pass.\n');
process.exit(failures ? 1 : 0);
