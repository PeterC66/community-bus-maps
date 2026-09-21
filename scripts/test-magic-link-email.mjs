#!/usr/bin/env node
// THE WORDS A STRANGER READS. Until 2026-09-12 nothing in this repository read
// the sign-in emails at all — `test-notify.mjs` covers the transactional
// notifications and stops at the magic link.
//
//   node scripts/test-magic-link-email.mjs        (or: npm run test:magic-link-email)
//
// WHY IT EXISTS. The local adviser's seat (OA-154 D1) reused `kind: 'invite'`,
// the email a customer's first editor gets when their organisation is approved.
// That person is expecting it. A local adviser is a member of the public who
// wrote in about a bus map a fortnight earlier and has applied for nothing, and
// what reached them was an unsolicited bare link with an urgency line, no sender
// name and no mention of the map — the shape of a phishing email, sent to exactly
// the sort of careful person who reports faults. It was found by Peter sending
// one to his own second address and looking at it, which is the only way it could
// have been found: no test, no gate and no type in this codebase can see that an
// email is addressed to the wrong situation.
//
// So this asserts the CONTENT, per kind, and every assertion about the adviser
// email is paired with the same question asked of `invite` — because "the email
// names the map" is only meaningful if the email that must NOT name a map is
// checked too, and because the fix must not quietly rewrite the two kinds that
// were already right.
//
// Pure string assertions: no provider, no network, no database.

import { magicLinkContent } from '../src/email/index.js';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const has = (s, needle) => String(s).includes(needle);

const LINK = 'https://busmaps.uk/auth/verify?token=abc123';
const TO = 'someone@example.com';

const ORG = 'Love’s Farm Community Association';

const adviser = magicLinkContent({ link: LINK, kind: 'adviser', mapName: 'Ramsey', to: TO });
const invite = magicLinkContent({ link: LINK, kind: 'invite', orgName: ORG, to: TO });
const signin = magicLinkContent({ link: LINK, kind: 'signin' });

console.log('\nthe adviser email stands on its own');
check('the subject names the map', has(adviser.subject, 'Ramsey bus map'), adviser.subject);
check('  …and says what the link is for, without asserting something unpublished is waiting',
  /new versions/.test(adviser.subject) && !/before it is published/.test(adviser.subject), adviser.subject);
check('the body names the map too', has(adviser.text, 'Ramsey bus map'), adviser.text.slice(0, 120));
check('it carries the link', has(adviser.text, LINK) && has(adviser.html, LINK));
check('it says what to do when the link has gone stale',
  has(adviser.text, 'gone stale') && has(adviser.text, '/app/login.html'), adviser.text);
check('  …and names the address to re-request with, which is the half a typo would lose',
  has(adviser.text, TO), 'the address is not in the body');
check('it says how long a session lasts, so they know they can come back',
  has(adviser.text, 'for a week') && has(adviser.text, 'does not sign you out'), adviser.text);
check('it gives permission to ignore it', has(adviser.text, 'you can ignore it'), adviser.text);
check('the html is the same content, not a second copy that can drift',
  has(adviser.html, 'Ramsey bus map') && has(adviser.html, TO) && has(adviser.html, '/app/login.html'));

console.log('\nand it does NOT read like the one that caused the trouble');
check('no “You’ve been invited to BusMaps.uk”', !has(adviser.subject, 'invited to BusMaps.uk'), adviser.subject);
check('no bare “expires shortly” urgency line', !has(adviser.text, 'expires shortly'), adviser.text);

console.log('\nthe customer invite stands on its own too (OA-365)');
// IT WAS THE SAME FAULT AS THE ADVISER'S, found three days later and by the same
// method — Peter reading the real thing. Until 2026-09-19 this email was three
// lines that named nobody: not the recipient, not the sender, not the
// organisation the account belongs to. The first person ever sent one had never
// corresponded with this project and read it at a council address.
check('the subject names the organisation', has(invite.subject, ORG), invite.subject);
check('  …and no longer says only “You’ve been invited to BusMaps.uk”',
  invite.subject !== 'You’ve been invited to BusMaps.uk', invite.subject);
check('the body says whose account it is and what the reader is on it',
  has(invite.text, ORG) && has(invite.text, 'as an editor'), invite.text.slice(0, 160));
