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

import { suggestionApplies, suggestionLetter, letterPlainText } from './suggest-letter.mjs';

/** HTML-escape a value for use in text or a quoted attribute. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A LINK OFF THIS SITE, to somebody else's council website.
 *
 * `target="_blank"` on every one of them (buses-data OA-380 (a)). None of these
 * links had it, and each leaves busmaps.uk for a site where the reader typically
 * has several more clicks before they reach an actual map — Cambridgeshire and
 * Peterborough's lands on a page holding six PDFs — so they came back, if at all,
 * by pressing Back through a site they had been navigating. Our own map links
 * keep the tab: a reader following one of those is going where the page promised.
 *
 * `rel="nofollow noopener"` as before. The `↗` is what tells the reader before
 * they click; the panel's own note says once, in words, that these open in a new
 * tab, rather than repeating it on each of three links.
 */
function ext(href, text) {
  return `<a href="${esc(href)}" target="_blank" rel="nofollow noopener">${esc(text)} ↗</a>`;
}

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
 * THE ONE SENTENCE ABOVE THE GRID that says what the search did.
 *
 * It returns TEXT, not markup, because it has two callers that put it in the
 * page by different means — `textContent` in public/js/public-maps.js and
 * `setInner` (escaped) in src/routes/public.js — and the only way to guarantee
 * they say the same thing is for there to be one string.
 *
 * IT HAD ONE CALLER UNTIL TODAY, AND THAT WAS THE BUG (buses-data OA-380 (e)).
 * The sentence lived in public-maps.js alone, which by design does no first
 * render, so `https://busmaps.uk/maps?q=Eynesbury` carried no sentence at all:
 * a reader who followed a shared link got High Wycombe for a Cambridgeshire
 * village with nothing on the page to say that "Eynesbury" had been read as
 * "Aylesbury". That is the same argument this file's own header makes about the
 * grid, left undone for the line above it.
 *
 * @param {string} q
 * @param {{results?: object[], corrected?: string|null, directory?: object[]}} r
 * @returns {string} plain text, or '' when there is nothing to say
 */
export function searchMeta(q, { results = [], corrected = null, directory = [] } = {}) {
  if (!q) return '';
  if (results.length && corrected) return `No exact match for “${q}” — showing results for “${corrected}”.`;
  // "1 map matches", not "1 map match" — the old inline version put the `s` on
  // the noun and left the verb alone, which nobody had read on a page until this
  // sentence started being rendered server-side.
  if (results.length) return `${results.length} map${results.length === 1 ? ' matches' : 's match'} “${q}”.`;
  // Not "no matches": we found somebody else's map, which is an answer.
  if (directory.length) return `No map of ours matches “${q}” — but see what the local transport authority publishes, below.`;
  return `No matches for “${q}”.`;
}

/**
 * The no-match block (P9 B6). A miss is a lead, not an error state: no promised
 * timescale and no claimed customers — see docs/PILOT.md.
 *
 * `hasDirectory` is true when the directory panel below the grid is about to
 * answer the same query with somebody else's map. The sentence changes because
 * "no published map covers X" followed immediately by a card showing a map that
 * covers X reads as a contradiction, and the reader is right.
 *
 * BOTH BRANCHES NOW OFFER THE SAME TWO DOORS (buses-data OA-380 (b) and (c)).
 * `/apply.html` opens "Tell us a little about your organisation" and requires an
 * organisation name and type — and the reader who has just been told nobody maps
 * their village is usually a member of the public with no organisation to name.
 * The directory branch used to offer that door and only that door, so the reader
 * with the weakest answer got the narrowest set of options. And it said "covers
 * X" where the other branch says "covers X yet", which is the difference between
 * a statement about the world and a statement about how far we have got.
 */
export function noResultBlock(q, hasDirectory = false) {
  const doors = `<p><a class="btn btn-primary" href="${esc(askForOneHref(q))}">Ask for a map of ${esc(q)}</a> <a class="btn btn-ghost" href="/apply.html">I'm asking for an organisation</a></p>`;
  if (hasDirectory) {
    return `<div class="search-noresult">
      <p>No map published <em>through this portal</em> covers <strong>${esc(q)}</strong> yet — but somebody else publishes one. See below.</p>
      ${doors}
    </div>`;
  }
  return `<div class="search-noresult">
      <p>No published map covers <strong>${esc(q)}</strong> yet. Maps are made by local organisations.</p>
      ${doors}
    </div>`;
}

/**
 * Where "ask for a map of X" goes for somebody who is not an organisation.
 *
 * `/contact.html` asks for a message, an optional name and an optional email,
 * which is the right amount to ask of a resident. `?kind=map-request` preselects
 * the reason and `?place=` prefills the first line, so the reader arrives at a
 * form that already knows what they came for; both degrade to a form they can
 * fill in themselves with no JavaScript, which is why the question is a select
 * option in the shell rather than something the link invents.
 */
