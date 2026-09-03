// The public 404 body, as one module (OA-232 Tier 3.2).
//
// It lived at the foot of the public front in src/server.js and had callers on
// BOTH sides of the cut that was about to happen: the four public routes that
// answer an unknown slug, and src/server.js's own setNotFoundHandler and
// setErrorHandler, which are the app's last resort and belong with the
// bootstrap. So it moved out first rather than during the cut — otherwise
// src/server.js would have had to import a helper out of a route file, which is
// the dependency src/routes/pages.js's header says a route file must never have
// in either direction.
//
// IT IS THE HTML HALF OF A TWO-HALVED ANSWER, and the other half is
// src/http/errors.js. A request that wants JSON gets notFoundEnvelope(); a
// browser gets this. The `code: 'route_not_found'` discriminator that
// scripts/check-live-routes.mjs keys on is in that envelope, not here — this
// page is what a person sees and is deliberately free of anything a checker
// parses.
//
// No template engine and no imports: it is one hand-written document, matching
// the static pages in public/ that it sits beside, and `what` is the only thing
// that varies ('page', 'map', 'organisation', 'services list').

/** The 404/error page a browser is sent. `what` completes "We can't find that …". */
export function notFoundPage(what) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — BusMaps.uk</title><link rel="stylesheet" href="/css/styles.css">
<script src="/js/site-banner.js" defer></script>
<script src="/js/nav-current.js" defer></script></head>
<body><header class="site-header"><div class="container"><nav class="nav">
<a class="brand" href="/"><span class="logo">🚌</span> BusMaps.uk</a><span class="spacer"></span>
<a class="navlink" href="/maps">Published maps</a></nav></div></header>
<main><section><div class="container">
<h2 class="mt-0">We can’t find that ${what}</h2>
<p class="section-intro">It may never have been published, or it may have been taken down. Every map published through the portal is listed on the published-maps page.</p>
<div class="lead-cta"><a class="btn btn-primary" href="/maps">Browse published maps</a>
<a class="btn btn-ghost" href="/contact.html">Ask us about it</a></div>
</div></section></main></body></html>`;
}
