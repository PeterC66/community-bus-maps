// Pre-selects the "kind" dropdown from ?kind= on /contact.html, and reveals the
// map-specific note when that kind is "issue" (the footer's "Report an issue"
// link arrives here as /contact.html?kind=issue).
//
// Lived inline in contact.html until 2026-08-19. It was moved out so the CSP in
// the Caddyfile can say `script-src 'self'` with no 'unsafe-inline' escape
// hatch — an inline-script allowance would have applied site-wide, including to
// /m/<slug>, which injects generated SVG into the DOM
// (technical-audit_2026-08-19 S1/S9). Loaded with `defer`, so the form elements
// it reaches for are already parsed.
(function () {
  var kind = new URLSearchParams(location.search).get('kind');
  var select = document.getElementById('kind');
  if (kind && select && select.querySelector('option[value="' + kind + '"]')) {
    select.value = kind;
  }
  if (kind === 'issue') {
    var body = document.getElementById('body');
    if (body && !body.value) body.placeholder = 'Which map, and what looks wrong? A link or a photo helps.';
    var note = document.getElementById('issueNote');
    if (note) note.hidden = false;
  }
})();
