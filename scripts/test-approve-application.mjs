// Approving an organisation application — the refusals, and the three writes
// underneath them (OA-367, 2026-09-18).
//
//   node scripts/test-approve-application.mjs   (or: npm run test:approve-application)
//
// WHY THIS SUITE EXISTS. POST /api/admin/applications/:id/approve had no test at
// all. Peter met its refusal at the screen on the first real registration: he
// clicked Approve on a second application row for an organisation registered the
// night before and was told `chair@… already has an account. Approve this
// organisation manually or ask them to sign in.` The refusal was right and saved
// him from writing a second customer row for one organisation. Everything it then
// told him was wrong: it reported the PERSON when the fault was the ORGANISATION,
// and "manually" named a screen that has never existed — there is no
// POST /api/admin/customers and no create-customer control anywhere under
// public/ or views/.
//
// SO THE SUBJECT HERE IS WHAT A REFUSAL SAYS, not only that it fires. A 409 is
// easy to assert and says nothing about the fault: both of the refusals below
// were ALREADY 409 before the fix. Each assertion therefore reads the sentence —
// that it names the organisation rather than the person, that it names an action
// its reader can take, and that the word `manually` is gone. The happy path is
// asserted alongside as the control, because a route that refused everything
// would pass a suite of refusals perfectly.
//
// AND THE ARM THAT HAD NEVER BEEN SEEN. The three writes (insertCustomer →
// insertUser → setApplicationReviewed) ran in bare sequence, so a throw between
// the first and the third left an orphan customer with no users and the
// application still pending. That is forced here for real, through the route,
// with a BEFORE INSERT trigger on `user` that ABORTs one address — no stubbing
// and no monkey-patching, so what is exercised is the route's own code path.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-approve-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';

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
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};

const CSRF = 'test-csrf-token-value';
async function post(url, session, body) {
  const r = await app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      cookie: `cbm_session=${session}; cbm_csrf=${CSRF}`,
      'x-csrf-token': CSRF,
    },
    payload: body || {},
  });
  let json = null; try { json = r.json(); } catch { /* not JSON */ }
  return { status: r.statusCode, json, error: (json && json.error) || '' };
}

const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: null });
const adminTok = openSession(adminId);

const apply = (org, email) => db.insertApplication({
  org_name: org, org_type: 'council', contact_name: 'A Contact', email,
});
const customers = () => db.listCustomers().length;
const users = () => db.listUsers().length;

// ===========================================================================
console.log('\nThe control: a new organisation with a new contact still approves');
// ===========================================================================

const goodId = apply('Ely Town Council', 'clerk@ely.example');
const before = { customers: customers(), users: users() };
const good = await post(`/api/admin/applications/${goodId}/approve`, adminTok);
eq('approving a clean application is 200', good.status, 200);
eq('…and writes the customer', customers(), before.customers + 1);
eq('…and its first editor', users(), before.users + 1);
eq('…and marks the application approved', db.getApplication(goodId).status, 'approved');
check('…and the new customer is the one the application named',
  !!db.getCustomerByName('Ely Town Council'), JSON.stringify(db.listCustomers()));
eq('…and the editor belongs to it',
  db.getUserByEmail('clerk@ely.example').customer_id, db.getCustomerByName('Ely Town Council').id);

// ===========================================================================
console.log('\nA duplicate application names the ORGANISATION, and says reject');
// ===========================================================================

// The exact shape Peter met: a second row for an organisation already registered,
// whose contact already has an account because the FIRST approval gave them one.
const dupId = apply('Ely Town Council', 'clerk@ely.example');
const dupBefore = { customers: customers(), users: users() };
const dup = await post(`/api/admin/applications/${dupId}/approve`, adminTok);
eq('a second application for a registered organisation is refused', dup.status, 409);
check('…and the refusal names the ORGANISATION, not the person',
  dup.error.includes('Ely Town Council'), dup.error);
