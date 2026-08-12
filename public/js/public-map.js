// One published map's public page (/m/<slug>). The slug comes from the path; the
// server has already 404'd anything that is not publicly visible, and has
// completed the <head> (title, description, canonical, Open Graph, JSON-LD)
// before this runs — so everything here is the visible page, not metadata.
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = decodeURIComponent(location.pathname.replace(/^\/m\//, '').replace(/\/+$/, ''));
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const mb = (n) => (n ? `${(n / 1048576).toFixed(1)} MB` : '');

  let map = null;
  let viewer = null;

  function show(o) {
    if (!o) return;
    viewer.show(o, `${map.name} — ${o.label}`);
    $('sheetNote').textContent = 'Drag to move around the map, and zoom in for the detail. '
      + 'The printable sheet is below.';
    $('downloads').innerHTML =
      (o.jpgUrl ? `<a class="btn btn-primary btn-sm" href="${esc(o.jpgUrl)}?download">Download print sheet (A4, ${esc(mb(o.jpgBytes))})</a>` : '') +
      (o.svgUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(o.svgUrl)}?download">Download vector (SVG)</a>` : '') +
      (o.jpgUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(o.jpgUrl)}" target="_blank" rel="noopener">Open the image on its own</a>` : '');
    [...document.querySelectorAll('#tabs .tab')].forEach((b) => {
      const on = b.dataset.key === o.key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // Keep the address bar on the sheet actually being looked at, so a link
    // someone shares opens the same one.
    const u = new URL(location.href);
    u.searchParams.set('output', o.key);
    history.replaceState(null, '', u);
  }

  try {
    const res = await fetch(`/api/public/maps/${encodeURIComponent(slug)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error((body && body.error) || 'not found');
    map = body.map;
  } catch {
    $('headline').textContent = 'We can’t find that map';
    $('err').hidden = false;
    $('err').innerHTML = 'It may not be published any more. <a href="/maps">Browse the published maps</a>.';
    return;
  }

  const headline = map.kind === 'place' ? `Buses serving ${map.name}` : `Buses within ${map.name}`;
  // <head> (title, description, canonical, Open Graph, JSON-LD) is completed
  // SERVER-side now (P8a) — a crawler never runs this script, so it must not
  // be the only place that content exists. See server.js's /m/:slug route.

  $('head').innerHTML = `
    <h2 class="mt-0">${esc(headline)} <span class="badge ${map.kind === 'place' ? 'place' : ''}">${map.kind === 'place' ? 'Place' : 'Area'}</span>${
      map.org.isDemo ? ' <span class="badge sample">Sample</span>' : ''}</h2>
    ${map.org.isDemo ? '<p class="sample-note"><strong>This is a sample map.</strong> The organisation named below is invented and no one publishes this map — it exists to demonstrate the system. Do not use it to catch a bus. <a href="/faq.html#pilot">Why?</a></p>' : ''}
    <div class="org-line big">
      <span class="org-badge" style="--org-accent:${esc(map.org.accentHex)}">${esc(map.org.badge)}</span>
      <span>Published by ${map.org.url ? `<a href="${esc(map.org.url)}">${esc(map.org.name)}</a>` : esc(map.org.name)}${
        map.org.website ? ` · <a href="${esc(map.org.website)}" rel="nofollow noopener">their website</a>` : ''}</span>
    </div>
    ${map.org.blurb ? `<p class="section-intro">${esc(map.org.blurb)}</p>` : ''}`;

  if (map.bannerNote) {
    $('bannerNote').innerHTML = `⚠ <strong>Changes coming:</strong> ${esc(map.bannerNote)}`;
    $('bannerNote').hidden = false;
  }

  // A leaflet on a noticeboard is obviously a snapshot; a web page implies it is
  // current. So say when the information is from, and admit when that is old.
  const prov = map.provenance || {};
  if (prov.stale) {
    $('staleNote').hidden = false;
    $('staleNote').className = 'notice notice-warn';
    $('staleNote').innerHTML = `<strong>This map may be out of date.</strong> It shows services as at
      ${esc(prov.dataAsAt || when(prov.publishedAt))}, which is more than ${esc(prov.staleAfterMonths)} months ago.
      Check with the operator or at <a href="https://bustimes.org" rel="nofollow noopener">bustimes.org</a> before you travel.`;
  }

  $('fbSlug').value = map.slug;
  const about = map.subject
    ? `This ${map.kind === 'place' ? 'place' : 'area'} map covers ${map.subject}. It is drawn from official open bus data and checked by a person before each publication.`
    : 'This map is drawn from official open bus data and checked by a person before each publication.';
  $('aboutText').textContent = map.org.isDemo
    ? `${about} It is a sample, kept as a demonstration rather than as live travel information.`
    : about;
  $('aboutPills').innerHTML = [
    // "Edition" was this page's own word for what every other screen — and the
    // organisation that publishes it — calls a version (findings D).
    prov.dataAsAt ? `<span class="pill">Services as at ${esc(prov.dataAsAt)}</span>` : '',
    `<span class="pill">Version ${esc(map.version)}</span>`,
    `<span class="pill">Published ${esc(when(map.publishedAt))}</span>`,
    '<span class="pill">Free to print &amp; share</span>',
    ...(map.org.isDemo ? ['<span class="pill">Sample — not live</span>'] : []),
  ].filter(Boolean).join('');
  if (map.reportUrl) {
    $('reportLink').innerHTML = `<a href="${esc(map.reportUrl)}?download">⬇ Disagreements report (PDF)</a> — every route we checked against bustimes.org and the operator's own site.`;
    $('reportLink').hidden = false;
  }
  $('asideGrid').hidden = false;

  if (map.servicesUrl) {
    $('altCard').hidden = false;
    $('altLink').href = map.servicesUrl;
  }

  if (!map.outputs.length) {
    $('err').hidden = false;
    $('err').textContent = 'This map has no sheets available at the moment.';
    return;
  }
  $('tabs').innerHTML = map.outputs
    .map((o) => `<button class="tab" type="button" role="tab" data-key="${esc(o.key)}">${esc(o.label)}</button>`)
    .join('');
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) show(map.outputs.find((o) => o.key === b.dataset.key));
  });
  // Attribution belongs on the screen, not only on the printed sheet.
  $('sheetSource').innerHTML = 'Base map © OpenStreetMap contributors (ODbL) · bus service data from the '
    + 'Bus Open Data Service (Open Government Licence)'
    + (map.servicesUrl ? ` · <a href="${esc(map.servicesUrl)}">this map as text</a>` : '');
  $('sheetBox').hidden = false;

  viewer = window.CBMViewer.create($('viewer'));
  const wanted = new URLSearchParams(location.search).get('output');
  show(map.outputs.find((o) => o.key === wanted) || map.outputs[0]);

  // The card was hidden when the page loaded, so a #report link (footer,
  // contact.html) needs the browser's own anchor-jump redone now it's
  // visible. Unlike the old plain <img>, the viewer stage has a fixed
  // aspect-ratio box (public/css/styles.css `.viewer-stage`), so its size
  // is known synchronously — no need to wait on the async SVG fetch inside
  // viewer.show() the way the old code waited on an image load.
  if (location.hash === '#report') {
    requestAnimationFrame(() => { if (location.hash === '#report') $('report').scrollIntoView(); });
  }
})();
