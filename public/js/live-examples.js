// live-examples.js — keep the sample images on the public pages current by
// construction, instead of by somebody remembering.
//
// WHY THIS EXISTS. index.html and examples.html used to reference committed files
// under /examples/. Those were exported by hand and then not re-exported: on
// 2026-08-18 they were still the 8 August cut, which pre-dated the entire Phase
// 6/7/8 design programme — the icon-set redraw, white route casing, print-safe
// margins, label engine v2, panel corridors, the honest scale bar. So the shop
// window was showing work two design generations old while the portal served the
// current sheets one click away. Peter's note asked whether this could be done in
// a way that they always are up to date; this is that way.
//
// The pages now point at /api/public/maps/<slug>/preview/<base>, which is the
// published map's own screen-size rendition (1400px, derived from the reviewed
// print JPG and cached beside it, ETag keyed to the published version). Publish a
// new version and the home page follows it. There is nothing to re-export and
// nothing to forget.
//
// This file only supplies the SAFETY NET. The live URL is already in the markup's
// src, so images load without waiting for JavaScript and work with it disabled —
// what this adds is: if a sample map is ever unpublished, withdrawn or renamed, the
// broken image falls back to the committed file rather than showing the browser's
// torn-page icon on the front page. The committed files are deliberately kept for
// exactly that reason, so do not delete them when they next look redundant.
//
// RACE NOTE (found 2026-08-25): this script runs on `defer`, but an eager
// (non-lazy) <img> starts fetching the instant the parser meets its tag — on a
// fast/local response it can already have fired and lost its 'error' event
// before this script attaches a listener. `img.complete && naturalWidth === 0`
// after a real src is the tell for "already failed"; check every image for
// that state as well as listening for errors still to come.
(function () {
  'use strict';
  function swap(img, fallback) {
    if (img.getAttribute('src') === fallback) return;
    img.setAttribute('src', fallback);
    var link = img.closest('a[data-fallback-href]');
    if (link) link.setAttribute('href', link.getAttribute('data-fallback-href'));
  }
  function attach(img) {
    var fallback = img.getAttribute('data-fallback');
    if (!fallback) return;
    if (img.complete && img.naturalWidth === 0) {
      // Already failed before this script ran — the error event is gone for good.
      swap(img, fallback);
      return;
    }
    img.addEventListener('error', function onError() {
      // Once only: if the fallback itself 404s, let the browser show that rather
      // than loop between two dead URLs.
      img.removeEventListener('error', onError);
      swap(img, fallback);
    });
  }
  var imgs = document.querySelectorAll('img[data-fallback]');
  for (var i = 0; i < imgs.length; i++) attach(imgs[i]);
})();
