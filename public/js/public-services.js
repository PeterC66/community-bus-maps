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
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = decodeURIComponent(location.pathname.replace(/^\/m\//, '').replace(/\/services\/?$/, ''));
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const list = (items) => items.map((s) => `<li>${esc(s)}</li>`).join('');

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

  const mapUrl = map.url;
  $('mapLink').href = mapUrl;
  $('backToMap').href = mapUrl;

  const subject = services.subject || map.name;
  $('headline').innerHTML = `Bus services ${services.kind === 'place' ? 'serving' : 'in'} ${esc(subject)}`;
  $('intro').textContent = services.kind === 'place'
    ? `Every service that calls at ${subject}, written out in full. This is the same information as the map — use whichever suits you.`
    : `Every service shown on the ${subject} map, written out in full. This is the same information as the map — use whichever suits you.`;

  const prov = map.provenance || {};
  $('pills').innerHTML = [
    prov.dataAsAt ? `<span class="pill">Services as at ${esc(prov.dataAsAt)}</span>` : '',
    `<span class="pill">Version ${esc(map.version)}</span>`,
    `<span class="pill">Published ${esc(when(map.publishedAt))}</span>`,
    `<span class="pill">${esc(services.routes.length)} service${services.routes.length === 1 ? '' : 's'}</span>`,
    ...(map.org.isDemo ? ['<span class="pill">Sample — not live</span>'] : []),
  ].filter(Boolean).join('');

  if (prov.stale) {
    $('staleNote').hidden = false;
    $('staleNote').className = 'notice notice-warn';
    $('staleNote').innerHTML = `<strong>This information may be out of date.</strong> It is correct as at
      ${esc(prov.dataAsAt || when(prov.publishedAt))}, which is more than ${esc(prov.staleAfterMonths)} months ago.
      Check with the operator or at <a href="https://bustimes.org" rel="nofollow noopener">bustimes.org</a> before you travel.`;
  }

  function routeSection(r) {
    const swatch = r.colour
      ? `<span class="route-badge" style="background:${esc(r.colour)};color:${esc(r.textOn || '#fff')}">${esc(r.id)}</span>`
      : `<span class="route-badge plain">${esc(r.id)}</span>`;
    const meta = [
      r.operator ? `Operated by ${esc(r.operator)}` : '',
      r.days ? esc(r.days) : '',
    ].filter(Boolean).join(' · ');

    const blocks = [];
    if (r.stopsInArea.length) {
      // The order the bus calls, which for most services means out and back —
      // so a stop legitimately appears twice. Say so rather than tidying it away.
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

  const ops = services.operators.length
    ? `<section class="card"><h3>Operators</h3><ul>${services.operators
        .map((o) => `<li><strong>${esc(o.name)}</strong>${o.routes.length ? ` — ${esc(o.routes.join(', '))}` : ''}</li>`)
        .join('')}</ul></section>`
    : '';
  // `note` explains how to read the PICTURE ("spokes show where you can get
  // to"), so it has no meaning here. The fare note is a fact and stays.
  const notes = services.fareNote ? `<p class="form-note">${esc(services.fareNote)}</p>` : '';

  $('services').innerHTML = `
    <nav class="route-jump" aria-label="Jump to a service">${services.routes
      .map((r) => `<a class="tab" href="#route-${esc(r.id)}">${esc(r.id)}</a>`).join('')}</nav>
    ${notes}
    ${services.routes.map(routeSection).join('')}
    ${ops}
    <p class="sheet-source">Base map © OpenStreetMap contributors (ODbL) · bus service data from the
      Bus Open Data Service (Open Government Licence) · times are not shown here — check
      <a href="https://bustimes.org" rel="nofollow noopener">bustimes.org</a> or the operator.</p>`;
})();
