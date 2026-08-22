// Marks the nav link for the page you are on, so the header says where you are.
//
// It is done in JS rather than in the markup because the header is ONE string
// (scripts/lib/site-chrome.mjs) copied verbatim into every public/*.html, and
// check-chrome.mjs asserts every page still matches it byte for byte. A
// per-page `aria-current` would break that guarantee for a cosmetic gain; the
// current page is something the browser already knows, so let it work it out.
//
// `aria-current="page"` is the real output — a screen reader announces it, and
// styles.css hangs the underline off the same attribute. Colour is deliberately
// not the only signal (weight and the underline carry it too), which is the same
// rule the maps themselves follow.
(() => {
  const nav = document.querySelector('.site-header .nav');
  if (!nav) return;
  const here = location.pathname.replace(/\/index\.html$/, '/');

  // A map page (/m/<slug>) and its service list (/m/<slug>/services) belong to
  // "Published maps" — the visitor got there from that section and has not left it.
  const section = (p) => (p === '/maps' || p.startsWith('/m/') ? '/maps' : p);

  const want = section(here);
  for (const a of nav.querySelectorAll('a[href]')) {
    const href = new URL(a.getAttribute('href'), location.origin).pathname;
    if (href === '/') continue; // the brand; the logo is the home indicator already
    if (section(href) === want) {
      a.setAttribute('aria-current', 'page');
      return; // first match wins — the nav never lists the same destination twice
    }
  }
})();
