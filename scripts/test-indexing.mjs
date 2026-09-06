// Indexing policy checks — what /robots.txt actually says, in both flag states.
//
//   node scripts/test-indexing.mjs      (or: npm run test:indexing)
//
// WHY THIS EXISTS. Whether search engines may index this site is one boolean with
// an outsized blast radius in both directions: leave it wrong one way and the site
// nobody was supposed to find is in Google; leave it wrong the other way and a
// launched product is invisible and nobody notices for months, because "no traffic"
// looks exactly like "no interest".
//
// Until 2026-08-21 it was tied to PILOT_MODE and had no test at all. This asserts
// the BYTES a crawler receives, by calling the same function the route calls — not
// by reading the source, which would only certify that the code says what it says.
//
// The negative case matters as much as the positive: `Disallow: /` must APPEAR when
// indexing is off and must be ABSENT when it is on. A test that only ever checks
// the off state passes forever after the flag stops working.

import { robotsTxt } from '../src/public/robots.js';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const SITEMAP = 'https://busmaps.uk/sitemap.xml';
const blocked = robotsTxt({ indexable: false, sitemapUrl: SITEMAP });
const open = robotsTxt({ indexable: true, sitemapUrl: SITEMAP });

console.log('robots.txt — indexing OFF (the default):');
// Exact line, not a substring: "Disallow: /app" also contains "Disallow: /".
const lines = (s) => s.split('\n');
check('blocks the whole site', lines(blocked).includes('Disallow: /'));
check('names a user-agent', lines(blocked).includes('User-agent: *'));
check('still advertises the sitemap', blocked.includes(`Sitemap: ${SITEMAP}`),
  'the sitemap line is what makes this a one-flag revert');
check('ends with a newline', blocked.endsWith('\n'));

console.log('robots.txt — indexing ON:');
check('does NOT block the whole site', !lines(open).includes('Disallow: /'),
  'ALLOW_INDEXING=1 must actually remove the site-wide block');
check('still blocks /app', lines(open).includes('Disallow: /app'));
check('still blocks /auth/', lines(open).includes('Disallow: /auth/'));

// The API is no longer blocked wholesale (technical-audit_2026-08-25 N1): the
// blanket `Disallow: /api/` also covered /api/public/*, the read-only half that
// /maps and /m/<slug>/services were fetching their entire contents from, so the
// site published those pages in sitemap.xml and forbade crawlers to fetch what
// filled them. Both assertions below matter, and the SECOND one is the one worth
// having — a future tidy-up that restores the blanket rule would keep the first
// and break the second.
check('blocks each PRIVATE api prefix', ['/api/admin', '/api/auth', '/api/maps', '/api/me', '/api/review']
  .every((p) => lines(open).includes(`Disallow: ${p}`)));
check('does NOT block the public read API', !lines(open).includes('Disallow: /api/'),
  '/api/public/* must stay fetchable — see src/public/robots.js');
check('still advertises the sitemap', open.includes(`Sitemap: ${SITEMAP}`));

console.log('the flag is the ONLY difference:');
// Everything except the site-wide block must be byte-identical between the two.
// This is what stops a future edit from quietly making the "open" variant drop a
// protection that the "blocked" variant still has.
check('the two differ by exactly the one line',
  lines(blocked).filter((l) => l !== 'Disallow: /').join('\n') === open,
  `blocked-minus-that-line:\n${lines(blocked).filter((l) => l !== 'Disallow: /').join('\n')}\n---\nopen:\n${open}`);

console.log('default is the private state:');
// Read the real config module the server reads, with the env var absent.
delete process.env.ALLOW_INDEXING;
const { INDEXING } = await import('../src/config.js');
check('INDEXING.allowed is false when ALLOW_INDEXING is unset', INDEXING.allowed === false,
  `got ${INDEXING.allowed}`);

