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
 *
 * `hasDirectory` is true when the directory panel below the grid is about to
 * answer the same query with somebody else's map. The sentence changes because
 * "no published map covers X" followed immediately by a card showing a map that
 * covers X reads as a contradiction, and the reader is right.
 */
export function noResultBlock(q, hasDirectory = false) {
  if (hasDirectory) {
    return `<div class="search-noresult">
      <p>No map published <em>through this portal</em> covers <strong>${esc(q)}</strong> — but somebody else publishes one. See below.</p>
      <p><a class="btn btn-ghost" href="/apply.html">Ask for one of ours as well</a></p>
    </div>`;
  }
  return `<div class="search-noresult">
      <p>No published map covers <strong>${esc(q)}</strong> yet. Maps are made by local organisations.</p>
      <p><a class="btn btn-primary" href="/apply.html">Ask for one</a> <a class="btn btn-ghost" href="/contact.html">or tell us who might make it</a></p>
    </div>`;
}

/**
 * ONE ROW OF THE NATIONAL DIRECTORY OF LOCAL BUS MAPS (buses-data OA-308).
 *
 * This is somebody else's map, and the card's whole job is to be unmistakable
 * about that. Three things are therefore not optional:
 *
 *   - the "Not ours" badge and the `dir-card` class, so it cannot be skimmed as
 *     one of the cards above it;
 *   - "Published by <authority>, last checked on <date>" in full, because the
 *     date is the only thing we actually vouch for — that it was there when we
 *     looked, not that it is right or current now;
 *   - an authority that publishes NOTHING still gets a card. That is the most
 *     useful answer on the page for somebody about to ask a council for a map,
 *     and suppressing it would leave the reader thinking we simply had not
 *     looked.
 *
 * @param {object} d   an offer as shaped by offerOf() in src/search/directory.js
 * @param {string} reason why this row answered the query
 */
export function directoryCard(d, reason) {
  const what = d.status === 'network'
    ? `Publishes a map of the whole network${d.format ? ` (${esc(d.format)})` : ''}${d.dated ? `, dated ${esc(monthGB(d.dated))}` : ''}.`
    : d.status === 'town'
      ? `Publishes maps of individual towns${d.towns.length ? `: ${d.towns.map(esc).join(', ')}${d.townsMore ? ' and some others' : ''}` : ''}.`
      : 'Publishes no bus map that we could find.';
  const action = d.status === 'none'
    ? (d.landingPage ? `<a href="${esc(d.landingPage)}" rel="nofollow noopener">Their bus pages</a>` : '')
    : (d.url ? `<a href="${esc(d.url)}" rel="nofollow noopener">Open their map</a>` : '');
  // A DIFFERENT public authority's map for part of this area. This block is the
  // reason the whole panel is worth having for a reader in York: the combined
  // authority publishes nothing, the city council publishes a good map, and a
  // card that stopped at "publishes no bus map" would be true about the
  // authority and wrong about the question asked.
  const also = (d.also || []).map((a) => `<p class="dir-also"><strong>But:</strong> ${a.url
    ? `<a href="${esc(a.url)}" rel="nofollow noopener">${esc(a.publisher)} publishes one for ${esc(a.covers)}</a>`
    : `${esc(a.publisher)} publishes one for ${esc(a.covers)}`}${a.what ? ` — ${esc(a.what)}` : ''}${a.checked ? ` <span class="muted">(last checked on ${esc(whenGB(a.checked))})</span>` : ''}</p>`).join('');
  return `<article class="card dir-card">
      <div class="body">
        <h3><span class="badge notours">Not ours</span> ${esc(d.authority)}</h3>
        <p>${what}</p>
        ${also}
        ${reason ? `<p class="search-hit-reason">${esc(reason)}</p>` : ''}
        <div class="outputs">Published by ${esc(d.authority)}, last checked on ${esc(whenGB(d.checked))}</div>
        ${action ? `<p class="dir-action">${action}</p>` : ''}
      </div>
    </article>`;
}

/** "2026-07" as "July 2026". A bare year stays a bare year. */
export function monthGB(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return String(ym || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return isNaN(d) ? String(ym) : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The directory panel that sits below the grid: everything we know about who
 * else publishes a map for this query, or an honest sentence saying we could
 * not place the query at all.
 *
 * The empty case is deliberately NOT silent. A reader who searched for
 * "Harrogate" and got nothing needs to know that the question was asked and
 * came back empty — otherwise the only reading left is that we never looked.
 *
 * @param {{offer:object, reason:string}[]} rows
 * @param {{query?: string, size?: number}} opts  `size` = how many authorities the directory holds
 */
export function directoryBlock(rows, { query = '', size = 0 } = {}) {
  if (!query) return '';
  if (!rows.length) {
    return `<div class="dir-block dir-empty">
      <h3>Does anybody else publish one?</h3>
      <p>We keep a directory of what all ${size || ''} English local transport authorities publish, and nothing in it matches <strong>${esc(query)}</strong> by name. That does not prove there is no map — it means we cannot tell you which authority covers ${esc(query)}. Searching for the county or the authority instead, e.g. <em>Cambridgeshire</em>, will say what that authority publishes.</p>
    </div>`;
  }
  return `<div class="dir-block">
      <h3>Not ours — what the local transport authority publishes</h3>
      <p class="dir-note">These are other people's maps, listed so you can find one that already exists. We checked that each was there on the date shown and nothing more: we do not maintain them and cannot vouch for what they say.</p>
      <div class="grid cols-2">${rows.map((r) => directoryCard(r.offer, r.reason)).join('')}</div>
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
 * @param {{reasons?: Map<string,string>|null, query?: string, hasDirectory?: boolean}} opts
 * @returns {{className: string, html: string}}
 */
export function grid(maps, { reasons = null, query = '', hasDirectory = false } = {}) {
  if (!maps.length) {
    return { className: '', html: query ? noResultBlock(query, hasDirectory) : emptyBlock() };
  }
  return {
    className: 'grid cols-2',
    html: maps.map((m) => card(m, reasons ? reasons.get(m.slug) : undefined)).join(''),
  };
}
