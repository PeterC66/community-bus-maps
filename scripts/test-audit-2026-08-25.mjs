// The P1 block of technical-audit_2026-08-25, as assertions.
//
//   node scripts/test-audit-2026-08-25.mjs
//
//   N3  session and magic-link tokens are stored hashed, and the migration that
//       hashes an existing store does not sign anybody out
//   N8  personal data has a retention window, an exemption for live customers,
//       and an erasure path
//   N7  a state-changing request carrying a cookie needs a CSRF token, and
//       /auth/verify cannot be triggered cross-site
//
// WHY THIS FILE EXISTS SEPARATELY from test-audit-p1.mjs: that one is the 19
// August audit and its findings are closed. Keeping each audit's block as its
// own file means a finding's assertions can be read against the finding, and a
// later reader can tell which rules came from where.
//
// The N3 assertions deliberately go THROUGH the database module rather than
// reading the SQL. The whole finding was that a value was in a table, so the
// only honest test opens the table and looks — a regex over db/index.js would
// certify a `tokenHash(` that had been passed the wrong variable.
//
// Runs against a throwaway DATA_DIR; never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-audit-0825-'));
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

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sqlDatePlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

// ===========================================================================
// N3 — bearer tokens are stored hashed
// ===========================================================================
console.log('\nN3 — no raw bearer token is stored');

const db = await import('../src/db/index.js');
const auth = await import('../src/auth/index.js');
const raw = db.db;

const custId = db.insertCustomer({ name: 'Test Council', type: 'council' });
const userId = db.insertUser({ customer_id: custId, email: 'someone@example.org', name: 'Someone', role: 'admin' });

const SESSION_TOKEN = 'a-known-session-token-for-the-test';
db.insertSession(SESSION_TOKEN, userId, sqlDatePlus(7 * 86_400_000));

const storedSession = raw.prepare('SELECT token FROM session').all().map((r) => r.token);
eq('one session row was written', storedSession.length, 1);
check('the stored value is NOT the token', !storedSession.includes(SESSION_TOKEN),
  'the raw token is still in the table — this is the finding, unfixed');
eq('…it is the token\'s sha256', storedSession[0], sha(SESSION_TOKEN));
check('…and it is 64 hex characters', /^[0-9a-f]{64}$/.test(storedSession[0]));

// The point of hashing is worthless if lookup stopped working, so prove the
// round trip through the same door the request path uses.
const found = db.getSession(SESSION_TOKEN);
check('the session is still found BY THE RAW TOKEN', !!found, 'hashing broke sign-in');
eq('…and resolves the right user', found && found.email, 'someone@example.org');
eq('a token that was never issued finds nothing', db.getSession('not-a-real-token'), undefined);

// listSessions is the admin console's source. It must not be able to hand a
// credential to a screen, which was the shape of the 19 August S5 finding.
const listed = db.listSessions();
eq('listSessions returns one live session', listed.length, 1);
check('…with no field holding the raw token',
  !JSON.stringify(listed).includes(SESSION_TOKEN), 'a raw token reached the sessions list');
eq('…and the handle is unchanged by all this',
  auth.handleFromHash(listed[0].token_hash), auth.sessionHandle(SESSION_TOKEN));

// Revoking by handle has to keep working, and it is the one path that starts
// from a hash rather than a token.
eq('a session revokes by its stored hash', db.deleteSessionByHash(listed[0].token_hash), 1);
eq('…and is then gone', db.getSession(SESSION_TOKEN), undefined);

console.log('\nN3 — magic links too');
const LINK_TOKEN = 'a-known-magic-link-token';
db.insertMagicLink(LINK_TOKEN, 'someone@example.org', sqlDatePlus(15 * 60_000));
const storedLink = raw.prepare('SELECT token FROM magic_link').all().map((r) => r.token);
check('the stored magic-link value is not the token', !storedLink.includes(LINK_TOKEN));
eq('…it is its sha256', storedLink[0], sha(LINK_TOKEN));
const consumed = db.consumeMagicLink(LINK_TOKEN);
check('the link is still consumable by its raw token', !!consumed);
eq('…for the right address', consumed && consumed.email, 'someone@example.org');
eq('…and is single-use', db.consumeMagicLink(LINK_TOKEN), undefined);

