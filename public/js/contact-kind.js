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
  // "Ask for a map of <place>" from the /maps search (buses-data OA-380 (c)).
  // The place name is PREFILLED into the message rather than put in the
  // placeholder, because a placeholder is not sent: a reader who replies "yes
  // please" to a form headed "Ask for a map of my area" would arrive as a map
  // request naming no area, and the one fact we needed would be the one thing
  // lost. It goes in only when the box is empty, and it can be deleted.
  if (kind === 'map-request') {
    var place = new URLSearchParams(location.search).get('place');
    var msg = document.getElementById('body');
    if (msg && !msg.value) {
      msg.value = place
        ? 'I would like a bus map of ' + place + '.\n\n'
        : 'I would like a bus map of my area.\n\n';
      msg.placeholder = 'Which journeys are hard to work out? Which buses do you use? Anything you add helps.';
      try { msg.setSelectionRange(msg.value.length, msg.value.length); } catch (e) { /* not focusable yet */ }
    }
  }
  if (kind === 'issue') {
    var body = document.getElementById('body');
    if (body && !body.value) body.placeholder = 'Which map, and what looks wrong? A link or a photo helps.';
    var note = document.getElementById('issueNote');
    if (note) note.hidden = false;
  }
})();
