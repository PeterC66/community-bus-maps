// One published map's public page (/m/<slug>). The slug comes from the path; the
// server has already 404'd anything that is not publicly visible.
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

  function show(o) {
    $('sheetImg').src = o.previewUrl || o.jpgUrl || '';
    $('sheetImg').alt = `${map.name} — ${o.label}`;
    $('sheetLink').href = o.jpgUrl || o.svgUrl || '#';
    $('sheetNote').textContent = 'Click the sheet to open the full-size printable version.';
    $('downloads').innerHTML =
      (o.jpgUrl ? `<a class="btn btn-primary btn-sm" href="${esc(o.jpgUrl)}?download">Download print sheet (A4, ${esc(mb(o.jpgBytes))})</a>` : '') +
      (o.svgUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(o.svgUrl)}?download">Download vector (SVG)</a>` : '');
    [...document.querySelectorAll('#tabs .tab')].forEach((b) => {
      const on = b.dataset.key === o.key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
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
  document.title = `${headline} — BusMaps.uk`;
  const desc = map.org.isDemo
    ? `A sample printable bus map${map.subject ? ' for ' + map.subject : ''}, made to demonstrate BusMaps.uk.`
    : `A printable bus map published by ${map.org.name}${map.subject ? ' for ' + map.subject : ''}, kept up to date as services change.`;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute('content', desc);
  const og = document.querySelector('meta[property="og:title"]');
  if (!og) {
    const t = document.createElement('meta'); t.setAttribute('property', 'og:title'); t.content = headline;
    document.head.appendChild(t);
  }

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

  $('fbSlug').value = map.slug;
  const about = map.subject
    ? `This ${map.kind === 'place' ? 'place' : 'area'} map covers ${map.subject}. It is drawn from official open bus data and checked by a person before each publication.`
    : 'This map is drawn from official open bus data and checked by a person before each publication.';
  $('aboutText').textContent = map.org.isDemo
    ? `${about} It is a sample, kept as a demonstration rather than as live travel information.`
    : about;
  $('aboutPills').innerHTML = [
    `<span class="pill">Version ${esc(map.version)}</span>`,
    `<span class="pill">Published ${esc(when(map.publishedAt))}</span>`,
    '<span class="pill">Free to print &amp; share</span>',
    ...(map.org.isDemo ? ['<span class="pill">Sample — not live</span>'] : []),
  ].join('');
  if (map.reportUrl) {
    $('reportLink').innerHTML = `<a href="${esc(map.reportUrl)}?download">⬇ Disagreements report (PDF)</a> — every route we checked against bustimes.org and the operator's own site.`;
    $('reportLink').hidden = false;
  }
  $('asideGrid').hidden = false;

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
  $('sheetBox').hidden = false;
  show(map.outputs[0]);
})();