// ---------------------------------------------------------------------------
// WHAT A CRAWLER FINDS ONCE IT IS LET IN (buses-data OA-172, added 2026-08-31).
//
// robots.txt above decides WHETHER it may look. These decide what it finds when
// it does, and they are the same failure shape three times over: a rule written
// in a comment and enforced by nobody.
//
//   The site answers on www and on the apex alike. The Caddyfile now 308s www to
//   the apex (scripts/test-caddyfile.mjs asserts that half), and every page also
//   says where it really lives, because a canonical is what a page copied from
//   another page inherits and a proxy rule is not.
//
//   `/background.html` shipped in portal #176 at 14:03 on 2026-08-31, went into
//   the footer of all sixteen pages, and was in no sitemap four hours later. The
//   comment above STATIC_PAGES had said since P6 that "every public page that is
//   linked from the footer" is in the list. It was true when it was written,
//   stated nowhere a machine could read it, and false by the end of that day.
//
//   The application log strips the query string off three route prefixes. Two of
//   them hide a search term; the third hides a live sign-in credential. And since
//   2026-09-06 (buses-data OA-086 phase 1) it masks the visitor's address, which
//   is the one thing on a request line that is personal data on EVERY request
//   rather than on a few routes. It is asserted TWICE and the second time is the
//   one that matters: once through maskIp() on its own, and once through
//   loggableReq(), the function src/server.js hands to Fastify — because "the
//   masker works" and "the log line comes out masked" are different claims, and
//   the wire between them was a call inside a config object no test could reach
//   until the serialiser was moved out of server.js on 2026-09-06.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { STATIC_PAGES, PAGE_FILES, SERVER_FILLED_SHELLS, canonicalFor } from '../src/public/staticPages.js';
import { loggableUrl, maskIp, loggableReq } from '../src/public/logRedaction.js';
import { FOOTER_HTML } from './lib/site-chrome.mjs';

const BASE = 'https://busmaps.uk';
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const read = (f) => readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
const canonicalsIn = (html) => [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => m[1]);

console.log('every static page says where it really lives:');
for (const p of STATIC_PAGES) {
  const file = PAGE_FILES.get(p);
  const found = canonicalsIn(read(file));
  const want = canonicalFor(BASE, p);
  check(`${file} -> ${want}`, found.length === 1 && found[0] === want,
    found.length === 1 ? `found ${found[0]}` : `found ${found.length} canonical tags`);
}

console.log('the server-filled shells carry NONE of their own:');
for (const file of SERVER_FILLED_SHELLS) {
  check(`${file} leaves its canonical to the server`, canonicalsIn(read(file)).length === 0,
    'src/server.js injects one per map — two canonicals in a document is worse than none');
}

console.log('no public page was left out:');
// The population is the DIRECTORY, not the list, so a page added without being
// listed is a finding rather than a silent omission. That is exactly how
// /background.html got into every footer and no sitemap.
const onDisk = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html')).sort();
const accountedFor = new Set([...PAGE_FILES.values(), ...SERVER_FILLED_SHELLS]);
const orphans = onDisk.filter((f) => !accountedFor.has(f));
check('every public/*.html is either in STATIC_PAGES or a known shell', orphans.length === 0,
  `not accounted for: ${orphans.join(', ')} — add it to src/public/staticPages.js`);

