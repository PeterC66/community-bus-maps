// Keep route-number badges legible after a recolour.
//
// A route badge is drawn as a filled circle with the route number centred on it.
// The circle takes the route's colour — which a customer may change in the safe
// subset — but the NUMBER takes `textOn[route]` from the map's routes.json, which
// is a fixed part of the imported data. Recolour a pale route to something dark
// (or the reverse) and the number vanishes into its own badge: on St Ives, route
// 9 recoloured to black kept `#111` text and became unreadable on every sheet.
//
// Why here and not in the generators: exactly the reason given in pilotStamp.js —
// generators are VENDORED per map (data/maps/<id>/data/gen_*.js), so editing
// engine/ fixes nothing for maps that already exist. Overlaying the finished SVG
// covers all four outputs, every map ever imported, and every map imported later,
// from one function. Unlike the pilot band this is NOT pilot-gated: it is a
// correctness guarantee about the sheet, and must survive PILOT_MODE=0.
//
// It is a no-op on a sheet whose badges are already legible, so a map using its
// imported palette is byte-for-byte what the generator produced.

/** WCAG relative luminance of an #rgb / #rrggbb colour, or null if unparseable. */
function luminance(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two colours, or null if either is unparseable. */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Deliberately well below WCAG's 3:1 for large text. The palettes we import are
// somebody's design work, and several shipped route colours sit just under 3:1
// (white on #EE7733 is 2.87 and appears on three towns' maps) — silently
// restyling those would be overreach. This threshold catches only a number that
// has genuinely VANISHED into its badge: #111 on black, the case that prompted
// it, is 1.11. Anything a designer chose and can still be read is left alone.
export const MIN_RATIO = 2;

/** The badge ink to use on `bg`: keep `want` when it is legible, else black/white. */
export function inkFor(bg, want) {
  const r = contrastRatio(bg, want);
  if (r === null || r >= MIN_RATIO) return want;
  const dark = '#111111', light = '#ffffff';
  return (contrastRatio(bg, light) || 0) >= (contrastRatio(bg, dark) || 0) ? light : dark;
}

// A badge in every generator is a circle immediately followed by a <text> at the
// SAME centre — `badge()` in gen_internal.js / gen_external.js / the place pair.
// Requiring the coordinates to match (back-references \1 and \2) is what makes
// this specific to badges rather than to any circle that happens to precede text.
const BADGE = /(<circle\s+cx="(-?[\d.]+)"\s+cy="(-?[\d.]+)"[^>]*?\bfill="(#[0-9a-fA-F]{3,6})"[^>]*\/>\s*<text\s+x="\2"\s+y="\3"[^>]*?\bfill=")(#[0-9a-fA-F]{3,6})(")/g;

/**
 * Repair unreadable route-number badges in a finished sheet.
 * @param {string} svg  a complete SVG document
 * @returns {string}    the same document, badge ink corrected where needed
 */
export function fixBadgeContrast(svg) {
  if (typeof svg !== 'string') return svg;
  return svg.replace(BADGE, (whole, head, _cx, _cy, bg, ink, tail) => {
    const want = inkFor(bg, ink);
    return want === ink ? whole : head + want + tail;
  });
}
