// A SWITCHED-OFF ACCOUNT SAYS SO, ONCE, WHEREVER IT IS NOTICED (OA-183).
//
// The server half is a single preHandler in src/server.js: a session whose user
// is not `active` is deleted, its cookie cleared, and every /api/ request
// refused 403 with `code: 'account_disabled'`. That is the correct answer and
// it arrives in the middle of a page that was not expecting it — /app's
// dashboard tests only for 401, so a 403 fell straight through its guard and
// into `me.role` on an undefined `me`, and the page simply stopped with its
// loading state on screen.
//
// WHY THIS PATCHES window.fetch, like /js/csrf.js next to it. There is no shared
// client wrapper in this codebase — eight shells each roll their own $, esc and
// fetch — so a helper would mean eight edits and a ninth that gets forgotten.
// The rule is enforced where every response passes instead, and the shells only
// have to LOAD it. That they all do is asserted by scripts/test-access-model.mjs,
// which is what turns "eight script tags" from a list somebody has to remember
// into a checked invariant.
//
// It fires at most once. Several requests usually fail together — a dashboard
// asks /api/me and /api/maps in the same breath — and three stacked notices
// about one switched-off account would read as three faults.
(function () {
  if (!window.fetch || window.__cbmAccountGuard) return;
  window.__cbmAccountGuard = true;

  var fired = false;

  function announce(message) {
    if (fired) return;
    fired = true;
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'alert');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:2rem;background:#fff;';
    var card = document.createElement('div');
    card.style.cssText = 'max-width:34rem;font:16px/1.5 system-ui,sans-serif;color:#1a1a1a;';
    var h = document.createElement('h1');
    h.textContent = 'This account has been switched off';
    h.style.cssText = 'font-size:1.4rem;margin:0 0 .75rem;';
    var p = document.createElement('p');
    p.textContent = message;
    p.style.cssText = 'margin:0 0 1.25rem;';
    var a = document.createElement('a');
    a.href = '/';
    a.textContent = 'Back to BusMaps.uk';
    card.append(h, p, a);
    wrap.appendChild(card);
    (document.body || document.documentElement).appendChild(wrap);
  }

  var original = window.fetch;
  window.fetch = function (input, init) {
    return original.call(this, input, init).then(function (res) {
      // 403 is also how CSRF and step-up refuse, so the CODE decides, not the
      // status. Read from a clone: the caller still needs an unread body.
      if (res.status !== 403 || fired) return res;
      res.clone().json().then(function (b) {
        if (b && b.code === 'account_disabled') {
          announce(b.error || 'Please contact whoever administers it.');
        }
      }).catch(function () { /* not JSON — not ours */ });
      return res;
    });
  };
})();
