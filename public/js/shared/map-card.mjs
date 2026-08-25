// One published-map card, rendered by BOTH the server and the browser.
//
// WHY THIS FILE IS SHARED RATHER THAN COPIED (technical-audit_2026-08-25 N1).
// /maps used to be a shell whose grid was filled entirely by public-maps.js, so
// `curl https://busmaps.uk/maps` returned 4,479 bytes containing the words
// "Loading published maps…" and NOT ONE link to a map. The catalogue is in
// sitemap.xml, indexing was switched on four days earlier, and the page's own
// data source — /api/public/maps — is `Disallow:`-ed in robots.txt, so a
// compliant crawler was forbidden from fetching the content the page needed.
//
// The fix is to render the grid server-side. The obvious way to do that is to
// write the card markup a second time in the server, and the obvious way is
// wrong: two hand-rolled copies of one rule are two chances to drift apart, and
// this codebase has been bitten by that often enough to say so out loud in
// several places. So the markup lives here once, as a plain ES module with no
// DOM and no Node dependency, and is imported by src/server.js and by
// public/js/public-maps.js alike.
//
// CONSTRAINTS THIS FILE MUST KEEP, because it runs in two very different places:
//   - No `document`, no `window`, no `process`, no `node:` imports. Strings in,
//     string out.
//   - It is served to browsers as a static asset from public/js/shared/, so it
//     is public. Nothing secret may pass through it.
//   - `type="module"` in the browser and a normal import in Node, which is why
//     the extension is .mjs and the paths in importers are explicit.

/** HTML-escape a value for use in text or a quoted attribute. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A date as a British reader writes it. Deliberately `en-GB` with an explicit
 * option bag rather than a locale default, because the server's locale and the
 * visitor's are different machines and the two renderings must agree — if they
 * did not, hydration would visibly rewrite the date on every page load.
 */
export function whenGB(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * One card in the published-maps grid.
 *
 * Maps belonging to a SEEDED DEMO organisation are labelled "Sample" so a
 * visitor can never mistake our own test data for an organisation's published
 * work (org.isDemo comes from customer.is_demo — see src/branding/index.js).
 *
 * @param {object} m      a map as shaped by publicMap() in src/public/index.js
 * @param {string} reason optional search-hit explanation ("mentions Swavesey")
 */
export function card(m, reason) {
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
        <div class="outputs">${esc(m.version)} · updated ${esc(whenGB(m.publishedAt))} · ${m.outputs.length} sheet${m.outputs.length === 1 ? '' : 's'}${
  m.provenance && m.provenance.stale ? ' · <span class="tag">may be out of date</span>' : ''}</div>
      </div>
    </article>`;
}

/**
 * The no-match block (P9 B6). A miss is a lead, not an error state: no promised
 * timescale and no claimed customers — see docs/PILOT.md.
 */
export function noResultBlock(q) {
  return `<div class="search-noresult">
      <p>No published map covers <strong>${esc(q)}</strong> yet. Maps are made by local organisations.</p>
      <p><a class="btn btn-primary" href="/apply.html">Ask for one</a> <a class="btn btn-ghost" href="/contact.html">or tell us who might make it</a></p>
    </div>`;
}

/** Nothing is published at all — a real state on a fresh install, not an error. */
export function emptyBlock() {
  return '<p class="form-note">No maps are published yet. Our <a href="/examples.html">examples</a> show what they look like — and if you would like one for your own area or doorstep, <a href="/apply.html">register your interest</a>.</p>';
}

/**
 * The whole grid, plus the class the grid container should carry.
 *
 * The class travels with the HTML because the two are one decision: a grid of
 * cards is `grid cols-2`, and the empty and no-match blocks are full width.
 * Returning them separately is what let the old client code set one without the
 * other.
 *
 * @param {object[]} maps
 * @param {{reasons?: Map<string,string>|null, query?: string}} opts
 * @returns {{className: string, html: string}}
 */
export function grid(maps, { reasons = null, query = '' } = {}) {
  if (!maps.length) {
    return { className: '', html: query ? noResultBlock(query) : emptyBlock() };
  }
  return {
    className: 'grid cols-2',
    html: maps.map((m) => card(m, reasons ? reasons.get(m.slug) : undefined)).join(''),
  };
}
