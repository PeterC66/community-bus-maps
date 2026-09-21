// check-sitemap.mjs — after a deploy, ask a RUNNING site whether the URLs it
// OFFERS a crawler actually answer, and whether each one says which URL it is.
//
// Run from the repository root (no placeholders except the URL, which defaults
// to the live site):
//     npm run check:sitemap
//     npm run check:sitemap -- --base http://127.0.0.1:5180
//     npm run check:sitemap -- --verbose
//
// WHY THIS EXISTS (buses-data OA-284). `check-live-routes.mjs` asks whether every
// route in the table still answers; `test-indexing.mjs` asks what robots.txt says
// and whether each hand-written page carries its own canonical. Neither asks the
// JOIN, and the join is where the fault was: on 2026-09-08 the live sitemap
// advertised 48 URLs, 47 were perfect, and the 48th — /o/busmaps-uk-pilot — served
// the raw shell with no canonical at all and a title identical to the one every
// future organisation page would have.
//
// THE POPULATION IS THE SITEMAP ITSELF, which is the whole point: a URL is in
// scope because this site offers it to Google, so a thirteenth static page or a
// second organisation joins the check on the day it is published and nobody has
// to remember. The judgement is `scripts/lib/sitemap-heads.mjs`, shared with
// `test-sitemap.mjs`, so the laptop and the deployed site cannot come to
// different conclusions about the same rule.
//
// WHAT IT CANNOT SEE, said out loud rather than left to be assumed: with one
// organisation there is nothing for /o/<slug> to be a DUPLICATE of, so the
// duplicate-identity half of the rule is only reported here as an observation
// and is asserted offline, where the test seeds two organisations. A check that
// reports what it did not look at is the difference between a weak check and a
// weak check believed to be strong.
//
// Exit 0 all well, 1 a URL answered wrongly, 2 the script could not do its job
// (a sitemap it could not fetch or parse, or one advertising nothing).
import { arg, has } from './lib/cli.mjs';
import { locsIn, judgeAdvertisedUrl, titleIn, descriptionIn, duplicateIdentities } from './lib/sitemap-heads.mjs';

const BASE = (arg('base') || 'https://busmaps.uk').replace(/\/+$/, '');
const VERBOSE = has('verbose');

let xml;
try {
  const r = await fetch(`${BASE}/sitemap.xml`);
  if (!r.ok) {
    console.error(`\n${BASE}/sitemap.xml answered ${r.status} — this is a check that could not find its subject, not a clean run.`);
    process.exit(2);
  }
  xml = await r.text();
} catch (e) {
  console.error(`\ncannot reach ${BASE}/sitemap.xml at all: ${e.message}`);
  process.exit(2);
}

const locs = locsIn(xml);
if (!locs.length) {
  console.error('\nthe sitemap advertises no URL at all — a checker with no population reports clear about nothing.');
  process.exit(2);
}

console.log(`\nsitemap.xml at ${BASE} advertises ${locs.length} URL(s)`);

// A <loc> on another host is a fault in its own right: the sitemap may only
// advertise URLs for the site it is served from, and an off-host entry is how a
// www/apex mix-up reaches a crawler as two sites rather than one.
const offHost = locs.filter((l) => !l.startsWith(BASE + '/') && l !== BASE);
if (offHost.length) console.log(`off-canonical-host entries: ${offHost.length}`);

const bad = [];
const pages = [];
const lines = [];
for (const loc of locs) {
  let status = 0, contentType = '', html = '';
  try {
    const r = await fetch(loc, { redirect: 'manual' });
    status = r.status;
    contentType = r.headers.get('content-type') || '';
    html = await r.text();
  } catch (e) {
    bad.push([loc, `could not be reached at all: ${e.message}`]);
    lines.push(`  ✗  --  ${loc}`);
    continue;
  }
  // The host test comes first: an off-host <loc> whose page is otherwise perfect
  // is still a fault, and reporting it as "the canonical disagrees" would name
  // the wrong end of the mistake.
  const fault = offHost.includes(loc)
    ? `advertised on a host other than ${BASE}`
    : judgeAdvertisedUrl({ loc, status, contentType, html });
  if (fault) { bad.push([loc, fault]); lines.push(`  ✗ ${String(status).padStart(3)} ${loc}   ${fault}`); }
  else {
    if (/html/i.test(contentType)) pages.push({ loc, title: titleIn(html), description: descriptionIn(html) });
    if (VERBOSE) lines.push(`  ✓ ${String(status).padStart(3)} ${loc}`);
  }
}

if (lines.length) console.log(lines.join('\n'));

// The observation half. It cannot fail the run — with one organisation there is
// nothing to duplicate, so a green here would mean "there was only one page of
// this kind" as often as it means "they differ". test-sitemap.mjs asserts it.
const dupes = duplicateIdentities(pages);
console.log(`\n${pages.length} HTML page(s) read; ${dupes.length === 0
  ? 'no two share a title or a description'
  : `${dupes.length} pair(s) arrive as the same document:\n    ` + dupes.join('\n    ')}`);
console.log('  (the duplicate-identity rule is ASSERTED offline by test-sitemap.mjs, which seeds two organisations;');
console.log('   here it is an observation, because a site with one organisation cannot show the fault.)');

if (bad.length) {
  console.error(`\n✗ ${bad.length} of ${locs.length} advertised URL(s) answered wrongly:`);
  for (const [loc, why] of bad) console.error(`    ${loc} — ${why}`);
  process.exit(1);
}
console.log(`\n✓ every one of the ${locs.length} URLs this site advertises answers, on this host, saying which URL it is.`);
process.exit(0);
