// An ALLOWLIST parse for the SVGs we inline into a public page (audit N18).
//
// What this replaces, and why it was not enough. `deactivate()` in inlineSvg.js
// was five regular expressions: drop <script>, drop `on*="…"` and `on*='…'`,
// drop `href="javascript:…"`. Every one of those is a DENYLIST, and the 2026-08-25
// audit listed what walks past it: `<circle onload=alert(1)>` (no quotes, so
// neither handler pattern matches), `<foreignObject>` (arbitrary HTML, including
// an <iframe>), `<animate attributeName="href" to="javascript:…">`, `<set>`, and
// entity-encoded variants of all of them. A denylist has to predict the attack;
// an allowlist only has to describe the artwork.
//
// THE ARTWORK IS SMALL, WHICH IS WHAT MAKES THIS PRACTICAL. Measured across all
// 1,277 SVGs in the map tree on 2026-08-25, the generators emit exactly eight
// elements — svg, g, path, rect, circle, line, text, clipPath — and 38 attribute
// names, none of them a URL of any kind and none of them an event handler. So
// the allowlist below is not a guess about what is safe; it is a census of what
// is drawn, plus <title>/<desc>, which inlineSvg.js adds itself for the screen
// reader.
//
// A NEW ELEMENT MUST BE A LOUD FAILURE, NOT A QUIET STRIP. If the engine starts
// emitting <tspan> or a gradient, silently dropping it would make the web view
// differ from the printed sheet with nothing to say so — the exact shape of the
// faults this project keeps finding. So: every drop is COUNTED and returned, the
// caller logs it, and scripts/test-svg-sanitise.mjs asserts that every sheet in
// the fixture corpus passes through completely untouched. Extending the engine's
// vocabulary is then a deliberate edit here, with a red test to prompt it.
//
// BYTES ARE PRESERVED UNLESS SOMETHING IS ACTUALLY REMOVED. A kept element is
// re-emitted as its ORIGINAL source text, not re-serialised from parsed parts,
// so attribute order, spacing and quoting are exactly as the generator wrote
// them. Only a tag that lost an attribute is rewritten. That is what lets the
// corpus test assert byte-identity rather than "looks the same".

/**
 * Elements the generators emit, plus the accessibility nodes and the
 * post-generation layer's own markup.
 *
 * `tspan` IS THE ONE THIS LIST WAS MISSING, and how it was missed is the useful
 * part. The census that produced this allowlist was taken over the map tree —
 * 1,277 files of GENERATOR output — and no generator emits a tspan. The portal
 * does: `src/render/pilotStamp.js` writes the band's headline as
 * `<tspan font-weight="bold">PILOT — SAMPLE MAP</tspan>`, AFTER the generator has
 * run (see engine/README.md). So the corpus measured was not the population this
 * function processes, and the first deploy silently deleted the words "PILOT —
 * SAMPLE MAP" from every inlined sheet while leaving the red band behind them.
 * Caught by fetching the live SVG before and after and comparing bytes — not by
 * any test, and not by the corpus, which could not see it.
 *
 * So: anything the post-generation layer adds belongs here too. Today that is
 * `tspan` and nothing else (`pilotStamp.js` also emits g/rect/text, `draftStamp.js`
 * rewrites an existing text, `watermark.js` builds a separate SVG for the raster
 * path and is never inlined). `scripts/test-inline-svg.mjs` now runs a real
 * stamped sheet through, so the next addition fails there instead of on the site.
 */
export const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'line', 'text', 'tspan', 'clipPath', 'title', 'desc',
]);

/** Attribute names the generators emit, plus the ones inlineSvg() adds. */
export const ALLOWED_ATTRS = new Set([
  // geometry
  'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'width', 'height', 'd',
  'viewBox', 'transform', 'preserveAspectRatio',
  // paint
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'paint-order', 'opacity',
  // text
  'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline',
  // structure and hooks
  'xmlns', 'id', 'class', 'clip-path',
  // added by inlineSvg() for the screen reader
  'role', 'aria-labelledby',
]);

/** Lower-cased index of the above; `clipPath` is the one name that is not flat. */
const ELEMENT_BY_LC = new Map([...ALLOWED_ELEMENTS].map((e) => [e.toLowerCase(), e]));

/** `data-*` is inert and the generators use two of them (data-key, data-kind). */
const DATA_ATTR = /^data-[a-z][a-z0-9-]*$/;

/** Attributes whose value may be a `url(#local)` reference and nothing else. */
const URL_VALUED = new Set(['clip-path', 'fill', 'stroke', 'mask', 'filter']);

