// OA-545 — a map's own description: one or two sentences about THIS map, shown
// on its public page and used as the page's meta description. Written first for
// High Wycombe, whose whole-town map and town-centre map each need to say what
// the other is for. An organisation's `blurb` (src/branding) cannot do it: that
// belongs to the customer and is shared by every map it owns.

export const DESCRIPTION_MAX = 400;

/**
 * Clean a description for storage. Control characters and runs of whitespace
 * become one space, angle brackets are dropped (the value is rendered on public
 * pages and in a <meta> tag, and is escaped there as well — stripping means a
 * stored value can never LOOK like markup), and the result is cut at
 * DESCRIPTION_MAX. Anything that is not a string, or is empty once cleaned,
 * is '' and so stores as NULL.
 */
export function cleanDescription(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\p{C}/gu, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX).trim();
}
