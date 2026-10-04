// customer.plan is an enum, and a typo in it can no longer switch a managed
// customer's emails back on (buses-data OA-468's follow-up, 2026-10-04).
//
//   node scripts/test-customer-plan.mjs   (or: npm run test:customer-plan)
//
// WHY THIS SUITE EXISTS. `customer.plan` was a free-text box on the admin
// Customers screen. The one value the code reads is `managed` (src/email/notify.js
// `isManaged()`): it silences five emails and makes a publication ask for the
// customer's emailed yes. So `managd` did not fail — it quietly made a customer
// NON-managed, and the portal then emailed somebody Peter had promised would hear
// only from him. src/db/enums.js now holds the list and a trigger enforces it;
// this file proves the rule bites at every door a value can come through, and
// that the one-off tidy which made it safe to install does what it says.
//
// THE DOORS, in order: the database itself; the helper the admin route calls; the
// admin Customers PATCH; and the approval route, where the choice is now made.
// THE MIGRATION is run for real, in two child processes against one database
// file: the first writes the rows the OLD portal could have written (past the
// guard, by dropping it), the second boots the new code against them. A migration
// tested only on an empty database has never been tested.
//
// Runs against a throwaway DATA_DIR; never touches real portal data, needs no
// network, sends no email.

import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-plan-'));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// ===========================================================================
console.log('\nThe migration: rows the OLD portal could have written, met by the new code');
// ===========================================================================

const migDir = path.join(scratch, 'migration');
const dbUrl = pathToFileURL(path.join(ROOT, 'src/db/index.js')).href;
const childEnv = { ...process.env, DATA_DIR: migDir, DB_PATH: path.join(migDir, 'portal.sqlite'), NODE_ENV: 'test' };
const child = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: childEnv, encoding: 'utf8' });

// Child 1 stands in for the previous release: it creates the schema (importing
// the module installs the guard), then DROPS the guard so it can write what free
// text allowed. Raw SQL, so nothing here depends on the helper under test.
const seed = child(`
  import { mkdirSync } from 'node:fs'; mkdirSync(${JSON.stringify(migDir)}, { recursive: true });
  const { db } = await import(${JSON.stringify(dbUrl)});
  db.exec('DROP TRIGGER IF EXISTS customer_plan_valid_insert; DROP TRIGGER IF EXISTS customer_plan_valid_update;');
  const add = db.prepare("INSERT INTO customer (name, plan) VALUES (?, ?)");
  add.run('Padded Managed', '  Managed ');
  add.run('Loud Free', 'FREE');
  add.run('Typo', 'managd');
  add.run('Plain Managed', 'managed');
  db.close();
`);
eq('the stand-in for the old release wrote its rows', seed.status, 0);
if (seed.status !== 0) console.error(seed.stderr);

const boot = child(`
  const { db } = await import(${JSON.stringify(dbUrl)});
  const rows = db.prepare('SELECT name, plan FROM customer ORDER BY name').all();
  console.log('ROWS ' + JSON.stringify(rows));
  db.close();
`);
eq('the new code boots against them', boot.status, 0);
const rows = JSON.parse((boot.stdout.match(/ROWS (.*)/) || [, '[]'])[1]);
const planOf = (n) => (rows.find((r) => r.name === n) || {}).plan;
eq('"  Managed " becomes managed, which is what isManaged() already read it as', planOf('Padded Managed'), 'managed');
eq('"FREE" becomes free', planOf('Loud Free'), 'free');
eq('an already-canonical row is untouched', planOf('Plain Managed'), 'managed');
eq('a value that is NOT a spelling of a legal one is left exactly as it was, not guessed at', planOf('Typo'), 'managd');
check('…and is named out loud, with the legal list, rather than left silent',
  /customer\.plan holds 1 row\(s\) with the unrecognised value "managd"/.test(boot.stderr) && /free, managed/.test(boot.stderr),
  boot.stderr);

// ===========================================================================
console.log('\nThe database refuses a plan off the list, and accepts both on it');
// ===========================================================================

