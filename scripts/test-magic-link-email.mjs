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

const adviser = magicLinkContent({ link: LINK, kind: 'adviser', mapName: 'Ramsey', to: TO });
const invite = magicLinkContent({ link: LINK, kind: 'invite' });
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

console.log('\nthe two kinds that were already right are untouched');
// THE CONTROL. Every assertion above is about the presence of something; a change
// that simply added the new words to every kind would satisfy all of them.
check('invite does not name a map', !has(invite.subject, 'bus map') && !has(invite.text, 'bus map'), invite.subject);
check('invite keeps its own subject', invite.subject === 'You’ve been invited to BusMaps.uk', invite.subject);
check('signin keeps its own subject', signin.subject === 'Your BusMaps.uk sign-in link', signin.subject);
check('both keep the short footnote', has(invite.text, 'expires shortly') && has(signin.text, 'expires shortly'));
check('neither names the recipient back at them', !has(invite.text, TO) && !has(signin.text, TO));

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

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('Every kind of sign-in email says what its reader needs, and only its reader needs.');
