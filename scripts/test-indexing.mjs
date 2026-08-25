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

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll indexing checks passed.');
