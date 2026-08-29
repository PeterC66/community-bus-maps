// A published map's services as text — the markup, rendered by BOTH the server
// and the browser. Companion to map-card.mjs; the same constraints apply (no
// DOM, no Node imports, publicly served, imported by src/server.js and by
// public/js/public-services.js).
//
// WHY THIS PAGE IN PARTICULAR (technical-audit_2026-08-25 N1). /m/<slug>/services
// is the map sheet's ACCESSIBLE EQUIVALENT: a picture of a bus map has no alt
// text that could carry it, and a public body embedding our map inherits it into
// its own WCAG 2.2 AA duty. Until 2026-08-25 the page was a shell — 4,716 bytes
// whose entire body was the word "Loading…" — and everything below was built in
// the browser from /api/public/maps/<slug>/services.
//
// For a screen reader that was fine, because screen readers run JavaScript. For
// a text browser, a crawler, a link checker, an assistant reading the page, or
// anybody on a connection where one request succeeded and the next did not, the
// accessible alternative was blank. Nineteen of these URLs are in sitemap.xml.
// A fallback whose availability depends on the technology it is a fallback FROM
// is not a fallback, so the server renders it now and the browser only fills in
// what the server could not know.
//
// The client still runs on this page — see public/js/public-services.js — but
// only when the server left the page unrendered (a cache serving an older shell,
// say). It is a safety net, not the primary path.

import { esc, whenGB } from './map-card.mjs';

const list = (items) => items.map((s) => `<li>${esc(s)}</li>`).join('');

/** The page's h2. */
export function headline(map, services) {
  const subject = services.subject || map.name;
  return `Bus services ${services.kind === 'place' ? 'serving' : 'in'} ${esc(subject)}`;
}

/**
 * The standfirst under it, as HTML.
 *
 * The subject is ESCAPED here. It was not in the original client code and did
 * not need to be, because that code assigned the string to `.textContent`. This
 * function's output is now written into the page as HTML by the server as well,
 * so every value it interpolates has to be escaped at the point of
 * interpolation — the one rule that has to hold everywhere for the escaping to
 * mean anything.
 */
export function intro(map, services) {
  const subject = esc(services.subject || map.name);
  return services.kind === 'place'
    ? `Every service that calls at ${subject}, written out in full. This is the same information as the map — use whichever suits you.`
    : `Every service shown on the ${subject} map, written out in full. This is the same information as the map — use whichever suits you.`;
}

/** Provenance pills: data date, version, publication date, service count. */
export function pillsHtml(map, services) {
  const prov = map.provenance || {};
  return [
    prov.dataAsAt ? `<span class="pill">Services as at ${esc(prov.dataAsAt)}</span>` : '',
    `<span class="pill">Version ${esc(map.version)}</span>`,
    `<span class="pill">Published ${esc(whenGB(map.publishedAt))}</span>`,
    `<span class="pill">${esc(services.routes.length)} service${services.routes.length === 1 ? '' : 's'}</span>`,
    ...(map.org.isDemo ? ['<span class="pill">Sample — not live</span>'] : []),
  ].filter(Boolean).join('');
}

/**
 * The staleness warning, or '' when the data is current.
 *
 * Returns the INNER html only; the caller decides whether the container is
 * hidden, because the server writes the container's attributes into the shell
 * and the browser toggles them.
 */
export function staleHtml(map) {
  const prov = map.provenance || {};
  if (!prov.stale) return '';
  return `<strong>This information may be out of date.</strong> It is correct as at
      ${esc(prov.dataAsAt || whenGB(prov.publishedAt))}, which is more than ${esc(prov.staleAfterMonths)} months ago.
      Check with the operator or at <a href="https://bustimes.org" rel="nofollow noopener">bustimes.org</a> before you travel.`;
}

function routeSection(r, services) {
  const swatch = r.colour
    ? `<span class="route-badge" style="background:${esc(r.colour)};color:${esc(r.textOn || '#fff')}">${esc(r.id)}</span>`
    : `<span class="route-badge plain">${esc(r.id)}</span>`;
  const meta = [
    r.operator ? `Operated by ${esc(r.operator)}` : '',
    r.days ? esc(r.days) : '',
  ].filter(Boolean).join(' · ');

  const blocks = [];
  if (r.stopsInArea.length) {
    // The order the bus calls, which for most services means out and back — so a
    // stop legitimately appears twice. Say so rather than tidying it away.
    blocks.push(`<h4>Stops it serves ${services.kind === 'place' ? 'nearby' : 'in the area'}</h4>
        <p class="muted small">In the order the bus calls; a stop appears twice where the route comes back past it.</p>
        <ol class="stop-list">${list(r.stopsInArea)}</ol>`);
  }
  for (const j of r.journeys) {
    blocks.push(`<h4>${j.label ? `Towards ${esc(j.label)}` : 'Where it goes'}${j.limited ? ' <span class="tag">limited</span>' : ''}</h4>
        ${j.days ? `<p class="muted small">${esc(j.days)}</p>` : ''}
        <ol class="stop-list wrap">${list(j.places)}</ol>`);
  }
  if (r.goesTo.length) {
    blocks.push(`<h4>Where it goes</h4><ul class="stop-list wrap">${
      r.goesTo.map((d) => `<li>${esc(d.name)}${d.sub ? ` <span class="muted small">(${esc(d.sub)})</span>` : ''}${
        d.limited ? ' <span class="tag">limited</span>' : ''}</li>`).join('')}</ul>`);
  }
  if (!blocks.length && r.terminus) blocks.push(`<p>Runs towards ${esc(r.terminus)}.</p>`);

  return `<section class="route-card" id="route-${esc(r.id)}" aria-labelledby="route-h-${esc(r.id)}">
      <h3 id="route-h-${esc(r.id)}">${swatch} ${esc(r.title || r.id)}</h3>
      ${meta ? `<p class="muted">${meta}</p>` : ''}
      ${blocks.join('')}
    </section>`;
}

