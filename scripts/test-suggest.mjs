#!/usr/bin/env node
// OA-308 tier 3 — the letter a reader sends when nobody publishes a map of their
// town, and the card that carries it.
//
//   node scripts/test-suggest.mjs          (or: npm run test:suggest)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags, no
// placeholders, no database and no network: the subject is two pure modules.
//
// WHAT IS ACTUALLY AT RISK HERE, and so what this file is mostly about. The
// letter's correctness is not a rendering question — it is four promises, and
// three of them fail SILENTLY if they break. A letter that quietly pitches us
// looks fine. A letter offered next to a map we have just linked to looks fine.
// A "we will send this for you" button would look like a feature. So each of the
// four rules in public/js/shared/suggest-letter.mjs has a check here that fails
// when the rule is broken, and several are stated as things that must be ABSENT,
// which is the half a reader of the rendered page would never notice.

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const { suggestionApplies, suggestionLetter, letterPlainText } =
  await import('../public/js/shared/suggest-letter.mjs');
const { directoryCard, directoryBlock } = await import('../public/js/shared/map-card.mjs');
const { searchDirectory } = await import('../src/search/directory.js');

/** The three shapes offerOf() produces, as fixtures — no file, no directory. */
const NONE = {
  authority: 'North Yorkshire Council', status: 'none', url: '', format: '', dated: '',
  towns: [], townsMore: false, landingPage: 'https://example.invalid/buses', checked: '2026-09-11', also: [],
};
const NETWORK = {
  authority: 'Bedford Borough Council', status: 'network', url: 'https://example.invalid/map.pdf',
  format: 'pdf', dated: '2025-04', towns: [], townsMore: false,
  landingPage: 'https://example.invalid/', checked: '2026-09-11', also: [],
};
const TOWNS = {
  authority: 'Essex County Council', status: 'town', url: 'https://example.invalid/towns',
  format: '', dated: '', towns: ['Colchester', 'Harlow'], townsMore: false,
  landingPage: 'https://example.invalid/', checked: '2026-09-11', also: [],
};

console.log('\nrule 4 — no letter where a map of that town already exists');
check('a TOWN hit offers no letter', !suggestionApplies(TOWNS, 'Colchester', 'town').show);
check('an AUTHORITY hit on the same row does offer one', suggestionApplies(TOWNS, 'Essex', 'authority').show,
  'a reader who searched the county cannot be assumed to live in one of the listed towns');
check('an AREA hit offers one', suggestionApplies(NONE, 'Harrogate', 'area').show);
check('an authority that publishes nothing offers one', suggestionApplies(NONE, 'Skipton', 'authority').show);
check('no query, no letter', !suggestionApplies(NONE, '', 'authority').show);
check('town-level maps with no towns named offers none', !suggestionApplies(
  { ...TOWNS, towns: [] }, 'Essex', 'authority').show,
'we cannot write "you publish maps for " with nothing after it');

console.log('\nrule 3 — every claim in the letter comes from the row');
{
  const l = suggestionLetter(NETWORK, 'Bedford');
  check('it names the authority in the salutation', l.body.startsWith('Dear Bedford Borough Council,'));
  check('it names the place asked about', l.body.includes('Bedford'));
  check('it credits the network map it can see', /map of the whole network/.test(l.body));
  check('…with the date the directory recorded, in words', l.body.includes('April 2025'));
  check('it says where the claim came from', l.body.includes('busmaps.uk'));
  check('…and invites a correction', /out of date or wrong/.test(l.body));
  check('it quotes the date we last looked', l.body.includes('11 September 2026'));
  check('the subject line names the place', l.subject === 'A bus map for Bedford');
}
{
  const l = suggestionLetter(NONE, 'Skipton');
  check('an authority with nothing is described as having nothing', /do not publish a bus map of any kind/.test(l.body));
  check('…and no month is invented for a map that does not exist', !/January|February|March|April|May|June|July|August|September|October|November|December 20/.test(
    l.body.replace(/11 September 2026/, '')));
}
{
  const l = suggestionLetter(TOWNS, 'Essex');
  check('an authority with town maps has them listed back to it', l.body.includes('Colchester, Harlow'));
}