console.log('\nN3 — the migration hashes an existing store without signing anyone out');
// Write a raw token straight into the table, exactly as the pre-2026-08-25 code
// did, then re-run the migration and prove BOTH halves: the table no longer
// holds it, and the cookie that user is carrying still works.
const LEGACY = 'legacy-raw-token-written-the-old-way';
raw.prepare('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)')
  .run(LEGACY, userId, sqlDatePlus(7 * 86_400_000));
eq('a legacy raw row is present before the migration',
  raw.prepare('SELECT COUNT(*) c FROM session WHERE token = ?').get(LEGACY).c, 1);
db.hashStoredTokens();
eq('…and is gone afterwards',
  raw.prepare('SELECT COUNT(*) c FROM session WHERE token = ?').get(LEGACY).c, 0);
eq('…replaced by its hash',
  raw.prepare('SELECT COUNT(*) c FROM session WHERE token = ?').get(sha(LEGACY)).c, 1);
check('the user carrying that cookie is STILL SIGNED IN', !!db.getSession(LEGACY),
  'the migration logged everybody out — it should not have to');
// Idempotence is what makes it safe on every boot and on a restored backup.
db.hashStoredTokens();
db.hashStoredTokens();
check('running the migration again changes nothing', !!db.getSession(LEGACY),
  'a second run re-hashed an already-hashed value');
db.deleteSession(LEGACY);