check('…and says it is a duplicate', /duplicate/i.test(dup.error), dup.error);
check('…and tells the operator to reject it', /reject/i.test(dup.error), dup.error);
check('…and identifies the customer that already exists',
  dup.error.includes(`#${db.getCustomerByName('Ely Town Council').id}`), dup.error);
// The sentence that sent Peter looking for a screen that does not exist.
check('…and never says to approve it "manually"', !/manual/i.test(dup.error), dup.error);
eq('…and the refusal wrote no customer', customers(), dupBefore.customers);
eq('…and wrote no user', users(), dupBefore.users);
eq('…and left the application pending', db.getApplication(dupId).status, 'pending');

// THE ORDER IS THE FIX, and this is the assertion that holds it. Both guards
// would fire on the row above — the org is registered AND the email has an
// account — so a route that still asked the email first would pass every
// assertion so far. Here the organisation is a duplicate and the contact is
// somebody new, which only the organisation check can see at all.
const dupNewContactId = apply('Ely Town Council', 'newperson@ely.example');
const dupNewContact = await post(`/api/admin/applications/${dupNewContactId}/approve`, adminTok);
eq('a duplicate organisation with an UNKNOWN contact is refused too', dupNewContact.status, 409);
check('…for the organisation, which is the only fault there is',
  /duplicate/i.test(dupNewContact.error) && dupNewContact.error.includes('Ely Town Council'),
  dupNewContact.error);
eq('…and it wrote nothing', customers(), dupBefore.customers);

// ===========================================================================
console.log('\nA genuine collision is refused honestly, naming nothing that does not exist');
// ===========================================================================

// A NEW organisation whose contact already holds an account elsewhere. This one
// is genuinely not approvable: `user.email` is UNIQUE and a user row carries one
// customer_id, so the data model cannot say "this person is also the first editor
// of a second organisation". The refusal must not invent a way.
const collideId = apply('Soham Town Council', 'clerk@ely.example');
const collideBefore = { customers: customers(), users: users() };
const collide = await post(`/api/admin/applications/${collideId}/approve`, adminTok);
eq('a new organisation with an already-registered contact is refused', collide.status, 409);
check('…and says so of the account, which is the true obstacle here',
  /already has an account/i.test(collide.error), collide.error);
check('…and says plainly that no screen approves it',
  /no screen/i.test(collide.error), collide.error);
check('…and names something the operator CAN do — apply with another address',
  /apply again/i.test(collide.error) && /address/i.test(collide.error), collide.error);
