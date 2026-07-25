// Public gallery of published maps (/maps). Reads /api/public/maps — which only
// ever returns published, listed maps of active organisations.
(async () => {
  const grid = document.getElementById('grid');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  function card(m) {
    const shot = (m.outputs.find((o) => o.previewUrl) || {}).previewUrl;
    const kind = m.kind === 'place' ? 'Place' : 'Area';
    return `<article class="card example pub-card">
      <a class="shot" href="${esc(m.url)}">${shot
        ? `<img src="${esc(shot)}" loading="lazy" alt="${esc(m.name)} bus map">`
        : '<span class="shot-none">Map</span>'}</a>
      <div class="body">
        <h3><span class="badge ${m.kind === 'place' ? 'place' : ''}">${kind}</span> <a href="${esc(m.url)}">${esc(m.name)}</a></h3>
        <p>${esc(m.subject || '')}</p>
        <div class="org-line">
          <span class="org-badge" style="--org-accent:${esc(m.org.accentHex)}">${esc(m.org.badge)}</span>
          <span>Published by ${m.org.url ? `<a href="${esc(m.org.url)}">${esc(m.org.name)}</a>` : esc(m.org.name)}</span>
        </div>
        <div class="outputs">${esc(m.version)} · updated ${esc(when(m.publishedAt))} · ${m.outputs.length} sheet${m.outputs.length === 1 ? '' : 's'}</div>
      </div>
    </article>`;
  }

  try {
    const body = await (await fetch('/api/public/maps')).json();
    const maps = (body && body.maps) || [];
    if (!maps.length) {
      grid.className = '';
      grid.innerHTML = `<p class="form-note">No maps are published yet. Our <a href="/examples.html">examples</a> show what they look like — and if you would like one for your own area or doorstep, <a href="/apply.html">apply to join</a>.</p>`;
      return;
    }
    grid.innerHTML = maps.map(card).join('');
  } catch {
    grid.className = '';
    grid.innerHTML = '<p class="form-note">Sorry — we could not load the published maps just now. Please try again shortly.</p>';
  }
})();
