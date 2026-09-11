#!/usr/bin/env node
// The national directory of local bus maps, in the place search (buses-data OA-308 tier 2).
//
//   node scripts/test-directory.mjs        (or: npm run test:directory)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags, no
// placeholders, no database and no network: the subject is a vendored JSON file
// and two pure modules.
//
// WHAT THIS CAN AND CANNOT CHECK. It cannot check that the vendored copy matches
// buses-data — a public CI runner has no checkout of a private repository, and a
// check that cannot run is a check that is green for ever. That comparison is
// `npm run sync:directory -- --check` and runs in verify.yml, which already has
// the checkout. What is HERE is everything that needs only this repository: the
// file's shape, the matching rules, and the three promises the rendered card
// makes to a reader about whose map it is.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const { searchDirectory, loadDirectory, offerOf, directorySize, DIRECTORY_FILE } =
  await import('../src/search/directory.js');
const { directoryBlock, directoryCard, noResultBlock, grid, monthGB } =
  await import('../public/js/shared/map-card.mjs');

console.log('\nthe vendored file — shape, not staleness');
const raw = readFileSync(DIRECTORY_FILE, 'utf8');
const doc = JSON.parse(raw);
// THE PROJECTION IS A PRIVACY DECISION, NOT A SIZE ONE, so it is checked here
// rather than left to the sync script's good intentions. Two thirds of the
// source file is our own candid assessment of each council's website, written
// in a private repository; this one is public. If a `note` or a `sources` list
// ever appears here, somebody has copied the file instead of projecting it.
check('no survey note reached this public repository', !/"note"\s*:/.test(raw),
  (raw.match(/"note"[^,]{0,80}/) || [''])[0]);
check('no sources list reached this public repository', !/"sources"\s*:/.test(raw));
check('the projection says what it is and where it came from',
  Array.isArray(doc._comment) && doc._comment.join(' ').includes('PROJECTION'));
check('it lives at public/data/bus-map-directory.json',
  DIRECTORY_FILE === path.join(ROOT, 'public', 'data', 'bus-map-directory.json'), DIRECTORY_FILE);
check('it holds one row per English LTA plus TfL (70 or more)', doc.rows.length >= 70, `${doc.rows.length} rows`);
check('every row names its authority', doc.rows.every((r) => typeof r.lta === 'string' && r.lta.length > 2));
check('every row carries a checked date as YYYY-MM-DD',
  doc.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.checked || '')),
  doc.rows.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.checked || '')).map((r) => r.lta).join('; '));
check('every row has a networkMap status from the vocabulary',
  doc.rows.every((r) => ['yes', 'no', 'unknown'].includes((r.networkMap || {}).status)));
check('every row has a townMaps status from the vocabulary',
  doc.rows.every((r) => ['yes', 'some', 'no', 'unknown'].includes((r.townMaps || {}).status)));
// Not a style rule: an `unknown` row rendered to a reader would say "publishes
// no bus map that we could find" about an authority nobody has actually read.
check('no row still says unknown — an unknown must never reach a reader as a no',
  doc.rows.every((r) => r.networkMap.status !== 'unknown' && r.townMaps.status !== 'unknown'),
  doc.rows.filter((r) => r.networkMap.status === 'unknown' || r.townMaps.status === 'unknown').map((r) => r.lta).join('; '));
