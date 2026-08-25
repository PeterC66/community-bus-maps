// Prepare a published SVG for INLINE use on a web page (P8a).
//
// The public page used to show a downscaled JPG of the print sheet. Serving the
// generator's own SVG instead is sharper, smaller over the wire (a St Ives
// internal map is 472 KB raw but 88 KB gzipped, against ~1 MB for the print JPG)
// and it is what makes pan/zoom worth having. It also carries real <text>, so
// the browser's own find-in-page and text zoom work.
//
// The DOWNLOAD route still serves the untouched, signed-off bytes. This is a
// separate, derived representation for the screen, and it differs in four ways:
//
//   1. The root's fixed width/height (3508×2480 px, i.e. A4 at 300 dpi) is
//      dropped so the viewBox alone drives layout and the map scales to its box.
//   2. role="img" + <title>/<desc>, so a screen reader announces the picture and
//      points at the text alternative rather than reading 117 stray labels.
//   3. font-family="Arial" becomes a stack including the metric-compatible
//      Liberation Sans / Arimo. Label positions were computed against Arial's
//      metrics, so a substituted font with different widths can collide — see
//      hasMetricFont() in public/js/map-viewer.js, which falls back to the
//      raster sheet when the browser has none of them.
//   4. Anything that is not artwork is stripped, by an ALLOWLIST parse in
//      svgSanitise.js. The generators emit no scripts and no event handlers, but
//      inlining turns an inert <img> into live DOM. Until 2026-08-25 the strip
//      was five regular expressions, and audit N18 listed what walked past them
//      — an UNQUOTED `onload=`, <foreignObject>, <animate>, <set>, and
//      entity-encoded variants. The allowlist describes the artwork instead of
//      predicting the attack, and it is inert on every sheet the engine has ever
//      produced: 1,277 of them pass through byte for byte.
//
// Everything else — every path, colour, label and coordinate — is untouched.

import { readFileSync } from 'node:fs';
import { sanitiseSvg, describeDrops } from './svgSanitise.js';

/** Arial first (it is what the labels were laid out against), then metric twins. */
export const FONT_STACK = "Arial, 'Liberation Sans', Arimo, Helvetica, 'Nimbus Sans', sans-serif";

const escText = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {string} file      path to a published <base>.svg
 * @param {{title: string, desc: string, idPrefix?: string, onDrop?: (what: string) => void}} labels
 *        `onDrop` is called with a description when the sanitiser removed
 *        anything. Our own sheets never trip it, so a call means either an
 *        attack or — far likelier — the engine has started drawing something
 *        the allowlist does not know about, which must not vanish silently.
 * @returns {string} the SVG source, ready to be dropped into a page
 */
export function inlineSvg(file, { title, desc, idPrefix = 'cbm', onDrop } = {}) {
  const cleaned = sanitiseSvg(readFileSync(file, 'utf8'));
  if (!cleaned.clean && typeof onDrop === 'function') onDrop(describeDrops(cleaned.dropped));
  let svg = cleaned.svg;

  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error('not an SVG');
  let root = open[0];

  // Keep the viewBox, drop the print-size attributes, and add the accessibility
  // hooks. Any attribute we set is removed first so re-running is a no-op.
  root = root
    .replace(/\s(width|height)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(role|aria-labelledby|preserveAspectRatio|class)\s*=\s*"[^"]*"/gi, '')
    .replace(/>$/, ` class="cbm-map-svg" role="img" aria-labelledby="${idPrefix}-t ${idPrefix}-d"`
      + ' preserveAspectRatio="xMidYMid meet">');

  const heading = `<title id="${idPrefix}-t">${escText(title)}</title>`
    + `<desc id="${idPrefix}-d">${escText(desc)}</desc>`;

  svg = svg.slice(0, open.index) + root + heading + svg.slice(open.index + open[0].length);
  return svg.replace(/font-family="Arial"/g, `font-family="${FONT_STACK}"`);
}
