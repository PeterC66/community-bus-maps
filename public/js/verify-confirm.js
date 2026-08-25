// The sign-in confirmation form's CSRF token (technical-audit_2026-08-25 N7).
//
// The form POSTs to /auth/verify, which is guarded unconditionally — it is the
// one state-changing request made by somebody who has no session yet, and so the
// one an attacker would most like to forge. The double-submit token is read from
// the cookie the server just set and echoed in a header, which a page on another
// origin cannot do because it cannot read our cookies.
//
// Sent as fetch + header rather than as a hidden form field on purpose: a hidden
// field would be posted by a cross-site form too, since a form POST does not
// need to READ anything. Only the header proves the cookie was readable.
(function () {
  var form = document.getElementById('f');
  if (!form) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var m = document.cookie.match(/(?:^|;\s*)cbm_csrf=([^;]*)/);
    var token = form.querySelector('input[name=token]').value;
    fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': m ? decodeURIComponent(m[1]) : '' },
      body: JSON.stringify({ token: token }),
      redirect: 'follow',
    }).then(function (r) {
      window.location = r.redirected ? r.url : '/app';
    }).catch(function () {
      window.location = '/app/login.html?error=expired';
    });
  });
})();
