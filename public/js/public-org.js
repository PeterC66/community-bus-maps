// One organisation's public page (/o/<slug>): its branding + its published maps.
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = decodeURIComponent(location.pathname.replace(/^\/o\//, '').replace(/\/+$/, ''));

  let org, maps;
  try {
    const res = await fetch(`/api/public/orgs/${encodeURIComponent(slug)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error('not found');
    org = body.org; maps = body.maps;
  } catch {
    $('head').innerHTML = '<h2 class="mt-0">We can’t find that organisation</h2>';
    $('err').hidden = false;
    $('err').innerHTML = 'They may not have published a map yet. <a href="/maps">Browse the published maps</a>.';
    return;
  }

  document.title = `${org.name} — bus maps — Community Bus Maps`;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute('content', org.isDemo
    ? `Sample bus maps for ${org.name}, an invented organisation used to demonstrate Community Bus Maps.`
    : `Bus maps published by ${org.name} through Community Bus Maps.`);

  $('head').innerHTML = `
    <div class="org-line big">
      <span class="org-badge lg" style="--org-accent:${esc(org.accentHex)}">${esc(org.badge)}</span>
      <h2 class="mt-0">${esc(org.name)}${org.isDemo ? ' <span class="badge sample">Sample</span>' : ''}</h2>
    </div>
    ${org.isDemo ? '<p class="sample-note"><strong>This organisation is invented.</strong> It was created to demonstrate the system — the real body of this name has no connection with it, and the maps below are ours, not theirs. <a href="/faq.html#pilot">Why?</a></p>' : ''}
    ${org.blurb ? `<p class="section-intro">${esc(org.blurb)}</p>` : ''}
    ${org.website ? `<p class="form-note"><a href="${esc(org.website)}" rel="nofollow noopener">${esc(org.website)}</a></p>` : ''}`;

  $('grid').innerHTML = maps.map((m) => {
    const shot = (m.outputs.find((o) => o.previewUrl) || {}).previewUrl;
    return `<article class="card example pub-card">
      <a class="shot" href="${esc(m.url)}">${shot ? `<img src="${esc(shot)}" loading="lazy" alt="${esc(m.name)} bus map">` : '<span class="shot-none">Map</span>'}</a>
      <div class="body">
        <h3><span class="badge ${m.kind === 'place' ? 'place' : ''}">${m.kind === 'place' ? 'Place' : 'Area'}</span> <a href="${esc(m.url)}">${esc(m.name)}</a></h3>
        <p>${esc(m.subject || '')}</p>
        <div class="outputs">${esc(m.version)} · ${m.outputs.length} sheet${m.outputs.length === 1 ? '' : 's'}</div>
      </div>
    </article>`;
  }).join('');
})();
