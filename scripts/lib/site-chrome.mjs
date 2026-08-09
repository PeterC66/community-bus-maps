// Single source of truth for the public nav bar, copy-pasted verbatim into
// every public/*.html today (P9 A1, docs/P9-header-and-place-search.md).
//
// FOOTER_HTML deliberately isn't here yet: the 12 footers aren't byte-identical
// (each page's attrib paragraph differs slightly) and unifying that content is
// its own plan item (A5), not a side-effect of building this mechanism.
//
// Consumed by check-chrome.mjs (asserts every page matches) and
// apply-chrome.mjs (rewrites every page to match) via the markers
// `<!-- nav:start -->` / `<!-- nav:end -->` in public/*.html.

export const NAV_HTML = `  <header class="site-header"><div class="container"><nav class="nav">
    <a class="brand" href="/"><span class="logo">🚌</span> BusMaps.uk</a>
    <span class="spacer"></span>
    <a class="navlink" href="/maps">Published maps</a>
    <a class="navlink" href="/examples.html">Examples</a>
    <a class="navlink" href="/pricing.html">Pricing</a>
    <a class="navlink" href="/faq.html">FAQ</a>
    <a class="navlink" href="/contact.html">Contact</a>
    <a class="btn btn-primary" href="/apply.html">Apply to join</a>
  </nav></div></header>`;
