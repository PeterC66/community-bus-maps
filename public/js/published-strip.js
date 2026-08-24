// Home page: a short strip of what has actually been published. The whole
// section stays hidden when nothing is public yet, so the shopfront never shows
// an empty shelf. Seeded demo organisations are labelled "Sample" — during the
// pilot they are the only thing in here.
(async () => {
  const sec = document.getElementById('publishedSection');
  const strip = document.getElementById('publishedStrip');
  if (!sec || !strip) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cardHtml = (m, output) => {
    const shot = output && output.previewUrl;
    const outputLine = output && output.key !== 'internal_geographic'
      ? `<div class="org-line">${esc(output.label)}</div>` : '';
    return `<article class="card example pub-card">
      <a class="shot" href="${esc(m.url)}">${shot ? `<img src="${esc(shot)}" loading="lazy" alt="${esc(m.name)} — ${esc(output.label)}">` : '<span class="shot-none">Map</span>'}</a>
      <div class="body">
        <h3>${m.org.isDemo ? '<span class="badge sample">Sample</span> ' : ''}<span class="badge ${m.kind === 'place' ? 'place' : ''}">${m.kind === 'place' ? 'Place' : 'Area'}</span> <a href="${esc(m.url)}">${esc(m.name)}</a></h3>
        <div class="org-line"><span class="org-badge" style="--org-accent:${esc(m.org.accentHex)}">${esc(m.org.badge)}</span><span>${esc(m.org.name)}</span></div>
        ${outputLine}
      </div>
    </article>`;
  };
  try {
    const body = await (await fetch('/api/public/maps')).json();
    const all = (body && body.maps) || [];
    // Beaconsfield Simpson Centre's slot is deliberately handed to a boarding-plan
    // showcase instead (2026-08-25): boarding plans are the newest output (see
    // What's new below) and St Neots Town Centre is the clean case for it — no
    // route/colour clash on its index, unlike the High Wycombe sheets — so the
    // front page demonstrates the feature rather than only claiming it. Still
    // fully live: both cards read their image straight from /api/public/maps, the
    // same as every other card here, so a re-publish updates them with nothing to
    // edit on this page. Beaconsfield Simpson Centre stays listed on /maps.
    const others = all.filter((m) => m.slug !== 'beaconsfield-simpson-centre');
    const boardingMap = others.find((m) => m.slug === 'st-neots-town-centre');
    const boardingOutput = boardingMap && boardingMap.outputs.find((o) => o.key === 'boarding_plan' && o.previewUrl);
    const rest = others.slice(0, boardingOutput ? 2 : 3);
    const cards = rest.map((m) => cardHtml(m, m.outputs.find((o) => o.previewUrl)));
    if (boardingOutput) cards.push(cardHtml(boardingMap, boardingOutput));
    if (!cards.length) return;
    strip.innerHTML = cards.join('');
    sec.hidden = false;
  } catch { /* leave the section hidden */ }
})();
