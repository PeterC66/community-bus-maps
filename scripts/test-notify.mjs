// Transactional-notification checks (findings B2).
//
//   node scripts/test-notify.mjs        (or: npm run test:notify)
//
// Three things are worth pinning down, and none of them is "does nodemailer
// work" — there is no mail provider in a test run, which is itself the first
// of them:
//
//   1. NO PROVIDER ⇒ NO SEND, AND NO CRASH. EMAIL_PROVIDER is unset in dev and
//      was unset on the host for the first two days of its life. Every send
//      path must be a quiet no-op then, not an exception in the middle of
//      publishing somebody's map.
//   2. WHO IS TOLD. Only the customer's own active users, and never an address
//      at a reserved domain — the seeded demo organisations all use .example,
//      and bouncing mail at them would damage the sending reputation the magic
//      links depend on.
//   3. WHAT IT SAYS. The wording carries the vocabulary the screens now use
//      (update / version / review / publish) and the link to act on.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-notify-'));
process.env.DATA_DIR = scratch;
delete process.env.EMAIL_PROVIDER;
process.env.PUBLIC_BASE_URL = 'https://busmaps.uk';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const { compose, deliverable, recipientsFor, notify, appUrl } = await import('../src/email/notify.js');

console.log('\nNotifications\n');

// --- deliverability ---------------------------------------------------------
check('a real address is deliverable', deliverable('clerk@fenmarsh.gov.uk'));
check('.example is not', !deliverable('clerk@fenmarsh-dc.example'));
check('example.com is not', !deliverable('someone@example.com'));
check('.invalid is not', !deliverable('a@b.invalid'));
check('localhost is not', !deliverable('root@localhost'));
check('nonsense is not', !deliverable('not-an-address'));

// --- who gets told ----------------------------------------------------------
const custId = db.insertCustomer({ name: 'Fenmarsh District Council', type: 'council' });
db.insertUser({ customer_id: custId, email: 'clerk@fenmarsh.gov.uk', role: 'editor' });
const disabledId = db.insertUser({ customer_id: custId, email: 'gone@fenmarsh.gov.uk', role: 'editor' });
db.updateUserAdmin(disabledId, { status: 'disabled' });
db.insertUser({ customer_id: custId, email: 'demo@fenmarsh-dc.example', role: 'editor' });
const otherId = db.insertCustomer({ name: 'Oakfield CTT', type: 'charity' });
db.insertUser({ customer_id: otherId, email: 'coordinator@oakfield.org.uk', role: 'editor' });
db.insertUser({ customer_id: null, email: 'approver@busmaps.uk', role: 'approver' });

eq('only the customer\'s own active, deliverable people', recipientsFor(custId), ['clerk@fenmarsh.gov.uk']);
eq('another customer\'s people are not told', recipientsFor(otherId), ['coordinator@oakfield.org.uk']);
eq('a map with no customer tells nobody', recipientsFor(null), []);

// --- no provider ⇒ no send, no throw ---------------------------------------
const r = await notify('published', {
  customerId: custId, log: { info() {}, warn() {} },
  mapName: 'Fenmarsh', versionKey: 'v2.0', mapUrl: appUrl('/app/maps/7'),
});
eq('nothing is sent without EMAIL_PROVIDER', r, { sent: 0, skipped: 1 });

const none = await notify('published', { customerId: otherId + 999, log: { info() {}, warn() {} }, mapName: 'Nowhere' });
eq('an unknown customer is a quiet no-op', none, { sent: 0, skipped: 0 });

const bad = await notify('not-a-kind', { customerId: custId, log: { info() {}, warn() {} }, mapName: 'Fenmarsh' });
check('an unknown kind is swallowed, not thrown', bad.sent === 0);

// --- wording ----------------------------------------------------------------
const up = compose('update-ready', { mapName: 'Fenmarsh', sourceNote: 'BODS August 2026 refresh', mapUrl: 'https://busmaps.uk/app/maps/7' });
check('update-ready names the map in the subject', /Fenmarsh/.test(up.subject), up.subject);
check('… says nothing is public yet', /nothing is public yet/i.test(up.text), up.text);
check('… carries the link to act on', up.text.includes('https://busmaps.uk/app/maps/7') && up.html.includes('https://busmaps.uk/app/maps/7'));
check('… reserves publishing for the approver', /an approver publishes it/.test(up.text), up.text);