export function askForOneHref(place) {
  const q = place ? `&place=${encodeURIComponent(place)}` : '';
  return `/contact.html?kind=map-request${q}`;
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
 * OA-308 TIER 3 adds a fourth thing that is not optional: where the directory
 * says nobody publishes a map of the reader's town, the card carries the LETTER
 * that asks for one — visible in full, never behind JavaScript, and addressed by
 * the reader from their own email. public/js/shared/suggest-letter.mjs holds the
 * four rules that block exists to keep, the first of which is that we never send
 * it. `query` and `matchKind` are what decide whether it appears at all.
 *
 * @param {object} d   an offer as shaped by offerOf() in src/search/directory.js
 * @param {string} reason why this row answered the query
 * @param {{query?: string, matchKind?: string}} [ctx] what the reader asked, and how this row answered
 */
export function directoryCard(d, reason, ctx = {}) {
  const what = d.status === 'network'
    ? `Publishes a map of the whole network${d.format ? ` (${esc(d.format)})` : ''}${d.dated ? `, dated ${esc(monthGB(d.dated))}` : ''}.`
    : d.status === 'town'
      ? `Publishes maps of individual towns${d.towns.length ? `: ${d.towns.map(esc).join(', ')}${d.townsMore ? ' and some others' : ''}` : ''}.`
      : 'Publishes no bus map that we could find.';
  const action = d.status === 'none'
    ? (d.landingPage ? ext(d.landingPage, 'Their bus pages') : '')
    : (d.url ? ext(d.url, 'Open their map page') : '');
  // A DIFFERENT public authority's map for part of this area. This block is the
  // reason the whole panel is worth having for a reader in York: the combined
  // authority publishes nothing, the city council publishes a good map, and a
  // card that stopped at "publishes no bus map" would be true about the
  // authority and wrong about the question asked.
  const also = (d.also || []).map((a) => `<p class="dir-also"><strong>But:</strong> ${a.url
    ? ext(a.url, `${a.publisher} publishes one for ${a.covers}`)
    : `${esc(a.publisher)} publishes one for ${esc(a.covers)}`}${a.what ? ` — ${esc(a.what)}` : ''}${a.checked ? ` <span class="muted">(last checked on ${esc(whenGB(a.checked))})</span>` : ''}</p>`).join('');
  return `<article class="card dir-card">
      <div class="body">
        <h3><span class="badge notours">Not ours</span> ${esc(d.authority)}</h3>
        <p>${what}</p>
        ${also}
        ${reason ? `<p class="search-hit-reason">${esc(reason)}</p>` : ''}
        <div class="outputs">Published by ${esc(d.authority)}, last checked on ${esc(whenGB(d.checked))}</div>
        ${action ? `<p class="dir-action">${action}</p>` : ''}
        ${suggestBlock(d, ctx)}
      </div>
    </article>`;
}

/**
 * OA-308 TIER 3 — "then ask them for one", under the row that just said nobody
 * publishes it.
 *
 * `<details>` rather than an always-open block, because the letter is six
 * paragraphs and the card above it is four lines: open by default it would bury
 * the second and third directory rows under the first one's letter. `<details>`
 * is also the one disclosure widget that works with JavaScript off, which
 * matters here more than anywhere else on the site — the reader this exists for
 * is the reader who got no map.
 *
 * The copy button is `hidden` in the markup and public-maps.js unhides it. That
 * way round on purpose: a button that does nothing is worse than no button, and
 * with no JavaScript there is nothing for it to do. The letter itself is in the
 * page either way.
 */
function suggestBlock(d, { query = '', matchKind = '' } = {}) {
  const { show } = suggestionApplies(d, query, matchKind);
  if (!show) return '';
  const letter = suggestionLetter(d, query);
  const plain = letterPlainText(letter);
  return `<details class="dir-ask">
        <summary>Ask them for one — a letter you can send</summary>
        <p class="dir-ask-note"><strong>You send this, not us.</strong> A council answers a resident of its own area; it files a supplier's round robin. Copy it into your own email, add your name and where you live, and send it to ${esc(d.authority)} — their website has the contact address, and a named councillor or your MP is worth copying in. Your town or parish council can commission a map too, and often decides faster than a county can; there is no national list of their addresses, so you will need to look yours up.</p>
        <p class="dir-ask-note"><strong>Put it in your own words.</strong> A short letter that sounds like you is worth ten identical ones — say which bus you use, or which journey you cannot work out. What is below is a starting point, not a form.</p>
        <pre class="dir-letter" data-letter>${esc(plain)}</pre>
        <p class="dir-ask-actions"><button type="button" class="btn btn-ghost" data-copy-letter hidden>Copy the letter</button></p>
        <p class="dir-ask-note dir-ask-extra"><strong>If you would like to mention us, add this — and only if you want to.</strong> We have deliberately kept it out of the letter above: a letter that recommends a supplier without saying who wrote it is not a letter from a resident.</p>
        <pre class="dir-letter" data-letter-extra>${esc(letter.extra)}</pre>
      </details>`;
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
 * Since buses-data OA-312 (2026-09-16) the panel also says WHERE the place is,
 * when the directory's own names did not answer and the Index of Place Names
 * did: "Burford is in West Oxfordshire, Oxfordshire, whose local transport
 * authority is Oxfordshire County Council", then the row's card as before, then
 * one sentence pointing at the map-request route (decision 3 of the plan), then
 * the other Burfords with their district and county (decision 5). A Scottish or
 * Welsh place gets a plain England-only sentence (decision 4). A name the Index
 * does not hold gets the honest sentence above, WORD FOR WORD — that is the
 * property OA-312 said must survive — with one line saying the Index was asked
 * too. Every rendering that consulted the Index carries its edition and licence
 * in a footer line, which is the half of "when was this last checked" that is
 * ours to state.
 *
 * @param {{offer:object, reason:string}[]} rows
 * @param {{query?: string, size?: number, place?: object|null}} opts  `size` = how many authorities the directory holds; `place` as shaped by searchDirectoryWithPlace()
 */
export function directoryBlock(rows, { query = '', size = 0, place = null } = {}) {
  if (!query) return '';
  const p = place || {};
  const source = p.source && p.source.edition
    ? `<p class="dir-source muted">Place names and districts from the ${esc(p.source.publisher ? 'ONS ' : '')}${esc(p.source.dataset || 'Index of Place Names')}, ${esc(p.source.edition)} edition, ${esc(p.source.licence || 'Open Government Licence')}.</p>`
    : '';
  const others = (p.others || []).length
    ? `<p class="dir-others">Other places called ${esc(p.name)}: ${p.others.map((o) => `<a href="/maps?q=${encodeURIComponent(o.query)}">${esc(o.name)}, ${esc(o.where)}${o.country && o.country !== 'England' ? ` (${esc(o.country)})` : ''}</a>`).join(' · ')}</p>`
    : '';
  if (!rows.length) {
    let said;
    if (p.kind === 'outside') {
      said = `<p><strong>${esc(p.name)}</strong> is in ${esc(p.country)}${p.where && p.where !== p.name ? ` (${esc(p.where)})` : ''}. This directory covers the ${size || ''} English local transport authorities only, so we cannot say what is published for it.</p>${others}`;
    } else if (p.kind === 'unlisted') {
      said = `<p><strong>${esc(p.name)}</strong> is in ${esc(p.where)}, whose council is its own transport authority and is not one of the ${size || ''} in our directory, so we cannot say what is published for it.</p>${others}`;
    } else if (p.kind === 'short') {
      said = `<p><strong>${esc(query)}</strong> is the start of ${p.count ? `${p.count} place names` : 'too many place names to list'}. Type more of the name and we will say which authority covers it.</p>`;
    } else {
      // The honest miss, word for word as it has read since the panel shipped.
      said = `<p>We keep a directory of what all ${size || ''} English local transport authorities publish, and nothing in it matches <strong>${esc(query)}</strong> by name. That does not prove there is no map — it means we cannot tell you which authority covers ${esc(query)}. Searching for the county or the authority instead, e.g. <em>Cambridgeshire</em>, will say what that authority publishes.</p>`
        + (p.kind === 'none' && source ? `<p class="muted">Nor is it a place name in the Index of Place Names, which lists every named place in Great Britain.</p>` : '');
    }
    return `<div class="dir-block dir-empty">
      <h3>Does anybody else publish one?</h3>
      ${said}
      ${source}
    </div>`;
  }
  const placed = p.kind === 'england'
    ? `<p class="dir-place"><strong>${esc(p.name)}</strong> is in ${esc(p.where)}, whose local transport authority is ${esc(p.authority)}.</p>`
    : '';
  // OA-380 (c) — this sentence is addressed to whoever just searched, which on a
  // village name is most often a resident. It used to send them to /apply.html,
  // which opens by asking for an organisation name.
  const ask = p.kind === 'england'
    ? `<p class="dir-ask">If you would like a map of ${esc(p.name)} itself, you can <a href="${esc(askForOneHref(p.name))}">ask for one</a> — or <a href="/apply.html">register an organisation's interest</a> if you are asking on behalf of one.</p>`
    : '';
  return `<div class="dir-block">
      <h3>Not ours — what the local transport authority publishes</h3>
      ${placed}
      <p class="dir-note">These are other people's maps, listed so you can find one that already exists. We checked that each was there on the date shown and nothing more: we do not maintain them and cannot vouch for what they say. Links marked ↗ leave this site and open in a new tab, and often land on a page you will have to look through rather than on the map itself.</p>
      <div class="grid cols-2">${rows.map((r) => directoryCard(r.offer, r.reason, { query, matchKind: (r.matched || {}).kind || '' })).join('')}</div>
      ${ask}
      ${others}
      ${source}
    </div>`;
}

/** Nothing is published at all — a real state on a fresh install, not an error. */
export function emptyBlock() {
  return `<p class="form-note">No maps are published yet. Our <a href="/examples.html">examples</a> show what they look like — and if you would like one for your own area or doorstep, <a href="${askForOneHref('')}">ask for one</a>, or <a href="/apply.html">register your organisation's interest</a>.</p>`;
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
