// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// Stamps "PILOT — SAMPLE MAP" onto a rendered sheet.
//
// Why here and not in the generators: a map's generators are VENDORED into that
// map's own data folder (data/maps/<id>/data/gen_*.js), so editing engine/ would
// not change a single existing map, and editing every vendored copy would both
// be unmaintainable and re-open the byte-identical render gate. Overlaying the
// finished SVG instead covers all four outputs, every map ever imported, and
// every map imported in future — from one function, gated on one flag.
//
// Why a RESERVED BAND and not a corner box: the sheets have no reliable
// whitespace. The obvious corners are taken — top-left by the title, top-right
// and right by the Services panel, bottom by the source/credits note — and a
// stamp dropped into any of them sits on top of real information, which is
// worse than not stamping at all. So instead the artwork is shrunk by ~4% and
// slid down, and the band occupies space that belongs to nothing. That works
// for all four outputs, and for any output added later, without knowing
// anything about their internals.
//
// generateSvg() is untouched by this, so scripts/verify-reproduce.mjs still
// compares pristine generator output and stays green.

import { PILOT } from '../config.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Read the user-space box of an SVG root, whatever units the generator chose. */
function viewBoxOf(svg) {
  const m = svg.match(/<svg\b[^>]*\bviewBox\s*=\s*"([^"]+)"/i);
  if (!m) return null;
  const p = m[1].trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) return null;
  return { x: p[0], y: p[1], w: p[2], h: p[3] };
}

/** Index just past the SVG root's opening tag, skipping any `>` inside quotes. */
function endOfOpenTag(svg) {
  const start = svg.search(/<svg\b/i);
  if (start === -1) return -1;
  let quote = null;
  for (let i = start; i < svg.length; i++) {
    const c = svg[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '>') return i + 1;
  }
  return -1;
}

/**
 * Reserve a pilot band at the top of an SVG sheet.
 *
 * The whole document is wrapped in one transform that shrinks it just enough to
 * clear the band and re-centres it horizontally, so nothing is cropped and the
 * aspect ratio is preserved. Sizes are proportional to the sheet's own user
 * space, so the area sheets (297×210 "mm"), the place sheets and the P7 expert
 * styles are all handled without special-casing.
 *
 * @param {string} svg  a complete SVG document
 * @returns {string}    the same document with the band added, or unchanged if it
 *                      has no usable viewBox (never throws on odd input)
 */
export function stampPilot(svg) {
  if (!PILOT.on || typeof svg !== 'string') return svg;
  if (svg.includes('id="pilot-band"')) return svg; // never stamp twice
  const vb = viewBoxOf(svg);
  const open = endOfOpenTag(svg);
  const close = svg.lastIndexOf('</svg>');
  if (!vb || open === -1 || close === -1 || close < open) return svg; // not ours to touch

  const band = vb.h * 0.042; // ~8.8mm on an A4 landscape sheet
  const s = (vb.h - band) / vb.h;
  // translate(TX,TY) scale(s) maps p → s·p + T. Land the artwork immediately
  // below the band, horizontally centred in the width the shrink freed up.
  const tx = vb.x * (1 - s) + (vb.w * (1 - s)) / 2;
  const ty = vb.y * (1 - s) + band;

  const pad = band * 0.34;
  const head = PILOT.stampHeading;
  // NBSPs: a renderer may collapse ordinary leading/trailing space in a tspan.
  const body = ` · ${PILOT.stampNotes.join(' ')}`;

  const before = [
    // The generator's own white background is inside the group and no longer
    // covers the sheet, and transparent pixels rasterise to black in a JPEG.
    `<rect id="pilot-bg" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#ffffff"/>`,
    `<g id="pilot-content" transform="translate(${tx.toFixed(3)},${ty.toFixed(3)}) scale(${s.toFixed(6)})">`,
  ].join('\n');

  const after = [
    '</g>',
    '<g id="pilot-band">',
    `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${band.toFixed(3)}" fill="#b30000"/>`,
    `<text x="${(vb.x + pad).toFixed(2)}" y="${(vb.y + band * 0.66).toFixed(2)}" font-family="Arial"`
      + ` font-size="${(band * 0.46).toFixed(2)}" fill="#ffffff">`
      + `<tspan font-weight="bold">${esc(head)}</tspan>${esc(body)}</text>`,
    '</g>',
  ].join('\n');

  return svg.slice(0, open) + '\n' + before + '\n'
    + svg.slice(open, close)
    + after + '\n' + svg.slice(close);
}