check('every map we would link to has an http(s) URL',
  doc.rows.every((r) => {
    const o = offerOf(r);
    return o.status === 'none' || /^https?:\/\//.test(o.url);
  }),
  doc.rows.filter((r) => { const o = offerOf(r); return o.status !== 'none' && !/^https?:\/\//.test(o.url); }).map((r) => r.lta).join('; '));
check('directorySize() agrees with the file', directorySize() === doc.rows.length);
check('the index carries at least one term per row', loadDirectory().terms.length >= doc.rows.length);
check('every covers[] entry is a real area name',
  doc.rows.every((r) => (r.covers || []).every((c) => typeof c === 'string' && c.length > 2)));
check('every alsoPublished[] entry names a publisher, an area, a verified URL and a date',
  doc.rows.every((r) => (r.alsoPublished || []).every((a) => a.publisher && a.covers && /^https?:\/\//.test(a.url || '') && /^\d{4}-\d{2}-\d{2}$/.test(a.checked || ''))),
  doc.rows.filter((r) => (r.alsoPublished || []).some((a) => !a.publisher || !a.covers || !/^https?:\/\//.test(a.url || ''))).map((r) => r.lta).join('; '));

console.log('\nmatching — the authority');
{
  const hit = searchDirectory('Essex');
  check('"Essex" finds Essex County Council', hit.length > 0 && hit[0].offer.authority === 'Essex County Council',
    hit.map((h) => h.offer.authority).join('; '));
  check('…and says why', hit.length > 0 && /transport authority/i.test(hit[0].reason), hit[0] && hit[0].reason);
}
{
  // The whole reason the directory exists: a student asked about York.
  const hit = searchDirectory('York');
  check('"York" finds the York and North Yorkshire Combined Authority',
    hit.some((h) => h.offer.authority === 'York and North Yorkshire Combined Authority'),
    hit.map((h) => h.offer.authority).join('; '));
}
{
  const hit = searchDirectory('Cambridgeshire');
  check('a county name matches its authority', hit.length > 0 && /Cambridgeshire/.test(hit[0].offer.authority),
    hit.map((h) => h.offer.authority).join('; '));
}

console.log('\nmatching — a town the directory records');
{
  const hit = searchDirectory('Loughborough');
  check('"Loughborough" reaches Leicestershire through its town examples',
    hit.some((h) => h.offer.authority === 'Leicestershire County Council'),
    hit.map((h) => h.offer.authority).join('; '));
  check('…and the reason names the town, not the county',
    hit.length > 0 && /Loughborough is in this area/.test(hit.find((h) => h.offer.authority === 'Leicestershire County Council').reason));
}

console.log('\nmatching — an area inside an authority named after somewhere else');
{
  // These three matched NOTHING before covers[] existed, which is the worst
  // possible answer: the reader's own council was abolished into an authority
  // named after a different place, so the page said we had never looked.
  const derbys = searchDirectory('Derbyshire');
  check('"Derbyshire" reaches the East Midlands Combined Authority',
    derbys.some((h) => h.offer.authority === 'East Midlands Combined Authority'),
    derbys.map((h) => h.offer.authority).join('; '));
  check('…and the reason explains the surprise', derbys.length > 0 && /is part of this authority/.test(derbys[0].reason));
  check('"Wigan" reaches Greater Manchester',
    searchDirectory('Wigan').some((h) => h.offer.authority === 'Greater Manchester Combined Authority'));
  check('"Allerdale" reaches Cumberland — a district abolished in 2023',
    searchDirectory('Allerdale').some((h) => h.offer.authority === 'Cumberland Council'));
}

console.log('\nsomebody else publishes one — the York case, which is why this panel exists');
{
  const york = searchDirectory('York').find((h) => h.offer.authority === 'York and North Yorkshire Combined Authority');
  check('the authority row comes back', Boolean(york));
  check('it publishes nothing itself', york && york.offer.status === 'none');
  check('…and carries the map somebody else publishes', york && york.offer.also.length === 1,
    york && JSON.stringify(york.offer.also));
  // Defensive on purpose: when an earlier expectation fails this block must
  // still RUN, or one broken thing hides every check below it. prove-red arm 4
  // found exactly that — the process died on `york.offer` and three later
  // checks were scored as "not red" when they had simply never executed.
  const html = york ? directoryCard(york.offer, york.reason) : '';
  check('the card does NOT leave a York reader with "no bus map"',
    /City of York Council publishes one for York/.test(html));
  check('…as a link they can follow', /href="https:\/\/www\.itravelyork\.info[^"]*"/.test(html));
  check('…with its own last-checked date', /last checked on 11 September 2026/.test(html));
  const southend = searchDirectory('Southend').find((h) => /Southend/.test(h.offer.authority));
  check('Southend is the same shape — the neighbouring authority draws its map',
    southend && southend.offer.also.length === 1 && /Travel Essex/.test(southend.offer.also[0].publisher),
    southend && JSON.stringify(southend.offer.also));
}

console.log('\nmatching — what must NOT match');
{
  check('a query below two characters matches nothing', searchDirectory('y').length === 0);
  check('a nonsense query matches nothing', searchDirectory('zzznotarealplacezzz').length === 0);
  // The honest-miss rule: no place-to-authority dataset here, so a town the
  // directory does not itself name must come back empty rather than be guessed
  // into the nearest county. If this ever goes green by accident, the tier that
  // fixes it properly has landed and this case should be rewritten, not deleted.
  check('a town the directory does not record is a MISS, not a guess', searchDirectory('Harrogate').length === 0,
    searchDirectory('Harrogate').map((h) => h.offer.authority).join('; '));
  check('…and so is a village', searchDirectory('Swavesey').length === 0);
  // Substring matching would make "ton" hit a dozen authorities. It is off.
  check('a bare substring of a name does not match', searchDirectory('ton').length === 0,
    searchDirectory('ton').map((h) => h.offer.authority).join('; '));
}

console.log('\nranking and capping');
{
  const hit = searchDirectory('Essex');
  check('at most three rows come back', searchDirectory('Council').length <= 3);
  check('one authority appears at most once', new Set(hit.map((h) => h.offer.authority)).size === hit.length);
}

console.log('\nan absence is a result');
{
  const hit = searchDirectory('Isle of Wight');
  check('an authority that publishes nothing is still RETURNED by a search',
    hit.some((h) => h.offer.authority === 'Isle of Wight Council'),
    hit.map((h) => `${h.offer.authority} (${h.offer.status})`).join('; '));
  const row = doc.rows.find((r) => r.lta === 'Isle of Wight Council');
  const offer = offerOf(row);
  check('an authority that publishes nothing has status "none"', offer.status === 'none', offer.status);
  const html = directoryCard(offer, 'The transport authority for this area');
  check('…and is still rendered', /Isle of Wight Council/.test(html));
  check('…saying plainly that there is no map', /publishes no bus map/i.test(html), html.slice(0, 200));
  check('…and is not dressed up with an "Open their map" link', !/Open their map/.test(html));
}

console.log('\nthe card keeps its three promises');
{
  const row = doc.rows.find((r) => r.lta === 'Essex County Council');
  const html = directoryCard(offerOf(row), 'The transport authority for this area');
  check('it carries the "Not ours" badge', /badge notours">Not ours</.test(html));
  check('it says "Published by <authority>, last checked on <date>"',
    /Published by Essex County Council, last checked on \d{1,2} \w+ \d{4}/.test(html),
    (html.match(/Published by[^<]*/) || [''])[0]);
  // THIS CHECK USES A DATE THAT IS DELIBERATELY NOT TODAY, and the reason is
  // worth keeping. Written as "the rendered date equals row.checked" it passed
  // even when offerOf() was patched to return `new Date()` — because every row
  // in the directory was checked on the day this was written, so today's date
  // and the data's date were the same string. prove-red-directory.mjs arm 5
  // stayed green and said so. A check comparing two values that happen to be
  // equal today is not a check; see "clock-dependent artefact" in the buses
  // glossary for the same shape on the other side of the estate.
  const backdated = offerOf({ ...row, checked: '2001-02-03' });
  check('the date rendered is the row\'s own, not today\'s',
    /last checked on 3 February 2001/.test(directoryCard(backdated, '')),
    (directoryCard(backdated, '').match(/last checked on [^<]*/) || [''])[0]);
  check('the link is nofollow — we are not vouching for it', /rel="nofollow noopener"/.test(html));
}

console.log('\nthe panel around the cards');
{
  const rows = searchDirectory('Essex');
  const html = directoryBlock(rows, { query: 'Essex', size: doc.rows.length });
  check('it is headed as not ours', /Not ours — what the local transport authority publishes/.test(html));
  check('it says what we checked and what we did not', /checked that each was there on the date shown and nothing more/.test(html));
  check('an empty query renders nothing at all', directoryBlock([], { query: '' }) === '');
  const empty = directoryBlock([], { query: 'Harrogate', size: doc.rows.length });
  check('a miss still tells the reader we looked', /nothing in it matches/.test(empty) && /Harrogate/.test(empty));
  check('…and does not claim there is no map anywhere', /does not prove there is no map/.test(empty));
  check('the reader is told what to search for instead', /county or the authority/.test(empty));
}

console.log('\nthe no-result wording changes when the directory answers');
{
  const alone = noResultBlock('Harrogate', false);
  const withDir = noResultBlock('Essex', true);
  check('with nothing else to offer, the old wording stands', /No published map covers/.test(alone));
  check('with a directory hit, it does not say "no map covers X"', !/No published map covers/.test(withDir));
  check('…it says no map of OURS covers it', /through this portal/.test(withDir));
  check('grid() passes the flag through', /through this portal/.test(grid([], { query: 'Essex', hasDirectory: true }).html));
}

console.log('\ndates read as a British reader writes them');
{
  check('"2026-07" renders as July 2026', monthGB('2026-07') === 'July 2026', monthGB('2026-07'));
  check('a value that is not a month survives unchanged', monthGB('2026') === '2026');
  check('an empty date is empty', monthGB('') === '');
}

console.log('\nHTML escaping — a council name is other people\'s text');
{
  const html = directoryCard({ authority: 'A & B <script>', status: 'none', url: '', towns: [], checked: '2026-09-11', landingPage: '' }, '');
  check('an authority name is escaped', !/<script>/.test(html) && /A &amp; B/.test(html));
}

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all directory checks passed');
process.exit(failures ? 1 : 0);
