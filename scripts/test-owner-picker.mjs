#!/usr/bin/env node
// THE OWNER PICKER IS STILL WIRED UP (buses-data OA-364).
//
//   node scripts/test-owner-picker.mjs        (or: npm run test:owner-picker)
//
// WHY IT EXISTS. `POST /api/admin/maps/:id/owner` was built on 2026-08-30 —
// step-up gated, quota-checked, audited, search-index-bumping, render-
// reconciling — and for a fortnight NOTHING IN THE CLIENT CALLED IT. Every test
// it had passed, because every test it had was on the server side; the missing
// half was the surface, which is the half no server-side test can fail on. It
// was found by an operator trying to hand a customer their first map and
// discovering there was no button.
//
// So this asks the one question those tests could not: is the route REACHED,
// and does the screen that reaches it still handle the answers the route gives?
// It is a join between three files, and every assertion below is about a pair:
//
//   · the client ↔ the route         — something under public/ posts to it
//   · the client ↔ the page          — every element the script drives exists
//   · the client ↔ the route's ANSWERS — the two refusal codes and `restamped`
//
// THE LAST PAIR IS THE OA-362 GUARD. That action's sibling fault was an approve
// button that told the admin "The invite has been emailed" over a response that
// never said whether it had. The route here reports a failed restamp on a 200
// on purpose — "a failure here must be REPORTED rather than swallowed" — so a
// client that ignores `restamped` would tell an admin the sheets are right when
// the server has just said they may not be.
//
// IT IS A TEXTUAL CHECK AND THAT IS ITS LIMIT. It proves the wiring is present,
// not that the picker works; a browser is what proves that. It is here because
// the fault it guards against is DELETION and drift, which text can see.
// prove-red-owner-picker.mjs breaks each assertion in a throwaway copy and
// requires this file to refuse — a check that has never been seen to go red is
// a check nobody should trust.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

// The tree to read. A directory rather than a constant so prove-red can point
// this whole file at a broken copy without touching the real one.
const TREE = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
const read = (rel) => readFileSync(path.join(TREE, rel), 'utf8');

const js = read(path.join('public', 'app', 'editor.js'));
const html = read(path.join('views', 'app', 'editor.html'));
const admin = read(path.join('src', 'routes', 'admin.js'));

console.log('the route is reached from the client');

// The route path as the server declares it, turned into what a client call to
// it must look like. Derived from admin.js rather than typed here, so renaming
// the route on the server side fails this test instead of silently passing it.
const declares = /app\.post\('\/maps\/:id\/owner'/.test(admin);
check('src/routes/admin.js still declares POST /maps/:id/owner', declares,
  'the route has moved or been renamed — this test is now about nothing');

const posts = /fetch\(`\/api\/admin\/maps\/\$\{[^}]+\}\/owner`/.test(js);
check('public/app/editor.js POSTs to /api/admin/maps/<id>/owner', posts,
  'nothing in the editor reaches the route — this is the OA-364 fault returning');

check('and it sends a customerId', /customerId:/.test(js),
  'the route answers 400 without one');

console.log('');
console.log('every element the picker drives exists on the page');

// The POPULATION IS THE SCRIPT, not a list kept here: every $('ownerXxx') the
// client looks up must be an id the page carries. A renamed element is then a
// failure rather than a control that silently does nothing.
const ids = [...js.matchAll(/\$\('(owner[A-Za-z0-9]*)'\)/g)].map((m) => m[1]);
const wanted = [...new Set(ids)].sort();
check('the script looks up at least six owner elements', wanted.length >= 6,
  `found ${wanted.length}: ${wanted.join(', ')}`);
for (const id of wanted) {
  check(`#${id} is in views/app/editor.html`, html.includes(`id="${id}"`));
}
check('the panel is hidden until an admin opens it', /id="ownerPanel"[^>]*\shidden/.test(html),
  'a customer would see the admin control');
check('the confirmation is a dialog of its own', /<dialog id="ownerDialog"/.test(html));

console.log('');
console.log('the confirmation names what a transfer costs');

// The three the action asked for, plus the two the code makes true. Matched on
// the vocabulary each consequence must use, not on whole sentences, so the copy
// can be improved without this going red for the wrong reason.
const dialogCosts = [
  ['the badge on the public sheet', /badge on the public sheet/i],
  ['a quota slot', /-map slots?\b/],
  ['where reports and notifications go', /Spotted a problem\?/],
  ['who can sign in and edit it', /sign-in that edits this map/],
  ['that an unowned map leaves the public site', /unowned map is dropped/],
];
for (const [what, re] of dialogCosts) check(`it names ${what}`, re.test(js));
check('and it asks before acting', /showModal\(\)/.test(js),
  'the picker would move the map on one click');

console.log('');
console.log('the two refusals are handled as refusals, not as failures');

check('a 403 step-up-required is read by CODE', /'step-up-required'/.test(js),
  "the raw sentence would be shown and the admin left not knowing their choice survived");
check('a 409 quota is read by CODE', /code === 'quota'/.test(js),
  'a quota refusal would read as a fault rather than as "raise their quota first"');
check('the step-up warning is shown BEFORE the attempt', /stepUpFresh/.test(js),
  'the admin would compose a transfer they cannot complete');

console.log('');
console.log('success is what the response said, not what was assumed (the OA-362 guard)');

check('the new owner is taken from the response body', /body\.customer/.test(js),
  'reporting the picked option instead is OA-362 exactly');
check('the restamp outcome is read', /restamped/.test(js),
  'the route reports a FAILED restamp on a 200 and the screen would swallow it');
check('a failed restamp names the repair', /restamp-renders\.mjs/.test(js),
  'an admin told only that it failed cannot act on it');
check('the state is re-read after the write', /fetch\(`\/api\/maps\/\$\{MAP_ID\}`\)[\s\S]{0,400}?reread = true/.test(js),
  "the write's own word would be the only evidence");
// A request that never came back may still have been carried out. Saying
// "nothing has changed" there would be a guess presented as a fact.
check('a dropped response does not claim nothing happened', /cannot tell whether the move happened/.test(js));

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('The owner picker reaches the route, and still handles what the route answers.');