console.log('the footer and the sitemap agree, in both directions:');
// The rule the STATIC_PAGES comment has always claimed, now asked of the bytes.
const footerPaths = [...FOOTER_HTML.matchAll(/href="(\/[^"#]*)"/g)]
  .map((m) => m[1].split('?')[0])
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();
for (const p of footerPaths) {
  check(`footer link ${p} is in the sitemap`, STATIC_PAGES.includes(p),
    'linked from every page and crawlable from none is not privacy, just inconsistency');
}
for (const p of STATIC_PAGES) {
  // `/` is reached from the brand link in the nav bar, not from the footer list.
  if (p === '/') continue;
  check(`sitemap entry ${p} is linked from the footer`, footerPaths.includes(p),
    'a sitemap URL nothing links to is a page that has quietly fallen out of the site');
}

console.log('the application log keeps neither a search term nor a sign-in token:');
check('a search query is dropped', loggableUrl('/maps?q=ely') === '/maps');
check('the search API query is dropped', loggableUrl('/api/public/search?q=ely') === '/api/public/search');
check('a magic-link token is dropped', loggableUrl('/auth/verify?token=abc123') === '/auth/verify',
  'a magic link is a live credential and cannot be moved into a header');
// The negative half. A serialiser that bared EVERY url would pass all three
// above and be a different bug, so assert what must SURVIVE.
check('an ordinary URL is untouched', loggableUrl('/m/st-ives') === '/m/st-ives');
check('a non-sensitive query survives', loggableUrl('/m/st-ives?download=1') === '/m/st-ives?download=1',
  'the point is to drop two named things, not to blind the log');
check('a lookalike path is not matched', loggableUrl('/maps.html?x=1') === '/maps.html?x=1',
  "'/maps?' carries its question mark for this reason");

console.log('and it keeps no address that could identify a household:');
check('an IPv4 address loses its last octet', maskIp('203.0.113.47') === '203.0.113.0');
check('an IPv4-mapped IPv6 address is masked as the v4 it is', maskIp('::ffff:203.0.113.47') === '203.0.113.0',
  'Fastify hands this shape back on a dual-stack socket, and it is a v4 address in v6 spelling');
check('an IPv6 address keeps two groups', maskIp('2001:db8:1234:5678:9abc:def0:1234:5678') === '2001:db8::');
check('a compressed IPv6 address is masked from its LEADING groups', maskIp('2001:db8:1234::5') === '2001:db8::',
  'splitting on `::` first is what makes the leading groups findable without expanding the address');
check('an address with fewer leading groups than we keep does not mangle', maskIp('fe80::1') === 'fe80::',
  'joining the groups naively produced `fe80:::` here');
check('the all-zero prefix survives the same path', maskIp('::1') === '::');
// The negative half, in both directions. A masker that returned a constant would
// pass everything above and be useless; one that passed unknown input through
// would leave the guarantee conditional on the shape of the input.
check('the network part is genuinely kept', maskIp('198.51.100.7') === '198.51.100.0',
  'a masker that returned one constant would satisfy every case above');
check('a value it cannot parse becomes `unknown`, not itself', maskIp('not-an-address') === 'unknown',
  'passing an unrecognised value through is how a full address gets into a log');
check('an out-of-range octet is not quietly kept', maskIp('999.0.113.47') === 'unknown');
check('an absent address does not throw', maskIp(undefined) === 'unknown' && maskIp('') === 'unknown');

console.log('and the LOG LINE itself comes out redacted, not just the helpers:');
// The wire, driven rather than read. Every assertion above stops at a helper;
// this one calls the function src/server.js hands to Fastify as its `req`
// serialiser, so a change that kept both helpers and stopped calling one of them
// is caught here and nowhere else.
const line = loggableReq({
  method: 'GET',
  url: '/maps?q=ely',
  host: 'busmaps.uk',
  ip: '203.0.113.47',
  socket: { remotePort: 51234 },
});
check('the serialiser masks the address', line.remoteAddress === '203.0.113.0',
  `got ${JSON.stringify(line.remoteAddress)}`);
check('the serialiser drops the search term in the same line', line.url === '/maps',
  'both redactions have to survive on one request, not one each in two tests');
check('it still records what the request WAS', line.method === 'GET' && line.host === 'busmaps.uk' && line.remotePort === 51234,
  'the point is to redact two fields, not to blind the log');
check('a request with no socket does not throw', loggableReq({ method: 'GET', url: '/', ip: '::1' }).remotePort === undefined);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll indexing checks passed.');
