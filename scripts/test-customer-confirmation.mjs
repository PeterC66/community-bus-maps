// A managed customer's emailed yes is the publish-review evidence (buses-data OA-468).
//
//   node scripts/test-customer-confirmation.mjs   (or: npm run test:customer-confirmation)
//
// THE FINDING. A managed customer is sent nothing by the portal (#402): Peter
// writes to them and they answer him by email. So the one confirmation that
// matters for their map — "yes, publish it" — lives in the correspondence record,
// and until this change the publish decision had nowhere to say it existed. An
// approver could publish a managed map on nobody's word, and the evidence row
// would read exactly like a map the customer had accepted in the editor.
//
// WHAT IS PINNED. The validator's edges (a real date, not in the future, a
// CORR-nnn/nnn reference); the approve route refusing a managed map with no
// confirmation and recording one when given; a non-managed map publishing with
// none and storing no key; the review screen asking for it only when managed;
// and the batch script refusing a malformed --confirmed before any HTTP.
//
// Runs against a throwaway DATA_DIR; no network, no email, no real portal data.

import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-confirm-'));
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

const { validateCustomerConfirmation: v, customerConfirmationGiven, CHECKLIST } = await import('../src/publish/index.js');

// ===========================================================================
console.log('\nvalidateCustomerConfirmation — a real date, not in the future, and a message reference');
const today = new Date('2026-09-27T21:00:00Z');
eq('a good one is recorded as by email, with the date and the reference',
  v({ on: '2026-09-27', ref: 'CORR-012/005' }, { today }), { ok: true, value: { by: 'email', on: '2026-09-27', ref: 'CORR-012/005' } });
eq('a lower-case reference with spaces round it is normalised', v({ on: ' 2026-09-26 ', ref: ' corr-012/005 ' }, { today }).value, { by: 'email', on: '2026-09-26', ref: 'CORR-012/005' });
eq('nothing at all names both fields', v(undefined, { today }), { ok: false, fields: ['on', 'ref'] });
eq('a date that does not exist is refused', v({ on: '2026-02-30', ref: 'CORR-012/005' }, { today }).fields, ['on']);
eq('a date in another format is refused', v({ on: '27/09/2026', ref: 'CORR-012/005' }, { today }).fields, ['on']);
eq('tomorrow is allowed (a UK evening against UTC)', v({ on: '2026-09-28', ref: 'CORR-012/005' }, { today }).ok, true);
eq('the day after tomorrow is refused', v({ on: '2026-09-29', ref: 'CORR-012/005' }, { today }).fields, ['on']);
eq('a thread with no message is refused', v({ on: '2026-09-27', ref: 'CORR-012' }, { today }).fields, ['ref']);
eq('a name in place of a reference is refused', v({ on: '2026-09-27', ref: 'email from the clerk' }, { today }).fields, ['ref']);
eq('a non-string date is refused, not coerced', v({ on: 20260927, ref: 'CORR-012/005' }, { today }).fields, ['on']);
check('an empty pair is "not given"', !customerConfirmationGiven({ on: '', ref: '  ' }));
check('…and half a pair is "given", so it is validated rather than ignored', customerConfirmationGiven({ on: '', ref: 'CORR-001/001' }));

// ===========================================================================
console.log('\nthe approve route — required for a managed customer, recorded when given');

const db = await import('../src/db/index.js');
const store = await import('../src/maps/store.js');
const { app } = await import('../src/server.js');
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

const freeId = db.insertCustomer({ name: 'Free Council', type: 'council' });
const mgdId = db.insertCustomer({ name: 'Managed Parish', type: 'council', plan: 'managed' });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'admin', customer_id: freeId });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: freeId });
const tok = `tok-${Math.random().toString(36).slice(2)}`;
db.insertSession(tok, approverId, sqlPlus(7 * 86_400_000));   // fresh, so step-up is satisfied
const CSRF = 'test-csrf-token-value';
const headers = { cookie: `cbm_session=${tok}; cbm_csrf=${CSRF}`, 'x-csrf-token': CSRF, 'content-type': 'application/json' };

let n = 0;
const pending = (customerId) => {
  n++;
  const mapId = db.insertMap({ customer_id: customerId, slug: `map-${n}`, name: `Map ${n}`, kind: 'area', status: 'draft' });
  const verId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
  const reqId = db.insertPublishRequest({ map_id: mapId, version_id: verId, requested_by: editorId });
  store.ensureMapDirs(mapId);
  return reqId;
};
const ticked = { checklist: Object.fromEntries(CHECKLIST.map((c) => [c.id, true])) };
const approve = (reqId, extra = {}) => app.inject({ method: 'POST', url: `/api/review/${reqId}/approve`, headers, payload: { ...ticked, ...extra } });
const evidenceOf = (reqId) => JSON.parse(db.getPublishRequest(reqId).evidence_json || '{}');
const good = { on: new Date().toISOString().slice(0, 10), ref: 'CORR-012/005' };

