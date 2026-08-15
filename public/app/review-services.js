// Preview of a PENDING submission's own text alternative — the evidence
// behind review checklist item 3 (`alternative`). Deliberately reads the
// version under review, not the currently-published one (src/server.js
// GET /api/review/:id/services), so an approver never signs off on a check
// they actually ran against stale, already-public content.
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = (items) => items.map((s) => `<li>${esc(s)}</li>`).join('');
  const id = new URLSearchParams(location.search).get('id');

  async function jget(url) { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => ({})) }; }

  const me = await jget('/api/me');
  if (me.status === 401) { location.href = '/app/login.html'; return; }
  if (!me.body.user || (me.body.user.role !== 'approver' && me.body.user.role !== 'admin')) { location.href = '/app'; return; }
  $('whoami').textContent = `${me.body.user.email} · ${me.body.user.role}`;
  $('logoutBtn').style.display = '';
  $('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/login.html'; });

  if (!id) { $('headline').textContent = 'No submission specified'; $('err').hidden = false; $('err').textContent = 'Open this page from a review submission, not directly.'; return; }

  let map, services;
  try {
    const { status, body } = await jget(`/api/review/${encodeURIComponent(id)}/services`);
    if (status !== 200 || !body.ok) throw new Error((body && body.error) || 'not found');
    map = body.map; services = body.services;
  } catch (e) {
    $('headline').textContent = 'Could not load the service list';
    $('err').hidden = false;
    $('err').textContent = e.message || 'This version has no service list to preview.';
    return;
  }

  const subject = services.subject || map.name;
  $('headline').textContent = `Bus services ${services.kind === 'place' ? 'serving' : 'in'} ${subject} — ${map.version}`;
  document.title = `Service list preview — ${map.name} ${map.version} — BusMaps.uk`;

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
  const notes = services.fareNote ? `<p class="form-note">${esc(services.fareNote)}</p>` : '';

  $('services').innerHTML = `
    <nav class="route-jump" aria-label="Jump to a service">${services.routes
      .map((r) => `<a class="tab" href="#route-${esc(r.id)}">${esc(r.id)}</a>`).join('')}</nav>
    ${notes}
    ${services.routes.map(routeSection).join('')}
    ${ops}`;
})();