process.env.DATA_DIR = path.join(scratch, 'live');
process.env.DB_PATH = path.join(scratch, 'live', 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
const { mkdirSync } = await import('node:fs');
mkdirSync(process.env.DATA_DIR, { recursive: true });
const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');
const { isManaged } = await import('../src/email/notify.js');
const { CUSTOMER_PLANS } = await import('../src/db/enums.js');

eq('the list is the two values the code knows', CUSTOMER_PLANS, ['free', 'managed']);

const tryInsert = (plan) => { try { db.insertCustomer({ name: `C-${plan}`, plan }); return null; } catch (e) { return e.message; } };
for (const bad of ['managd', 'Managed', 'managed ', 'paid']) {
  check(`inserting plan ${JSON.stringify(bad)} is refused by the database`,
    /customer\.plan must be one of: free, managed/.test(tryInsert(bad) || ''), String(tryInsert(bad)));
}
// insertCustomer has always read an empty plan as "the default", so '' never
// reaches the guard through it; the guard itself is asked in raw SQL.
let rawEmpty = null;
try { db.db.prepare("INSERT INTO customer (name, plan) VALUES ('Raw Empty', '')").run(); } catch (e) { rawEmpty = e.message; }
check('a raw INSERT of an empty plan is refused by the database', /customer\.plan must be one of: free, managed/.test(rawEmpty || ''), String(rawEmpty));
eq('inserting free is accepted', tryInsert('free'), null);
eq('inserting managed is accepted', tryInsert('managed'), null);
const dflt = db.insertCustomer({ name: 'Default Plan' });
eq('a customer given no plan is free, as before', db.getCustomer(dflt).plan, 'free');

const helperId = db.insertCustomer({ name: 'Helper Target' });
let threw = null; try { db.updateCustomerAdmin(helperId, { plan: 'managd' }); } catch (e) { threw = e.message; }
check('updateCustomerAdmin THROWS on a bad plan rather than quietly dropping it', /must be one of: free, managed/.test(threw || ''), String(threw));
eq('…and nothing was saved', db.getCustomer(helperId).plan, 'free');
db.updateCustomerAdmin(helperId, { plan: 'managed' });
eq('a legal plan saves', db.getCustomer(helperId).plan, 'managed');
check('…and isManaged() reads it as managed', isManaged(helperId) === true);

// ===========================================================================
console.log('\nThe admin Customers screen: a bad plan is a 400 that names the list');
// ===========================================================================

const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const CSRF = 'test-csrf-token-value';
async function call(method, url, session, body) {
  const r = await app.inject({
    method, url,
    headers: { 'content-type': 'application/json', cookie: `cbm_session=${session}; cbm_csrf=${CSRF}`, 'x-csrf-token': CSRF },
    payload: body || {},
  });
  let json = null; try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json, error: (json && json.error) || '' };
}
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: null });
const adminTok = openSession(adminId);

const patchId = db.insertCustomer({ name: 'Patch Target', quota_areas: 2 });
const bad = await call('PATCH', `/api/admin/customers/${patchId}`, adminTok, { plan: 'managd' });
eq('PATCH with a typo is 400', bad.status, 400);
check('…and says what the legal values are', /free, managed/.test(bad.error), bad.error);
eq('…and saved nothing, quota included', [db.getCustomer(patchId).plan, db.getCustomer(patchId).quota_areas], ['free', 2]);
const blank = await call('PATCH', `/api/admin/customers/${patchId}`, adminTok, { plan: '' });
eq('PATCH with an empty plan (the screen\'s "Choose…" left alone) is 400 too', blank.status, 400);
const good = await call('PATCH', `/api/admin/customers/${patchId}`, adminTok, { plan: 'managed', quotaAreas: 3 });
eq('PATCH with managed is 200 — the control, so the refusals above mean something', good.status, 200);
eq('…and saves it', [db.getCustomer(patchId).plan, db.getCustomer(patchId).quota_areas], ['managed', 3]);
const noPlan = await call('PATCH', `/api/admin/customers/${patchId}`, adminTok, { quotaAreas: 4 });
eq('PATCH that does not mention plan leaves it alone', [noPlan.status, db.getCustomer(patchId).plan], [200, 'managed']);

// ===========================================================================
console.log('\nApproval is where the choice is made');
// ===========================================================================

const apply = (org, email) => db.insertApplication({ org_name: org, org_type: 'council', contact_name: 'A Contact', email });

const mgId = apply('Managed Town Council', 'clerk@managed.example');
const mg = await call('POST', `/api/admin/applications/${mgId}/approve`, adminTok, { plan: 'managed' });
eq('approving with plan managed is 200', mg.status, 200);
eq('…and the customer IS managed', db.getCustomerByName('Managed Town Council').plan, 'managed');
check('…so the portal will send it nothing', isManaged(db.getCustomerByName('Managed Town Council').id) === true);

const frId = apply('Default Town Council', 'clerk@default.example');
const fr = await call('POST', `/api/admin/applications/${frId}/approve`, adminTok, {});
eq('approving with no plan is 200, as every caller before this change', fr.status, 200);
eq('…and the customer is free', db.getCustomerByName('Default Town Council').plan, 'free');

const customersBefore = db.listCustomers().length;
const typoId = apply('Typo Town Council', 'clerk@typo.example');
const typo = await call('POST', `/api/admin/applications/${typoId}/approve`, adminTok, { plan: 'managd' });
eq('approving with a typo is 400', typo.status, 400);
check('…naming the legal values', /free, managed/.test(typo.error), typo.error);
eq('…and wrote no customer', db.listCustomers().length, customersBefore);
eq('…and left the application pending', db.getApplication(typoId).status, 'pending');

try { db.db.close(); } catch { /* already closed */ }
try { rmSync(scratch, { recursive: true, force: true }); } catch { /* a leftover temp dir is not a test failure */ }
console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('customer.plan is an enum at every door, and the migration that made it safe does what it says.');
