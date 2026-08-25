// Attach the CSRF token to every state-changing fetch (technical-audit_2026-08-25 N7).
//
// WHY THIS PATCHES window.fetch RATHER THAN ADDING A HELPER. There are ten files
// under public/ making twenty-six mutating requests, and no shared client
// wrapper — each one rolls its own $ and esc and fetch. A helper would mean
// twenty-six edits and a twenty-seventh that gets forgotten next year, which is
// the exact shape of two findings already in this project's history: a drawing
// layer that skipped the collision check its neighbours all made, and three
// tools that each enumerated a subset of the same population and passed cleanly
// over it. A rule enforced at the choke point cannot be forgotten by the caller,
// because there is no caller to forget it.
//
// SAME-ORIGIN ONLY, and only for methods that change something. A GET is
// untouched, and so is any request to another host — attaching our token to a
// third-party URL would leak it, which would be a worse bug than the one this
// closes.
//
// The value is not a credential. It authenticates nothing; it only demonstrates
// that whoever sent the request could read our cookie jar, which a page on
// another origin cannot. So there is no harm in it being visible to script —
// that visibility IS the mechanism.
(function () {
  if (!window.fetch || window.__cbmCsrfPatched) return;
  window.__cbmCsrfPatched = true;

  var MUTATING = { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };

  function token() {
    var m = document.cookie.match(/(?:^|;\s*)cbm_csrf=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function sameOrigin(input) {
    try {
      var url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      return url.origin === window.location.origin;
    } catch (e) {
      // An input we cannot parse is not one we should decorate.
      return false;
    }
  }

  var original = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    if (!MUTATING[method] || !sameOrigin(input)) return original.call(this, input, init);

    // Headers may arrive as a plain object, an array of pairs, or a Headers
    // instance. Normalising through Headers handles all three, and preserves
    // whatever the caller already set — including a token it set itself.
    var headers = new Headers(init.headers || (input && input.headers) || undefined);
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token());
    var next = {};
    for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) next[k] = init[k];
    next.method = method;
    next.headers = headers;
    return original.call(this, input, next);
  };
})();
