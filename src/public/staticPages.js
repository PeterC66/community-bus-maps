// The hand-written public pages: which paths they live at, and which file serves
// each one.
//
// This list was a `const` inside src/server.js until 2026-08-31 (buses-data
// OA-172). It is out here for the same reason src/public/robots.js is — so a
// test can ask what a crawler receives without booting the server — and because
// two other things now need to agree with it: the footer in
// scripts/lib/site-chrome.mjs, and the `<link rel="canonical">` in each file.
//
// THE RULE THIS LIST IS SUPPOSED TO KEEP, restated from where it used to live:
// every public page linked from the footer is in here, so the sitemap and the
// footer agree. `/opportunity.html` is outreach rather than shopfront, but it is
// linked from all of them — excluding it would hide it from crawlers while
// showing it to every visitor, which is not privacy, just inconsistency.
//
// The rule was stated there and enforced by nothing, and it took four hours to
// break: `/background.html` shipped in portal #176 on 2026-08-31, went into the
// footer of all sixteen pages, and was never added here — linked from every page
// and in no sitemap. scripts/test-indexing.mjs now joins this list to
// FOOTER_HTML in both directions, so the next one fails a test instead of
// waiting to be noticed.
//
// What actually keeps any of it unindexed is robots.txt saying `Disallow: /`,
// which it does until ALLOW_INDEXING=1 — a decision independent of PILOT_MODE.
// See src/config.js §INDEXING.
export const STATIC_PAGES = [
  '/',
  '/maps',
  '/examples.html',
  '/pricing.html',
  '/faq.html',
  '/apply.html',
  '/contact.html',
  '/background.html',
  '/opportunity.html',
  '/legal.html',
  '/terms.html',
  '/accessibility.html',
  '/changelog.html',
];

// The file under public/ that serves each path. Two are not their own name:
// `/` is served as the static index, and `/maps` is a shell src/server.js fills
// in before sending. Everything else is the path with the leading slash removed.
export const PAGE_FILES = new Map(STATIC_PAGES.map((p) => [
  p,
  p === '/' ? 'index.html' : p === '/maps' ? 'maps.html' : p.slice(1),
]));

// The three shells whose <head> is completed SERVER-side for /m/<slug>,
// /m/<slug>/services and /o/<slug>. They must NOT carry a canonical of their
// own — src/server.js injects one per map, and two canonicals in one document
// is worse than none, because a crawler is entitled to ignore both.
export const SERVER_FILLED_SHELLS = ['map.html', 'services.html', 'org.html'];

/** The absolute canonical URL for a static page path, given the public base. */
export const canonicalFor = (base, path) => String(base).replace(/\/+$/, '') + path;