// One tag, comment, CDATA, processing instruction or doctype. The attribute part
// deliberately tolerates unquoted values, because `<circle onload=alert(1)>` is
// the case the old denylist could not see.
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>|<\/\s*([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR = /([a-zA-Z_:][\w:.\-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|([a-zA-Z_:][\w:.\-]*)/g;

/** Entity- and whitespace-tolerant read of a value, for deciding if it is a URL scheme. */
function decodeish(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&(amp|colon|NewLine|Tab);/gi, (_, n) => ({ amp: '&', colon: ':', newline: '\n', tab: '\t' }[n.toLowerCase()]))
    .replace(/[\s\u0000-\u0020\u00a0]/g, '')
    .toLowerCase();
}

function valueIsSafe(name, rawValue) {
  const v = decodeish(rawValue);
  // No scheme is ever needed by the artwork; the generators emit none at all.
  if (/^(javascript|data|vbscript|blob|file):/.test(v)) return false;
  if (/(javascript|vbscript):/.test(v) && /url\(/.test(v)) return false;
  if (URL_VALUED.has(name) && v.includes('url(')) {
    // `url(#something)` only — never `url(http…)`, which would reach off-origin.
    const refs = v.match(/url\([^)]*\)/g) || [];
    if (refs.some((ref) => !/^url\(['"]?#[^)'"]+['"]?\)$/.test(ref))) return false;
  }
  return true;
}

/**
 * Strip everything that is not part of the artwork.
 *
 * @param {string} source raw SVG text
 * @returns {{svg: string, dropped: {elements: Object<string, number>, attributes: Object<string, number>}, clean: boolean}}
 */
export function sanitiseSvg(source) {
  const droppedElements = Object.create(null);
  const droppedAttrs = Object.create(null);
  const out = [];
  const openStack = [];      // kept elements, for pairing
  let skip = null;           // { name, depth } while inside a dropped subtree
  let last = 0;

  const noteEl = (n) => { droppedElements[n] = (droppedElements[n] || 0) + 1; };
  const noteAttr = (n) => { droppedAttrs[n] = (droppedAttrs[n] || 0) + 1; };

  /** Text between tags: kept verbatim, except a stray `<` that never parsed as one. */
  const emitText = (text) => { if (!skip && text) out.push(text.replace(/</g, '&lt;')); };

  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(source)) !== null) {
    emitText(source.slice(last, m.index));
    last = TOKEN.lastIndex;
    const raw = m[0];
    const closeName = m[1];
    const openName = m[2];
    const attrSrc = m[3] || '';
    const selfClosing = m[4] === '/';

    // Comments, CDATA, doctypes and processing instructions are never emitted by
    // the generators and are dropped rather than reasoned about.
    if (!closeName && !openName) { noteEl(raw.startsWith('<!--') ? '#comment' : '#directive'); continue; }

    if (skip) {
      // Inside a dropped subtree: track depth so a nested same-name tag does not
      // end it early, and emit nothing at all.
      if (openName && openName.toLowerCase() === skip.name && !selfClosing) skip.depth++;
      else if (closeName && closeName.toLowerCase() === skip.name) {
        skip.depth--;
        if (skip.depth === 0) skip = null;
      }
      continue;
    }

    if (closeName) {
      const name = closeName.toLowerCase();
      const at = openStack.lastIndexOf(name);
      if (at === -1) continue;               // a close with no open: drop it
      openStack.length = at;
      out.push(raw);
      continue;
    }

    const name = openName.toLowerCase();
    if (!ELEMENT_BY_LC.has(name)) {
      noteEl(name);
      if (!selfClosing) skip = { name, depth: 1 };
      continue;
    }

    // Filter the attributes. If nothing goes, the ORIGINAL bytes are re-emitted.
    const kept = [];
    let lostOne = false;
    ATTR.lastIndex = 0;
    let a;
    while ((a = ATTR.exec(attrSrc)) !== null) {
      const attrName = a[1] || a[5];
      if (!attrName) continue;
      const value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : null;
      const lower = attrName.toLowerCase();
      const allowed = (ALLOWED_ATTRS.has(attrName) || DATA_ATTR.test(lower))
        && (value === null || valueIsSafe(lower, value));
      if (!allowed) { noteAttr(lower); lostOne = true; continue; }
      kept.push(value === null ? attrName : `${attrName}="${String(value).replace(/"/g, '&quot;')}"`);
    }

    if (!lostOne) out.push(raw);
    else out.push(`<${openName}${kept.length ? ' ' + kept.join(' ') : ''}${selfClosing ? '/' : ''}>`);
    if (!selfClosing) openStack.push(name);
  }
  emitText(source.slice(last));

  const clean = Object.keys(droppedElements).length === 0 && Object.keys(droppedAttrs).length === 0;
  return { svg: out.join(''), dropped: { elements: droppedElements, attributes: droppedAttrs }, clean };
}

/** One line naming what was removed, for a log. Empty string when nothing was. */
export function describeDrops(dropped) {
  const parts = [];
  for (const [k, v] of Object.entries(dropped.elements || {})) parts.push(`<${k}>×${v}`);
  for (const [k, v] of Object.entries(dropped.attributes || {})) parts.push(`${k}=×${v}`);
  return parts.join(', ');
}
