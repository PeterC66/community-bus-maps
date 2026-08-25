// Single source of truth for the public nav bar and footer, copy-pasted
// verbatim into every public/*.html today (P9, docs/P9-header-and-place-search.md).
//
// Consumed by check-chrome.mjs (asserts every page matches) and
// apply-chrome.mjs (rewrites every page to match) via the markers
// `<!-- nav:start -->`/`<!-- nav:end -->` and `<!-- footer:start -->`/`<!-- footer:end -->`
// in public/*.html.
//
// FOOTER_HTML's attrib paragraph (A5) is the text already shared by 5 of the
// 12 pages (legal/map/maps/org/terms) before this ran — the majority text,
// not new copy: it keeps the "Always check live times…" caveat that 7 of 12
// pages already carried, and drops examples.html's lone "Example maps ©" and
// index.html's lone alternate intro sentence.

export const NAV_HTML = `  <header class="site-header"><div class="container"><nav class="nav">
    <a class="brand" href="/"><span class="logo">🚌</span> BusMaps.uk</a>
    <span class="spacer"></span>
    <a class="navlink" href="/maps">Published maps</a>
    <a class="navlink" href="/examples.html">Examples</a>
    <a class="navlink" href="/pricing.html">Pricing</a>
    <a class="navlink" href="/faq.html">FAQ</a>
    <a class="navlink" href="/contact.html">Contact</a>
    <a class="btn btn-primary" href="/apply.html">Apply to join</a>
    <span class="nav-auth" id="navAuth"></span>
  </nav></div></header>`;

export const FOOTER_HTML = `  <footer class="site-footer"><div class="container"><div class="cols">
    <div class="attrib">
      <strong>BusMaps.uk</strong> — a community project helping local organisations publish clear, printable bus maps.<br>
      Maps © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL); bus service data via <a href="https://www.gov.uk/government/publications/bus-services-act-2017-bus-open-data">BODS</a>, stop and stand data via <a href="https://www.gov.uk/government/publications/national-public-transport-access-node-schema">NaPTAN</a> (<a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence</a>). Always check live times with the operator or at bustimes.org.
    </div>
    <div>
      <a href="/maps">Published maps</a> · <a href="/examples.html">Examples</a> · <a href="/pricing.html">Pricing</a> · <a href="/apply.html">Apply</a> · <a href="/faq.html">FAQ</a> · <a href="/contact.html">Contact</a> · <a href="/contact.html?kind=issue">Report an issue</a> · <a href="/opportunity.html">Take this on</a> · <a href="/accessibility.html">Accessibility</a> · <a href="/legal.html">Privacy &amp; licensing</a> · <a href="/terms.html">Terms</a> · <a href="/changelog.html">What's new</a><br>
      <span class="muted">© BusMaps.uk</span>
    </div>
  </div></div></footer>`;
