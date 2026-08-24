// whats-new.js — renders /data/whats-new.json into any element carrying
// data-whats-new="panel" (a short teaser, latest 3, for the home page) or
// data-whats-new="full" (every entry, for /changelog.html). One JSON file
// is the only thing that needs editing when something customer-facing
// ships — no template to keep in sync, no build step.
//
// Deliberately NOT the developer CHANGELOG.md: that file names real past
// security findings in implementation detail and is served only to signed-in
// admins at /app/changelog. This one is hand-curated, public-safe, and only
// grows when someone adds a line to whats-new.json.
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function render(el, entries, mode) {
    var items = mode === 'panel' ? entries.slice(0, 3) : entries;
    if (!items.length) { el.hidden = true; return; }
    el.innerHTML = items.map(function (e) {
      return '<div class="whats-new-item">'
        + '<div class="whats-new-date muted">' + esc(fmtDate(e.date)) + '</div>'
        + '<div class="whats-new-title">' + esc(e.title) + '</div>'
        + '<p class="whats-new-body">' + esc(e.body) + '</p>'
        + '</div>';
    }).join('');
  }

  var hosts = document.querySelectorAll('[data-whats-new]');
  if (!hosts.length) return;
  fetch('/data/whats-new.json').then(function (r) { return r.ok ? r.json() : []; }).then(function (entries) {
    entries = (entries || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    for (var i = 0; i < hosts.length; i++) render(hosts[i], entries, hosts[i].getAttribute('data-whats-new'));
  }).catch(function () { /* leave the loading text in place rather than break the page */ });
})();
