// Public gallery of published maps (/maps). Reads /api/public/maps — which only
// ever returns published, listed maps of active organisations.
//
// Maps belonging to a SEEDED DEMO organisation are labelled "Sample" so a
// visitor can never mistake our own test data for an organisation's published
// work (org.isDemo comes from customer.is_demo — see src/branding/index.js).
//
// P9 Part B — the search box above the grid answers "does any map cover my
// village?" against place names inside the maps (GET /api/public/search), not
// the 13 map titles. Progressive enhancement: the form is a real GET to /maps
// and works with JS off; with it on, results filter in place and the URL
// stays in sync via history so /maps?q=… (or /maps#search) is linkable.
(() => {
  const grid = document.getElementById('grid');
  const form = document.querySelector('#search .search-form');
  const input = document.getElementById('q');
  const meta = document.getElementById('searchMeta');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  function card(m, reason) {
    const shot = (m.outputs.find((o) => o.previewUrl) || {}).previewUrl;
    const kind = m.kind === 'place' ? 'Place' : 'Area';
    return `<article class="card example pub-card">
      <a class="shot" href="${esc(m.url)}">${shot
        ? `<img src="${esc(shot)}" loading="lazy" alt="${esc(m.name)} bus map">`
        : '<span class="shot-none">Map</span>'}</a>
      <div class="body">
        <h3>${m.org.isDemo ? '<span class="badge sample">Sample</span> ' : ''}<span class="badge ${m.kind === 'place' ? 'place' : ''}">${kind}</span> <a href="${esc(m.url)}">${esc(m.name)}</a></h3>
        <p>${esc(m.subject || '')}</p>
        ${reason ? `<p class="search-hit-reason">${esc(reason)}</p>` : ''}
        <div class="org-line">
          <span class="org-badge" style="--org-accent:${esc(m.org.accentHex)}">${esc(m.org.badge)}</span>
          <span>Published by ${m.org.url ? `<a href="${esc(m.org.url)}">${esc(m.org.name)}</a>` : esc(m.org.name)}${m.org.isDemo ? ' <span class="muted">— a sample organisation, not a real customer</span>' : ''}</span>
        </div>
        <div class="outputs">${esc(m.version)} · updated ${esc(when(m.publishedAt))} · ${m.outputs.length} sheet${m.outputs.length === 1 ? '' : 's'}</div>
      </div>
    </article>`;
  }

  // The no-match path (B6) is the point of the feature, not an error state: a
  // miss is a lead. No promised timescale, no claimed customers — see
  // docs/PILOT.md.
  function noResultBlock(q) {
    return `<div class="search-noresult">
      <p>No published map covers <strong>${esc(q)}</strong> yet. Maps are made by local organisations.</p>
      <p><a class="btn btn-primary" href="/apply.html">Ask for one</a> <a class="btn btn-ghost" href="/contact.html">or tell us who might make it</a></p>
    </div>`;
  }

  async function loadAll() {
    if (meta) meta.hidden = true;
    grid.className = 'grid cols-2';
    grid.innerHTML = '<p class="form-note">Loading published maps…</p>';
    try {
      const body = await (await fetch('/api/public/maps')).json();
      const maps = (body && body.maps) || [];
      if (!maps.length) {
        grid.className = '';
        grid.innerHTML = '<p class="form-note">No maps are published yet. Our <a href="/examples.html">examples</a> show what they look like — and if you would like one for your own area or doorstep, <a href="/apply.html">register your interest</a>.</p>';
        return;
      }
      grid.innerHTML = maps.map((m) => card(m)).join('');
    } catch {
      grid.className = '';
      grid.innerHTML = '<p class="form-note">Sorry — we could not load the published maps just now. Please try again shortly.</p>';
    }
  }

  async function runSearch(q) {
    if (meta) {
      meta.hidden = false;
      meta.textContent = `Searching for “${q}”…`;
    }
    try {
      const body = await (await fetch(`/api/public/search?q=${encodeURIComponent(q)}`)).json();
      const results = (body && body.results) || [];
      if (meta) meta.textContent = results.length
        ? `${results.length} map${results.length === 1 ? '' : 's'} match “${q}”.`
        : `No matches for “${q}”.`;
      grid.className = results.length ? 'grid cols-2' : '';
      grid.innerHTML = results.length
        ? results.map((r) => card(r.map, r.reason)).join('')
        : noResultBlock(q);
    } catch {
      if (meta) meta.textContent = '';
      grid.className = '';
      grid.innerHTML = '<p class="form-note">Sorry — search is not available just now. Please try again shortly.</p>';
    }
  }

  function apply(q, { push = true } = {}) {
    const trimmed = (q || '').trim();
    if (input) input.value = trimmed;
    const url = trimmed ? `/maps?q=${encodeURIComponent(trimmed)}` : '/maps';
    if (push && location.pathname + location.search !== url) history.replaceState(null, '', url);
    if (trimmed.length >= 2) runSearch(trimmed);
    else loadAll();
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      apply(input ? input.value : '');
    });
  }
  if (input) {
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => apply(input.value), 300);
    });
  }

  apply(new URLSearchParams(location.search).get('q') || '', { push: false });
})();