console.log('\nN3 — the migration survives BOOTING against a populated database');
// This is a separate PROCESS on purpose, and it is here because the assertions
// above did not catch a real crash.
//
// hashStoredTokens() runs from the migration IIFE at module load. Everything
// above calls it AFTER the module has finished loading, by which time every
// module-level const exists — so a `const` declared below the function passed
// every assertion here and threw `Cannot access ... before initialization` the
// first time a real server started. It only threw against a database with rows,
// because `[].filter(fn)` never calls fn and a test database starts empty: the
// suite was green and production was dead.
//
// So this seeds a database file with a legacy raw session, then loads the module
// fresh in a child process, which is the only way to test the load path itself.
{
  const { execFileSync } = await import('node:child_process');
  const bootDir = mkdtempSync(path.join(os.tmpdir(), 'cbm-boot-'));
  const bootDb = path.join(bootDir, 'portal.sqlite');
  const seed = `
    process.env.DATA_DIR = ${JSON.stringify(bootDir)};
    process.env.DB_PATH = ${JSON.stringify(bootDb)};
    const db = await import('../src/db/index.js');
    const cid = db.insertCustomer({ name: 'Boot', type: 'council' });
    const uid = db.insertUser({ customer_id: cid, email: 'boot@example.org' });
    db.db.prepare('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run('a-raw-legacy-token', uid, ${JSON.stringify(sqlDatePlus(7 * 86_400_000))});
    console.log('SEEDED');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', seed], { cwd: 'scripts', stdio: 'pipe' });

  let bootOut = '', bootFailed = false;
  try {
    bootOut = execFileSync(process.execPath, ['--input-type=module', '-e',
      `process.env.DATA_DIR = ${JSON.stringify(bootDir)};
       process.env.DB_PATH = ${JSON.stringify(bootDb)};
       const db = await import('../src/db/index.js');
       console.log('BOOTED:' + db.db.prepare('SELECT token FROM session').get().token);`,
    ], { cwd: 'scripts', stdio: 'pipe' }).toString();
  } catch (e) {
    bootFailed = true;
    bootOut = String((e.stderr || '') + (e.stdout || ''));
  }
  check('the module loads against a database holding a legacy raw token',
    !bootFailed, bootOut.split('\n').slice(0, 3).join(' | '));
  eq('…and the migration ran during that load',
    /BOOTED:[0-9a-f]{64}/.test(bootOut), true);
}

// ===========================================================================
// N8 — retention and erasure
// ===========================================================================
console.log('\nN8 — retention');

const oldAppId = db.insertApplication({
  org_name: 'Old Parish Council', org_type: 'authority-council',
  contact_name: 'A Clerk', email: 'clerk@example.org', phone: '01480 000000', wants: 'a map', message: 'hello',
});
const oldMsgId = db.insertMessage({ kind: 'enquiry', name: 'A Person', email: 'person@example.org', body: 'a question' });

// Age them past the window by rewriting created_at — the alternative is a test
// that only passes in 2028.
const ageIt = (table, id, months) =>
  raw.prepare(`UPDATE ${table} SET created_at = datetime('now', ?) WHERE id = ?`).run(`-${months} months`, id);
ageIt('application', oldAppId, 30);
ageIt('message', oldMsgId, 30);

let due = db.retentionDue();
eq('the window is 24 months', due.months, 24);
eq('a 30-month-old application is due', due.applications, 1);
eq('a 30-month-old message is due', due.messages, 1);

// A fresh row must not be swept up with them.
db.insertMessage({ kind: 'enquiry', name: 'Recent', email: 'recent@example.org', body: 'today' });
eq('a message from today is not due', db.retentionDue().messages, 1);

console.log('\nN8 — a live customer\'s application is exempt');
// A customer of its own, with no users, so the "what if the account goes"
// half below can actually delete it — the foreign key from `user` would
// otherwise stop it, which is the constraint doing its job.
const goneCustId = db.insertCustomer({ name: 'Later Closed Council', type: 'council' });
const custAppId = db.insertApplication({
  org_name: 'Later Closed Council', org_type: 'authority-council',
  contact_name: 'Their Clerk', email: 'theirclerk@example.org', wants: 'a map', message: '',
});
raw.prepare('UPDATE application SET customer_id = ? WHERE id = ?').run(goneCustId, custAppId);
ageIt('application', custAppId, 40);
eq('a 40-month-old application belonging to a live customer is NOT due',
  db.retentionDue().applications, 1);

// …and the exemption must end with the account, or it is not a retention
// window at all, it is a permanent exception with a customer_id on it.
raw.prepare('DELETE FROM customer WHERE id = ?').run(goneCustId);
eq('…but becomes due once that customer is gone', db.retentionDue().applications, 2);

const purged = db.purgeExpiredPersonalData();
eq('the purge takes both applications', purged.applications, 2);
eq('…and the one old message', purged.messages, 1);
eq('…and nothing is left due', db.retentionDue(), { months: 24, applications: 0, messages: 0 });
eq('…while today\'s message survives',
  raw.prepare('SELECT COUNT(*) c FROM message').get().c, 1);

console.log('\nN8 — erasure');
db.insertApplication({
  org_name: 'Someone Ltd', org_type: 'other',
  contact_name: 'Data Subject', email: 'Subject@Example.ORG', wants: '', message: '',
});
db.insertMessage({ kind: 'enquiry', name: 'Data Subject', email: 'subject@example.org', body: 'delete me' });

const held = db.personalDataFor('SUBJECT@example.org');
eq('a lookup is case-insensitive across both tables',
  [held.applications.length, held.messages.length], [1, 1]);
eq('…and finds nothing for an unrelated address',
  db.personalDataFor('nobody@example.org').applications.length, 0);

const erased = db.erasePersonalDataFor('subject@example.org');
eq('erasure removes the application and the message', [erased.applications, erased.messages], [1, 1]);
eq('…and a second look finds nothing',
  [db.personalDataFor('subject@example.org').applications.length,
    db.personalDataFor('subject@example.org').messages.length], [0, 0]);
// Whole rows, not blanked fields: a record with the name removed and the free
// text kept is usually still personal data.
eq('…nothing is left behind half-erased',
  raw.prepare("SELECT COUNT(*) c FROM application WHERE lower(email) = 'subject@example.org'").get().c, 0);

// The user table is deliberately untouched — deleting it orphans the audit trail.
eq('erasure does NOT delete the user account',
  raw.prepare('SELECT COUNT(*) c FROM user WHERE id = ?').get(userId).c, 1);

// ===========================================================================
// N7 — CSRF, over real HTTP
// ===========================================================================
console.log('\nN7 — CSRF');

const { app } = await import('../src/server.js');
await app.ready();

const SESSION2 = 'csrf-test-session-token';
db.insertSession(SESSION2, userId, sqlDatePlus(7 * 86_400_000));
const cookieOf = (extra) => `cbm_session=${SESSION2}${extra ? '; ' + extra : ''}`;

const post = (url, headers, payload) =>
  app.inject({ method: 'POST', url, headers: headers || {}, payload: payload ?? {} });

// The shape of the attack: a form on another site POSTs with the victim's
// cookie riding along. It has no way to read the cookie, so it cannot echo it
// in a header — which is the whole of a double-submit defence.
const noToken = await post('/api/auth/logout', { cookie: cookieOf() });
eq('a cookie-authenticated POST with no CSRF header is refused', noToken.statusCode, 403);
check('…and says why', /csrf/i.test(noToken.body), noToken.body.slice(0, 120));

const wrongToken = await post('/api/auth/logout', {
  cookie: cookieOf('cbm_csrf=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  'x-csrf-token': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});
eq('…as is a header that does not match the cookie', wrongToken.statusCode, 403);

const good = 'cccccccccccccccccccccccccccccccc';
const matched = await post('/api/auth/logout', {
  cookie: cookieOf(`cbm_csrf=${good}`),
  'x-csrf-token': good,
});
check('a matching pair is allowed through', matched.statusCode < 400, `got ${matched.statusCode}`);

// A GET must never be gated — that would break every page. A fresh session,
// because the logout above was ALLOWED THROUGH and therefore did its job.
const SESSION3 = 'csrf-test-session-token-2';
db.insertSession(SESSION3, userId, sqlDatePlus(7 * 86_400_000));
const getOk = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `cbm_session=${SESSION3}` } });
eq('a GET with a cookie and no CSRF header is untouched', getOk.statusCode, 200);

console.log('\nN7 — a CSRF cookie is issued to anyone who needs one');
const page = await app.inject({ method: 'GET', url: '/' });
const setCookies = [].concat(page.headers['set-cookie'] || []);
check('the front page hands out a cbm_csrf cookie',
  setCookies.some((c) => c.startsWith('cbm_csrf=')), JSON.stringify(setCookies));
check('…readable by script, or the page could not echo it',
  !setCookies.filter((c) => c.startsWith('cbm_csrf=')).some((c) => /httponly/i.test(c)),
  'HttpOnly on the CSRF cookie makes double-submit impossible');
check('…and SameSite=Lax at least',
  setCookies.filter((c) => c.startsWith('cbm_csrf=')).every((c) => /samesite=lax|samesite=strict/i.test(c)));

console.log('\nN7 — /auth/verify cannot be fired cross-site');
// Login-CSRF: an attacker requests a link for their OWN account, then makes the
// victim's browser follow it, silently signing the victim into the attacker's
// account so that everything they then do is visible to the attacker.
const attackerToken = 'attacker-magic-link-token';
db.insertMagicLink(attackerToken, 'someone@example.org', sqlDatePlus(15 * 60_000));
const crossSite = await app.inject({
  method: 'GET', url: `/auth/verify?token=${attackerToken}`,
  headers: { 'sec-fetch-site': 'cross-site' },
});
check('a cross-site GET to /auth/verify does not open a session',
  !([].concat(crossSite.headers['set-cookie'] || []).some((c) => c.startsWith('cbm_session='))),
  'it set a session cookie — login-CSRF is open');
check('…and the token is not burned by the attempt',
  !!db.db.prepare('SELECT used_at FROM magic_link WHERE token = ?').get(sha(attackerToken)) &&
  db.db.prepare('SELECT used_at FROM magic_link WHERE token = ?').get(sha(attackerToken)).used_at === null,
  'a failed cross-site attempt consumed the real user\'s link — a denial of service');

const sameSite = await app.inject({
  method: 'GET', url: `/auth/verify?token=${attackerToken}`,
  headers: { 'sec-fetch-site': 'none' },
});
check('…while following the link from an email still signs you in',
  [].concat(sameSite.headers['set-cookie'] || []).some((c) => c.startsWith('cbm_session=')),
  `status ${sameSite.statusCode}, ${JSON.stringify(sameSite.headers['set-cookie'] || null)}`);

// ===========================================================================
console.log(`\n${failures ? `✗ ${failures} failure(s)` : '✓ all assertions passed'}`);
process.exitCode = failures ? 1 : 0;
await app.close();
