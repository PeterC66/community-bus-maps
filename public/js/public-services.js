// A published map's services, as text (/m/<slug>/services) — P8a.
//
// This page is the map sheet's ACCESSIBLE EQUIVALENT. A picture of a bus map has
// no alt text that could carry it, and a public body embedding our map inherits
// it into its own WCAG 2.2 AA duty, so the same facts are published as ordinary
// HTML: one section per service, with the operator, the days it runs, where it
// goes and which stops it serves.
//
// It is also simply useful — searchable, copyable, and readable on a phone
// without pinching.
//
// THIS SCRIPT IS NO LONGER THE PRIMARY PATH (technical-audit_2026-08-25 N1).
// The server renders the whole page now. It used to render nothing but chrome,
// which meant a reader without JavaScript — a text browser, a crawler, an
// assistant reading the page aloud, anyone whose second request failed — got the
// word "Loading…" and no bus services at all, on the page whose entire purpose
// is to be the accessible fallback.
//
// What is left here is a SAFETY NET for the case that remains: an older cached
// shell served with no content in it. When the server has already filled the
// page this script does nothing — it must not re-render, because replacing
// identical markup for no reason throws away the reader's find-in-page state and
// scroll position, and would undo any #route-… anchor they had just followed.
//
// It imports the same markup module the server imports, so the two cannot drift.
import { servicesView } from './shared/services-view.mjs';

(async () => {
  const $ = (id) => document.getElementById(id);

  // Did the server already do this? `#services` holds one <section> per route
  // when it did and is empty when it did not, so this reads what was actually
  // DELIVERED rather than a flag that could disagree with it.
  if ($('services') && $('services').children.length > 0) return;

  const slug = decodeURIComponent(location.pathname.replace(/^\/m\//, '').replace(/\/services\/?$/, ''));

  let map, services;
  try {
    const res = await fetch(`/api/public/maps/${encodeURIComponent(slug)}/services`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error('nope');
    map = body.map; services = body.services;
  } catch {
    $('headline').textContent = 'We can’t find that service list';
    $('err').hidden = false;
    $('err').innerHTML = 'The map may not be published any more. <a href="/maps">Browse the published maps</a>.';
    return;
  }

  const v = servicesView(map, services);
  $('mapLink').href = v.mapUrl;
  $('backToMap').href = v.mapUrl;
  $('headline').innerHTML = v.headline;
  $('intro').innerHTML = v.intro;
  $('pills').innerHTML = v.pills;
  if (v.stale) {
    $('staleNote').hidden = false;
    $('staleNote').className = 'notice notice-warn';
    $('staleNote').innerHTML = v.stale;
  }
  $('services').innerHTML = v.services;
})();
