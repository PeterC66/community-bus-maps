// Home page: a short strip of what has actually been published. The whole
// section stays hidden when nothing is public yet, so the shopfront never shows
// an empty shelf. Seeded demo organisations are labelled "Sample" — during the
// pilot they are the only thing in here.
(async () => {
  const sec = document.getElementById('publishedSection');
  const strip = document.getElementById('publishedStrip');
  if (!sec || !strip) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    const body = await (await fetch('/api/public/maps')).json();
    const maps = ((body && body.maps) || []).slice(0, 3);
    if (!maps.length) return;
    strip.innerHTML = maps.map((m) => {
      const shot = (m.outputs.find((o) => o.previewUrl) || {}).previewUrl;
      return `<article class="card example pub-card">
        <a class="shot" href="${esc(m.url)}">${shot ? `<img src="${esc(shot)}" loading="lazy" alt="${esc(m.name)} bus map">` : '<span class="shot-none">Map</span>'}</a>
        <div class="body">
          <h3>${m.org.isDemo ? '<span class="badge sample">Sample</span> ' : ''}<span class="badge ${m.kind === 'place' ? 'place' : ''}">${m.kind === 'place' ? 'Place' : 'Area'}</span> <a href="${esc(m.url)}">${esc(m.name)}</a></h3>
          <div class="org-line"><span class="org-badge" style="--org-accent:${esc(m.org.accentHex)}">${esc(m.org.badge)}</span><span>${esc(m.org.name)}</span></div>
        </div>
      </article>`;
    }).join('');
    sec.hidden = false;
  } catch { /* leave the section hidden */ }
})();
