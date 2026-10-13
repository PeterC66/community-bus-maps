// NOTIFICATIONS_PAUSED: the five customer notifications stop, sign-in does not.
//
//   node scripts/test-notifications-paused.mjs
//
// Asked for by Peter on 2026-10-13: pause customer email for some weeks while
// how we operate is reviewed, and still be able to sign in and out. The obvious
// switch, blanking EMAIL_PROVIDER, stops sign-in as well, which is why this one
// exists — so the half that matters most is the sign-in assertion at the end.
//
// HOW A SEND IS SEEN WITHOUT A NETWORK. EMAIL_PROVIDER=resend with no
// RESEND_API_KEY makes every ATTEMPTED send throw before it reaches fetch, and
// src/email/health.js counts each throw. So "was a send attempted" is a counter
// read back, not an inference from `sent: 0` — which no-provider and paused
// would both give, and which would therefore prove nothing.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-notify-paused-'));
process.env.DATA_DIR = scratch;
process.env.EMAIL_PROVIDER = 'resend';
delete process.env.RESEND_API_KEY;
delete process.env.NOTIFICATIONS_PAUSED;
process.env.PUBLIC_BASE_URL = 'https://busmaps.uk';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const db = await import('../src/db/index.js');
const { notify, MANAGED_SILENT_KINDS } = await import('../src/email/notify.js');
const { sendMagicLink } = await import('../src/email/index.js');
const { emailHealth } = await import('../src/email/health.js');
const { notificationsPaused } = await import('../src/config.js');
const { buildWorklist } = await import('../src/worklist/index.js');

const quiet = { info() {}, warn() {} };
const attempts = () => emailHealth().totalFailed;
const heldRows = () => db.listAuditByAction('notify.paused').map((a) => JSON.parse(a.detail_json));
const pausedRow = () => buildWorklist({ baseUrl: 'https://busmaps.uk' }).items.find((i) => i.key === 'notifications-paused');

const custId = db.insertCustomer({ name: 'Fenmarsh District Council', type: 'council' });
db.insertUser({ customer_id: custId, email: 'clerk@fenmarsh.gov.uk', role: 'editor' });

const FIELDS = {
  'update-ready': { mapName: 'Fenmarsh', sourceNote: 'BODS refresh', mapUrl: 'https://busmaps.uk/app/maps/7' },
  'update-ready-batch': { maps: [{ mapName: 'Fenmarsh', mapUrl: 'https://busmaps.uk/app/maps/7' }] },
  published: { mapName: 'Fenmarsh', versionKey: 'v2.0', mapUrl: 'https://busmaps.uk/app/maps/7' },
  'published-batch': { maps: [{ mapName: 'Fenmarsh', versionKey: 'v2.0', mapUrl: 'https://busmaps.uk/app/maps/7' }] },
  'sent-back': { mapName: 'Fenmarsh', versionKey: 'v2.0', reason: 'route 5', publishedVersion: 'v1.0', mapUrl: 'https://busmaps.uk/app/maps/7' },
};

console.log('\nCustomer notifications paused\n');

check('the test covers every customer notification kind', MANAGED_SILENT_KINDS.every((k) => FIELDS[k]) && Object.keys(FIELDS).length === MANAGED_SILENT_KINDS.length,
  `kinds: ${MANAGED_SILENT_KINDS.join(', ')}`);

// --- the harness can see a send: unpaused, a notification IS attempted --------
{
  const before = attempts();
  await notify('published', { customerId: custId, log: quiet, ...FIELDS.published });
  check('not paused: a notification is attempted (so the counter can see a send)', attempts() === before + 1, `attempts ${before} → ${attempts()}`);
  check('not paused: there is no worklist row', !pausedRow());
}

// --- 0 is off ---------------------------------------------------------------
process.env.NOTIFICATIONS_PAUSED = '0';
check('NOTIFICATIONS_PAUSED=0 is not paused', notificationsPaused() === '');
{
  const before = attempts();
  await notify('published', { customerId: custId, log: quiet, ...FIELDS.published });
  check('… and a notification is still attempted', attempts() === before + 1);
}

// --- paused: all five are held back, and each is recorded -------------------
process.env.NOTIFICATIONS_PAUSED = '2026-10-13';
for (const kind of MANAGED_SILENT_KINDS) {
  const before = attempts();
  const rowsBefore = heldRows().length;
  const r = await notify(kind, { customerId: custId, log: quiet, ...FIELDS[kind] });
  check(`paused: ${kind} is not attempted`, attempts() === before, `attempts ${before} → ${attempts()}`);
  check(`… says it was paused, and for how many`, r.paused === true && r.heldBack === 1 && r.sent === 0, JSON.stringify(r));
  const rows = heldRows();
  check(`… and is recorded as notify.paused`, rows.length === rowsBefore + 1 && rows[0].kind === kind && rows[0].customerId === custId
    && rows[0].pausedSince === '2026-10-13' && rows[0].maps.includes('Fenmarsh') && rows[0].subject, JSON.stringify(rows[0]));
}
check('a record holds no address, only the count', !JSON.stringify(heldRows()).includes('@'));

// --- paused: sign-in is NOT ---------------------------------------------------
{
  const before = attempts();
  let threw = false;
  try { await sendMagicLink({ to: 'clerk@fenmarsh.gov.uk', link: 'https://busmaps.uk/api/auth/verify?t=x', kind: 'signin' }); } catch { threw = true; }
  check('paused: a sign-in email IS still attempted', threw && attempts() === before + 1, `attempts ${before} → ${attempts()}`);
  const before2 = attempts();
  try { await sendMagicLink({ to: 'clerk@fenmarsh.gov.uk', link: 'https://busmaps.uk/api/auth/verify?t=y', kind: 'invite', orgName: 'Fenmarsh' }); } catch { /* counted */ }
  check('paused: an invitation IS still attempted', attempts() === before2 + 1);
}

// --- the worklist says so, with what was held back -------------------------
{
  const row = pausedRow();
  check('paused: the worklist carries a row', !!row);
  check('… naming the date it began', row && /since 2026-10-13/.test(row.title), row && row.title);
  check('… counting what was held back', row && /5 notifications have been held back/.test(row.why), row && row.why);
  check('… and naming the customer', row && /Fenmarsh District Council/.test(row.detail), row && row.detail);
}

// --- a later pause does not inherit an earlier one's records ----------------
process.env.NOTIFICATIONS_PAUSED = '2026-12-01';
{
  const row = pausedRow();
  check('a new pause starts its own count', row && /0 notifications have been held back/.test(row.why), row && row.why);
}

delete process.env.NOTIFICATIONS_PAUSED;
console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