check('it carries the link', has(invite.text, LINK) && has(invite.html, LINK));
check('it says what to do when the link has gone stale, with the address spelled out',
  has(invite.text, 'gone stale') && has(invite.text, '/app/login.html') && has(invite.text, TO), invite.text);
check('it says how long a session lasts',
  has(invite.text, 'for a week') && has(invite.text, 'does not sign you out'), invite.text);
check('it says what the first screen will be, named as that page names itself',
  has(invite.text, 'My maps'), invite.text);
check('it gives permission to ignore it, and an address to ask a person at',
  has(invite.text, 'you can ignore it') && has(invite.text, 'info@busmaps.uk'), invite.text);
check('no bare “expires shortly” urgency line', !has(invite.text, 'expires shortly'), invite.text);
check('the html is the same content, not a second copy that can drift',
  has(invite.html, ORG) && has(invite.html, TO) && has(invite.html, 'My maps'));

console.log('\nand the two letters stay two letters');
// THE CONTROL, and it is the reason this section is not simply the adviser block
// copied. Every assertion above is about the presence of something, and a change
// that poured the adviser's words into every kind would satisfy all of them. The
// invite must remain about an ORGANISATION and the adviser about a MAP.
check('invite does not name a map', !has(invite.subject, 'bus map') && !has(invite.text, 'bus map'), invite.subject);
check('adviser does not name an organisation', !has(adviser.text, ORG), adviser.subject);
check('signin keeps its own subject', signin.subject === 'Your BusMaps.uk sign-in link', signin.subject);
check('signin keeps the short footnote, because its reader asked for it seconds ago',
  has(signin.text, 'expires shortly'), signin.text);
check('signin still does not name the recipient back at them', !has(signin.text, TO), signin.text);
check('signin is still short', signin.text.split('\n\n').length <= 3, signin.text);

console.log('\nand it degrades rather than lying when it is told less');
// A grant made by a script, or a link built from something that is not a URL,
// must not produce an email that names a map it does not know or points at a
// sign-in page it cannot work out.
const noMap = magicLinkContent({ link: LINK, kind: 'adviser', to: TO });
check('with no map name it says “bus map” rather than “undefined bus map”',
  has(noMap.subject, 'bus map') && !has(noMap.subject, 'undefined'), noMap.subject);
const noLink = magicLinkContent({ link: 'not-a-url', kind: 'adviser', mapName: 'Ramsey', to: TO });
check('with an unparseable link it drops the sign-in URL rather than printing a broken one',
  !has(noLink.text, '/app/login.html') && has(noLink.text, 'ask whoever invited you'), noLink.text);
const noTo = magicLinkContent({ link: LINK, kind: 'adviser', mapName: 'Ramsey' });
check('with no address it does not invite them to type “undefined”', !has(noTo.text, 'undefined'), noTo.text);
// The same three questions of the invite, because `orgName` reaches it from two
// call sites and one of them — the admin add-user screen — can hold no customer
// at all when the new user is a local adviser.
const noOrg = magicLinkContent({ link: LINK, kind: 'invite', to: TO });
check('with no organisation it names none rather than “undefined”',
  !has(noOrg.subject, 'undefined') && !has(noOrg.text, 'undefined'), noOrg.subject);
check('  …and still says everything else it needs to',
  has(noOrg.text, LINK) && has(noOrg.text, 'gone stale') && has(noOrg.text, 'you can ignore it'), noOrg.text);

console.log('\nand it does not promise a non-editor something only an editor gets');
// The admin add-user screen issues this same letter to approvers and admins, who
// DO publish — src/routes/review.js, "the customer who edits never publishes".
// A reassurance that is true for one reader and false for another is the exact
// shape of the fault this action is about, one level down.
const approver = magicLinkContent({ link: LINK, kind: 'invite', orgName: ORG, to: TO, role: 'approver' });
check('an approver is not told a new version is published by us and not by them',
  !has(approver.text, 'not by you'), approver.text);
check('  …and is not called an editor', !has(approver.text, 'as an editor') && !has(approver.text, 'editor’s account'), approver.text);
check('  …while an editor still is', has(invite.text, 'not by you') && has(invite.text, 'as an editor'));

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('Every kind of sign-in email says what its reader needs, and only its reader needs.');
