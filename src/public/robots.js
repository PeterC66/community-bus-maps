// robots.txt — the whole indexing policy, as one pure function.
//
// WHY THIS IS NOT INLINE IN THE ROUTE. Whether this site may be indexed is a
// consequential, easily-mis-set decision, and until 2026-08-21 it was a `?:`
// buried in a route handler in server.js with no test of any kind behind it. The
// route cannot be tested without booting the server (server.js listens on import),
// so the policy could only ever have been asserted by grepping the source — which
// certifies the code, not the behaviour.
//
// Pulling it out here means the test calls the same function the route calls and
// compares the actual bytes a crawler receives, for both flag states, and can be
// watched to go red when the flag is wrong. See scripts/test-indexing.mjs.

/**
 * The body of /robots.txt.
 *
 * @param {object}  o
 * @param {boolean} o.indexable    INDEXING.allowed — false disallows the whole site.
 * @param {string}  o.sitemapUrl   Absolute URL of sitemap.xml.
 * @returns {string} The complete response body, newline-terminated.
 */
export function robotsTxt({ indexable, sitemapUrl }) {
  return [
    'User-agent: *',
    // The site-wide block, present only while indexing is switched off. It comes
    // first so that a reader (human or crawler) sees the broadest rule before the
    // narrower ones, and so the narrower ones below stay meaningful if it is
    // removed — they are NEVER indexable, whatever this flag says.
    ...(indexable ? [] : ['Disallow: /']),
    // Always disallowed, independently of the flag above: the signed-in app, the
    // private half of the API, and the auth endpoints. None of them is public
    // content, and a crawler following them wastes its budget on 401s at best.
    //
    // NARROWED FROM `Disallow: /api/` ON 2026-08-25 (technical-audit_2026-08-25 N1).
    // The blanket rule covered /api/public/* as well, which is the read-only,
    // unauthenticated half — and it was the half /maps and /m/<slug>/services
    // fetched their entire contents from. So the site was simultaneously
    // publishing those pages in sitemap.xml, delivering them as empty shells,
    // and forbidding compliant crawlers from fetching what would have filled
    // them. Both pages are server-rendered now, so nothing DEPENDS on this any
    // more; the rule is narrowed anyway, because a public read endpoint being
    // fetchable is the honest description of what it is, and the next page that
    // uses one should not have to rediscover this.
    'Disallow: /app',
    'Disallow: /api/admin',
    'Disallow: /api/auth',
    'Disallow: /api/maps',
    'Disallow: /api/me',
    'Disallow: /api/review',
    'Disallow: /auth/',
    // The sitemap line stays even while the site is disallowed. That is deliberate
    // and standards-conformant: it costs nothing, it keeps this file a one-flag
    // revert, and a crawler that is told not to index will not fetch it anyway.
    `Sitemap: ${sitemapUrl}`,
    '',
  ].join('\n');
}