console.log('\nrule 2 — the letter does not pitch us, and the pitch says who wrote it');
{
  const l = suggestionLetter(NONE, 'Skipton');
  // The letter may CITE busmaps.uk as where the reader found the authority —
  // that is rule 3, the provenance of its own claim. What it must not do is
  // recommend us as a supplier without saying whose words those are.
  check('the letter body recommends no supplier', !/supplier|commission one from|we could|our maps/i.test(l.body));
  check('the optional paragraph is separate from the body', !l.body.includes(l.extra));
  check('…and it is the one that names us as a supplier', /supplier/i.test(l.extra) && l.extra.includes('busmaps.uk'));
  check('…and it declares itself', /no connection to them/i.test(l.extra));
  check('the copied text is the letter WITHOUT the pitch by default',
    !letterPlainText(l).includes(l.extra));
  check('…and with it only when asked', letterPlainText(l, { withExtra: true }).includes(l.extra));
  check('the copied text carries a subject line', letterPlainText(l).startsWith('Subject: A bus map for Skipton'));
}

console.log('\nrule 1 — the reader sends it, and the markup offers no other way');
{
  const html = directoryCard(NONE, 'The transport authority for this area', { query: 'Skipton', matchKind: 'authority' });
  check('the card carries the letter', html.includes('dir-ask') && html.includes('Dear North Yorkshire Council,'));
  check('it says in as many words that the reader sends it', /You send this, not us/.test(html));
  check('there is no mailto: anywhere in it', !/mailto:/i.test(html),
    'a mailto with a recipient would be us addressing a council on a resident\'s behalf');
  check('there is no form and no submit control', !/<form|type="submit"/i.test(html));
  check('the letter is in the page, not behind a fetch', !/fetch\(|data-src/.test(html));
  check('the copy button starts hidden', /data-copy-letter hidden/.test(html),
    'a button that does nothing without JavaScript is worse than no button');
  check('it uses <details>, which works with JavaScript off', html.includes('<details class="dir-ask"'));
  check('it nudges towards the town or parish council', /town or parish council/.test(html));
}
{
  const html = directoryCard(TOWNS, 'Colchester is in this area', { query: 'Colchester', matchKind: 'town' });
  check('no letter on a row that already maps the place asked for', !html.includes('dir-ask'));
  check('…and the row itself still renders', html.includes('Essex County Council'));
}
{
  const html = directoryCard(NONE, 'a reason');
  check('with no context at all, no letter is offered', !html.includes('dir-ask'),
    'the server and the browser both pass context; a caller that forgets must not silently produce a letter about nowhere');
}

console.log('\nescaping — a council name and a query are both other people\'s text');
{
  const nasty = { ...NONE, authority: 'X <script>alert(1)</script> Council' };
  const html = directoryCard(nasty, '', { query: '<img src=x onerror=1>', matchKind: 'authority' });
  check('the authority name is escaped inside the letter', !html.includes('<script>'));
  check('the query is escaped inside the letter', !html.includes('<img src=x'));
}

console.log('\nthe block passes the match kind through, which is what rule 4 runs on');
{
  // Against the REAL vendored directory, not a fixture: the wire from
  // searchDirectory() to the card is the thing that cannot be checked by
  // driving either end alone.
  const rows = searchDirectory('Colchester');
  check('the real search returns a match kind', rows.length > 0 && !!(rows[0].matched || {}).kind,
    JSON.stringify(rows[0] || null));
  const townHit = rows.find((r) => r.matched.kind === 'town');
  if (townHit) {
    const html = directoryBlock([townHit], { query: 'Colchester', size: 76 });
    check('a real town hit renders with no letter', !html.includes('dir-ask'));
  } else {
    check('a real town hit renders with no letter', false, 'no town hit for Colchester in the vendored directory');
  }
  const county = searchDirectory('Essex').find((r) => r.matched.kind !== 'town');
  check('a real non-town hit renders WITH a letter',
    !!county && directoryBlock([county], { query: 'Essex', size: 76 }).includes('dir-ask'),
    county ? county.offer.authority : 'no non-town hit for Essex');
}

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('✓ all suggestion checks passed');
