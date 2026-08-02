// Open the FAQ entry a link points at.
//
// Answers are <details>, so /faq.html#diagram lands a reader on a page of
// collapsed questions unless the targeted one is opened for them. Browsers are
// starting to do this themselves for fragment navigation, but not all of them and
// not reliably, and the pricing page links straight into an answer — so do it here
// rather than depend on it.
(function () {
  function openTarget() {
    var id = location.hash.slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el || el.tagName !== 'DETAILS') return;
    el.open = true;
    el.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', openTarget);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openTarget);
  else openTarget();
})();