const m1 = pending(mgdId);
eq('the review screen is told the map is a managed customer’s',
  (await app.inject({ method: 'GET', url: `/api/review/${m1}`, headers })).json().request.managed, true);
const refused = await approve(m1);
eq('a managed map with no confirmation is refused', refused.statusCode, 400);
eq('…with a code the screen can key on', refused.json().code, 'customer-confirmation');
eq('…and it is still pending, nothing published', db.getPublishRequest(m1).status, 'pending');
const halfRefused = await approve(m1, { customerConfirmed: { on: good.on, ref: 'CORR-012' } });
eq('a managed map with a thread but no message is refused, naming the field', halfRefused.json().fields, ['ref']);
const ok1 = await approve(m1, { customerConfirmed: good });
eq('with the date and the message it publishes', ok1.statusCode, 200);
eq('…and the decision evidence carries the emailed yes', evidenceOf(m1).customerConfirmed, { by: 'email', ...good });
check('…beside the checklist', Object.keys(evidenceOf(m1).checklist || {}).length === CHECKLIST.length);
const decided = (await app.inject({ method: 'GET', url: `/api/review/${m1}`, headers })).json();
eq('the decided request hands it back to the screen', decided.request.evidence.customerConfirmed.ref, 'CORR-012/005');

const f1 = pending(freeId);
eq('a free customer’s map is not flagged managed',
  (await app.inject({ method: 'GET', url: `/api/review/${f1}`, headers })).json().request.managed, false);
eq('a free customer’s map publishes with no confirmation', (await approve(f1)).statusCode, 200);
eq('…and its evidence has no customerConfirmed key rather than a null one', 'customerConfirmed' in evidenceOf(f1), false);
const f2 = pending(freeId);
eq('a free customer’s map given a malformed one is refused, not stored',
  (await approve(f2, { customerConfirmed: { on: 'yesterday', ref: 'CORR-001/001' } })).statusCode, 400);
eq('…and given a good one, records it', ((await approve(f2, { customerConfirmed: good })).statusCode === 200) && evidenceOf(f2).customerConfirmed.on, good.on);

// ===========================================================================
console.log('\nthe screen, the audit row and the batch script');
const ui = readFileSync(path.join(ROOT, 'public', 'app', 'review.js'), 'utf8');
check('the review screen asks for it only on a managed map', ui.includes("${r.managed ? confirmationHtml() : ''}"));
check('…holds the Publish button until both fields are filled', /allChecked = \(\) => boxes\.every\(\(b\) => b\.checked\) && confirmed\(\)/.test(ui));
check('…sends it as customerConfirmed', ui.includes('payload.customerConfirmed = {'));
check('…and the decided view shows it', ui.includes('r.evidence.customerConfirmed'));
const route = readFileSync(path.join(ROOT, 'src', 'routes', 'review.js'), 'utf8');
check('the audit row carries it too', /logAudit\(req, 'version\.publish'[^\n]*customerConfirmed/.test(route));

const batch = path.join(ROOT, 'scripts', 'accept-publish-batch.mjs');
const run = (...a) => spawnSync(process.execPath, [batch, '--reviewed-by', 'Test', '--dry-run', ...a], { encoding: 'utf8', env: { ...process.env, PUBLIC_BASE_URL: 'http://127.0.0.1:9' } });
const bad = run('--confirmed', '31:2026-09-27:CORR-012');
eq('the batch refuses a malformed --confirmed as used wrongly (exit 2)', bad.status, 2);
check('…naming the field', /bad: ref/.test(bad.stderr), bad.stderr);
eq('…and refuses one map named twice', run('--confirmed', '31:2026-09-27:CORR-012/005', '--confirmed', '31:2026-09-26:CORR-012/004').status, 2);
const dry = run('--confirmed', '31:2026-09-27:corr-012/005');
eq('a good one passes the dry run', dry.status, 0);
check('…which says what it would record, normalised', /map 31: would record the customer's yes by email on 2026-09-27 \(CORR-012\/005\)/.test(dry.stdout), dry.stdout);
const bsrc = readFileSync(batch, 'utf8');
check('…and the real run sends it with that map’s approval', bsrc.includes('customerConfirmed: CONFIRMED.get(u.map.id)'));

// ===========================================================================
console.log(failures ? `\n${failures} FAILED\n` : '\nAll customer-confirmation assertions pass.\n');
process.exit(failures ? 1 : 0);