const pubbed = compose('published', { mapName: 'Fenmarsh', versionKey: 'v2.0', mapUrl: 'https://busmaps.uk/app/maps/7', publicUrl: 'https://busmaps.uk/m/fenmarsh' });
check('published names the version', /v2\.0/.test(pubbed.subject), pubbed.subject);
check('… links the public page when there is one', pubbed.text.includes('https://busmaps.uk/m/fenmarsh'));
const unlisted = compose('published', { mapName: 'Fenmarsh', versionKey: 'v2.0', mapUrl: 'https://busmaps.uk/app/maps/7' });
check('… and says so when there is not', /not listed on the public site/.test(unlisted.text), unlisted.text);

const back = compose('sent-back', { mapName: 'Fenmarsh', versionKey: 'v2.0', reason: 'route 5 terminus is wrong', publishedVersion: 'v1.0', mapUrl: 'https://busmaps.uk/app/maps/7' });
check('sent-back quotes the approver\'s reason', /route 5 terminus is wrong/.test(back.text), back.text);
check('… reassures that the public is unaffected', /they still have v1\.0/.test(back.text), back.text);

// A batch run (scripts/accept-publish-batch.mjs) groups several publishes for
// the same customer into one digest instead of one email per map — this is
// the wording that grouping produces, independent of the grouping logic
// itself (which lives server-side in POST /api/admin/notify-published-batch).
const batch = compose('published-batch', {
  maps: [
    { mapName: 'Fenmarsh', versionKey: 'v3.0', mapUrl: 'https://busmaps.uk/app/maps/7' },
    { mapName: 'Oakfield', versionKey: 'v2.0', mapUrl: 'https://busmaps.uk/app/maps/9' },
  ],
});
check('published-batch counts the maps in the subject', /^2 maps published/.test(batch.subject), batch.subject);
check('… names every map', batch.text.includes('Fenmarsh') && batch.text.includes('Oakfield'), batch.text);
check('… links every map', batch.text.includes('https://busmaps.uk/app/maps/7') && batch.text.includes('https://busmaps.uk/app/maps/9'));
const one = compose('published-batch', { maps: [{ mapName: 'Fenmarsh', mapUrl: 'https://busmaps.uk/app/maps/7' }] });
check('singular subject for exactly one map', /^1 map published/.test(one.subject), one.subject);
const empty = compose('published-batch', { maps: [] });
check('an empty batch does not throw', empty.subject === '0 maps published on BusMaps.uk', empty.subject);

check('every email says why it was received', [up, pubbed, back, batch].every((m) => /You are receiving this/.test(m.text)));

// --- escaping (OA-224 Tier 1.2) ------------------------------------------------
// A customer types the map name; an approver types the reason. Before 2026-09-02
// both went into the HTML half of the email unescaped. The control is the text
// half, which must carry the same characters UNescaped -- a fix that escaped both
// would pass a naive 'no < in the output' check and mangle the plain-text part.
{
  const nasty = compose('sent-back', { mapName: 'Fen<b>marsh</b> & "Ely"', versionKey: 'v2.0',
    reason: 'route 5 <script>alert(1)</script> terminus', mapUrl: 'https://busmaps.uk/app/maps/7?a=1&b=2' });
  check('html: a tag in the map name is escaped, not rendered', !nasty.html.includes('<b>') && nasty.html.includes('Fen&lt;b&gt;marsh&lt;/b&gt;'), nasty.html);
  check('html: a script tag in the reason is escaped', !nasty.html.includes('<script>') && nasty.html.includes('&lt;script&gt;'), nasty.html);
  check('html: quotes and ampersands are escaped', nasty.html.includes('&amp; &quot;Ely&quot;'), nasty.html);
  check('html: the action URL is escaped inside its attribute', nasty.html.includes('href="https://busmaps.uk/app/maps/7?a=1&amp;b=2"'), nasty.html);
  check('text: the same characters are NOT escaped in the plain-text part (control)', nasty.text.includes('Fen<b>marsh</b> & "Ely"') && nasty.text.includes('<script>'), nasty.text);
  check('subject: not HTML, so not escaped either (control)', nasty.subject.includes('Fen<b>marsh</b>'), nasty.subject);
  const link = compose('update-ready', { mapName: 'Plain', mapUrl: 'https://busmaps.uk/app/maps/7' });
  check('a plain name and URL come through byte-for-byte', link.html.includes('<strong>') === false && link.html.includes('Plain') && link.html.includes('href="https://busmaps.uk/app/maps/7"'), link.html);
}

// --- links ------------------------------------------------------------------
eq('appUrl uses PUBLIC_BASE_URL without doubling the slash', appUrl('/app/maps/7'), 'https://busmaps.uk/app/maps/7');

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all notification checks passed'}\n`);
process.exit(failures ? 1 : 0);