/**
 * "Where to board", as the table it always was (OA-010).
 *
 * The boarding sheet answers a question the other four sheets leave open — not
 * "where do the buses go" but "I have decided to go to Bedford; which of these
 * five identically-named stops do I stand at?" — and it answers it keyed on
 * DESTINATION rather than on route. That shape is a table, so this is the one
 * place where the text alternative is arguably the better artefact rather than a
 * consolation prize, and it is the accessibility argument the sheet is sold on.
 *
 * Returns '' for a map with no boarding plan, which is most of them.
 */
export function boardingHtml(services) {
  const b = services.boarding;
  if (!b || !b.destinations.length) return '';
  const where = b.place ? esc(b.place) : 'here';
  const walk = (m) => (m == null ? '' : `${esc(m)} min`);
  const badges = (rs) => rs.map((r) => `<span class="route-badge plain">${esc(r)}</span>`).join(' ');

  const stands = b.stands.map((st) => {
    const bits = [
      // A stop with no letter on its flag is labelled by its own name, so the
      // street would otherwise print twice ("Crendon Street — Crendon Street").
      st.name && st.name !== st.label ? esc(st.name) : '',
      st.facing ? `facing ${esc(st.facing)}` : '',
      st.walkMin == null ? '' : `${walk(st.walkMin)} walk${st.distM == null ? '' : ` (${esc(st.distM)} m)`}`,
      // A stand with nothing boarded at it is not an error and not an omission:
      // it is a real flag on the street that no service on this sheet uses, and
      // a reader standing at it needs to be told so.
      st.destinationCount
        ? `${esc(st.destinationCount)} destination${st.destinationCount === 1 ? '' : 's'}`
        : 'no bus on this sheet is boarded here',
    ].filter(Boolean).join(' · ');
    return `<li><strong>${esc(st.label)}</strong> — ${bits}</li>`;
  }).join('');

  const rows = b.destinations.map((d) => {
    const also = d.alsoFrom.length
      ? `<div class="board-also">also from ${d.alsoFrom.map((a) => `${esc(a.label)}${
        a.walkMin == null ? '' : ` (${walk(a.walkMin)})`}`).join(', ')}</div>`
      : '';
    return `<tr>
        <th scope="row">${esc(d.name)}${d.limited ? ' <span class="tag">limited</span>' : ''}${also}</th>
        <td>${esc(d.boardAt)}</td>
        <td>${walk(d.walkMin)}</td>
        <td>${badges(d.routes)}</td>
      </tr>`;
  }).join('');

  const notes = b.notes.length
    ? `<ul class="muted small">${b.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';

  return `<section class="card" id="where-to-board" aria-labelledby="where-to-board-h">
      <h3 id="where-to-board-h">${esc(b.heading || 'Where to board, by destination')}</h3>
      <p class="muted small">Stop letters are the ones printed on the stop itself. Walking times are from ${where}.</p>
      <h4>The stops</h4>
      <ul class="stand-list">${stands}</ul>
      <h4>Where to board for each destination</h4>
      <div class="table-scroll">
        <table class="board-table">
          <caption class="visually-hidden">Destinations, the stop to board at, the walk to it and the services that go there</caption>
          <thead><tr><th scope="col">To</th><th scope="col">Board at</th><th scope="col">Walk</th><th scope="col">Services</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${notes}
    </section>`;
}

/** The body: jump nav, fare note, one section per service, then the operators. */
export function servicesHtml(map, services) {
  const ops = services.operators.length
    ? `<section class="card"><h3>Operators</h3><ul>${services.operators
      .map((o) => `<li><strong>${esc(o.name)}</strong>${o.routes.length ? ` — ${esc(o.routes.join(', '))}` : ''}</li>`)
      .join('')}</ul></section>`
    : '';
  // `note` explains how to read the PICTURE ("spokes show where you can get
  // to"), so it has no meaning here. The fare note is a fact and stays.
  const notes = services.fareNote ? `<p class="form-note">${esc(services.fareNote)}</p>` : '';

  const board = boardingHtml(services);

  return `
    <nav class="route-jump" aria-label="Jump to a service">${
  // The boarding index goes FIRST in the jump nav as well as on the page: a
  // reader who has this sheet has usually already chosen where they are going,
  // and the service list is what they fall back to, not what they came for.
  board ? '<a class="tab" href="#where-to-board">Where to board</a>' : ''}${services.routes
    .map((r) => `<a class="tab" href="#route-${esc(r.id)}">${esc(r.id)}</a>`).join('')}</nav>
    ${notes}
    ${board}
    ${services.routes.map((r) => routeSection(r, services)).join('')}
    ${ops}
    <p class="sheet-source">Base map © OpenStreetMap contributors (ODbL) · bus service data from the
      Bus Open Data Service (Open Government Licence) · stop and stand data from NaPTAN
      (Open Government Licence) · times are not shown here — check
      <a href="https://bustimes.org" rel="nofollow noopener">bustimes.org</a> or the operator.</p>`;
}

/** Everything a renderer needs, in one call. */
export function servicesView(map, services) {
  return {
    mapUrl: map.url,
    headline: headline(map, services),
    intro: intro(map, services),
    pills: pillsHtml(map, services),
    stale: staleHtml(map),
    services: servicesHtml(map, services),
  };
}