check('…and never says "manually"', !/manual/i.test(collide.error), collide.error);
// A refusal that names a script is the same fault in a new coat, and OA-367 item
// 2 offered it as an option only because the script was believed to exist.
// import-map.mjs --customer creates a customer as a side-effect of importing a
// map and attaches no user; create-admin.mjs refuses an email that already
// exists. Neither does this job, so neither may be named.
check('…and names no script, because none of them does this job',
  !/\.mjs/.test(collide.error) && !/import-map|create-admin|scripts\//.test(collide.error), collide.error);
eq('…and it wrote no customer', customers(), collideBefore.customers);
eq('…and no user', users(), collideBefore.users);
eq('…and left the application pending', db.getApplication(collideId).status, 'pending');

// ===========================================================================
console.log('\nThe partial write: insertUser throws for real, through the route');
// ===========================================================================

// Forced with a trigger rather than a stub, so what runs is the route's own
// three writes against the real database. BEFORE INSERT on `user` means
// insertCustomer has already succeeded when this fires — which is exactly the
// window that used to leave an orphan.
db.db.exec(`
  CREATE TRIGGER test_oa367_block BEFORE INSERT ON user
    WHEN NEW.email = 'doomed@march.example'
    BEGIN SELECT RAISE(ABORT, 'forced by test-approve-application'); END;
`);

const doomedId = apply('March Town Council', 'doomed@march.example');
const doomedBefore = { customers: customers(), users: users() };
const doomed = await post(`/api/admin/applications/${doomedId}/approve`, adminTok);
check(`the request fails rather than half-succeeding (${doomed.status})`, doomed.status >= 500, String(doomed.status));
eq('NO ORPHAN CUSTOMER SURVIVES — the arm that had never been seen', customers(), doomedBefore.customers);
check('…and specifically, the organisation is not registered',
  !db.getCustomerByName('March Town Council'), JSON.stringify(db.listCustomers()));
eq('…and no user was written', users(), doomedBefore.users);
eq('…and the application is still pending, so it can be approved once the cause is fixed',
  db.getApplication(doomedId).status, 'pending');

db.db.exec('DROP TRIGGER test_oa367_block;');

// The control for the whole section: with the trigger gone, the same application
// approves. Without this, "nothing was written" passes just as well if the route
// were broken outright.
const recovered = await post(`/api/admin/applications/${doomedId}/approve`, adminTok);
eq('with the cause removed, the same application approves', recovered.status, 200);
eq('…and now the customer exists', customers(), doomedBefore.customers + 1);
eq('…and the application is approved', db.getApplication(doomedId).status, 'approved');

// ===========================================================================
console.log('\nThe answer says whether the invite was actually emailed (OA-362)');
// ===========================================================================

// WHAT THIS IS ABOUT. The route computed `r.sent`, wrote it to a server console
// and returned `ok: true` either way, so the admin screen said "The invite has
// been emailed" in all three outcomes — including the two where nothing left the
// building. The adviser route one screen away had already been given `emailed`
// and `emailError`; this asserts the approve route now answers the same way.
//
// BOTH ARMS ARE REAL, neither is stubbed. No provider is the state a test run is
// already in; an UNKNOWN provider makes sendEmail() throw by its own declared
// contract, which is the `catch` arm — the one a configured-but-broken Resend
// key produces in production, and the one a green Ops "email ok" chip does not
// rule out.

const noProv = apply('Soham Parish Council', 'clerk@soham.example');
const np = await post(`/api/admin/applications/${noProv}/approve`, adminTok);
eq('with no provider configured the approval still succeeds', np.status, 200);
eq('…and it says no email was sent, rather than claiming one was', np.json.emailed, false);
eq('…and names no error, because not-configured is not a failure', np.json.emailError, null);
check('…and hands back the link, so the operator can send it by hand',
  typeof np.json.inviteLink === 'string' && np.json.inviteLink.includes('/auth/'), JSON.stringify(np.json.inviteLink));
// The audit row is the only record that outlives the process, and it recorded an
// approval with nothing about the send.
check('…and the audit event carries the send outcome',
  JSON.parse(db.listAudit({ limit: 1 })[0].detail_json).emailed === false,
  db.listAudit({ limit: 1 })[0].detail_json);

const savedProvider = process.env.EMAIL_PROVIDER;
process.env.EMAIL_PROVIDER = 'not-a-real-provider';
const threwId = apply('Littleport Parish Council', 'clerk@littleport.example');
const th = await post(`/api/admin/applications/${threwId}/approve`, adminTok);
if (savedProvider === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = savedProvider;
eq('a provider that THROWS does not fail the approval', th.status, 200);
eq('…and the customer is created, because the send is outside the transaction',
  !!db.getCustomerByName('Littleport Parish Council'), true);
eq('…and the answer says nothing was emailed', th.json.emailed, false);
check('…and reports WHY, which the console had only ever logged',
  typeof th.json.emailError === 'string' && /not-a-real-provider/.test(th.json.emailError), JSON.stringify(th.json.emailError));
check('…and still hands back the link', typeof th.json.inviteLink === 'string', JSON.stringify(th.json.inviteLink));

// THE CONTROL THAT STOPS `emailed: false` BEING A CONSTANT, and it is the
// assertion this section is really for. Every arm reachable without a network
// answers false, so a route that hard-coded it would pass all six assertions
// above and the old bug would be back with the suite green.
//
// ONLY THE NETWORK IS FAKED. `globalThis.fetch` is the outermost boundary there
// is — everything inside it is the real path: sendMagicLink → sendEmail →
// sendViaResend → recordSendSuccess → {sent:true} → the route's own `emailed`.
// Nothing is monkey-patched, no module export is replaced, and the assertion is
// what the route returned rather than what a stub was told to say.
{
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.RESEND_API_KEY;
  let fetched = null;
  globalThis.fetch = async (url, opts) => {
    fetched = String(url);
    return { ok: true, status: 200, json: async () => ({ id: 're_test_1' }), text: async () => '' };
  };
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-key-not-a-real-one';
  try {
    const okId = apply('Witchford Parish Council', 'clerk@witchford.example');
    const okr = await post(`/api/admin/applications/${okId}/approve`, adminTok);
    check('CONTROL: the provider was actually reached', /api\.resend\.com/.test(fetched || ''), String(fetched));
    eq('…and when the send reports success, so does the answer', okr.json.emailed, true);
    eq('…and no error is reported', okr.json.emailError, null);
    // THE LIMIT, STATED RATHER THAN PAPERED OVER. `DEV_LINKS` is
    // `!emailProvider()` snapshotted at module load, and at load EMAIL_PROVIDER
    // was unset, so it is ON for this whole process and the link comes back in
    // every arm here. The condition the route added is `DEV_LINKS || !emailed`,
    // and its new half is the not-emailed one — asserted twice above, in both
    // arms that reach it. Whether a DEV_LINKS-off, emailed-true request withholds
    // the link is a property of the OTHER half, unchanged since before OA-362,
    // and it needs a subprocess launched with a provider already in the
    // environment to see at all.
    check('…and the link comes back, DEV_LINKS being on in any test run',
      typeof okr.json.inviteLink === 'string', JSON.stringify(okr.json.inviteLink));
    check('…and the audit event records that it went',
      JSON.parse(db.listAudit({ limit: 1 })[0].detail_json).emailed === true,
      db.listAudit({ limit: 1 })[0].detail_json);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedProvider === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedKey;
  }
}

// ===========================================================================
console.log('\nwithTransaction itself');
// ===========================================================================

const txBefore = customers();
let threw = null;
try {
  db.withTransaction(() => {
    db.insertCustomer({ name: 'Rolled Back Council', type: 'council' });
    db.insertUser({ customer_id: null, email: 'admin@example.com', role: 'editor' }); // UNIQUE collision
  });
} catch (e) { threw = e; }
check('a throw inside propagates to the caller', !!threw, 'nothing threw');
eq('…and everything written before it is rolled back', customers(), txBefore);
check('…including the row itself', !db.getCustomerByName('Rolled Back Council'));

const returned = db.withTransaction(() => db.insertCustomer({ name: 'Committed Council', type: 'council' }));
check('a clean run commits', !!db.getCustomerByName('Committed Council'));
eq('…and hands back what fn returned', returned, db.getCustomerByName('Committed Council').id);

// SQLite has no nested BEGIN. A helper that threw on one would make a caller's
// safety depend on who called it, so an inner call joins the outer transaction
// and the OUTERMOST frame decides — asserted by rolling the outer one back and
// finding the inner write gone with it.
let nestedThrew = null;
try {
  db.withTransaction(() => {
    db.withTransaction(() => db.insertCustomer({ name: 'Inner Council', type: 'council' }));
    throw new Error('outer fails after the inner one "committed"');
  });
} catch (e) { nestedThrew = e; }
check('a nested call does not throw for being nested', nestedThrew && !/transaction/i.test(nestedThrew.message), nestedThrew && nestedThrew.message);
check('…and the outer rollback takes the inner write with it',
  !db.getCustomerByName('Inner Council'), JSON.stringify(db.listCustomers()));

// An async fn would COMMIT at the first await with the work still outstanding —
// a rollback that silently protects nothing. Refused rather than mis-wrapped.
let asyncThrew = null;
try { db.withTransaction(async () => 1); } catch (e) { asyncThrew = e; }
check('an async function is refused, not silently mis-wrapped',
  asyncThrew instanceof TypeError, String(asyncThrew));

// ===========================================================================
if (failures) {
  console.error(`\n✗ ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\n✓ approve-application: every assertion passed.');
