// Per-customer public branding (P6).
//
// An organisation's public identity — the name, website, one-line blurb, badge
// emoji and accent colour shown on its public map pages and organisation page.
//
// Two deliberate boundaries:
//
//  1. **Server-enforced whitelist.** Like src/maps/safeSubset.js, this module
//     rebuilds the stored object from scratch from a small set of validated
//     fields, so nothing a customer POSTs can smuggle markup, javascript: URLs
//     or arbitrary colours onto a public page. Unknown keys are dropped and
//     reported (`rejected`), never persisted.
//
//  2. **Branding does NOT enter the printed sheet.** It decorates the portal's
//     own public page around the map. Putting a logo or an organisation's colours
//     *inside* the SVG would need a new generator knob and would re-open the
//     byte-identical render gate for every existing map — that is expert work
//     (P7), not a customer-editable field. See docs/ROADMAP.md.
//
// No email address or phone number is brandable on purpose: enquiries about a
// public map come back through the portal's own "report a problem" form, so a
// customer's contact details are never scrapeable from the public site.

/** Accent colours a customer may pick (fixed list — no free-form hex). */
export const ACCENTS = {
  blue:   { label: 'Blue',   hex: '#1b4db3' },
  teal:   { label: 'Teal',   hex: '#0f7b73' },
  green:  { label: 'Green',  hex: '#2c6e2f' },
  purple: { label: 'Purple', hex: '#5b3ea8' },
  red:    { label: 'Red',    hex: '#a8321f' },
  amber:  { label: 'Amber',  hex: '#9a6100' },
  slate:  { label: 'Slate',  hex: '#3c4858' },
};
export const DEFAULT_ACCENT = 'blue';

export const BRANDING_FIELDS = ['publicName', 'website', 'blurb', 'emoji', 'accent'];

const LIMITS = { publicName: 80, website: 200, blurb: 220, emoji: 8 };

// \p{C} = every control/format/unassigned code point — these end up inside HTML
// and XML (the sitemap), so strip them before anything else.
const text = (v, max) =>
  typeof v === 'string'
    ? v.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

// Angle brackets have no place in an organisation name or blurb, and these
// strings are rendered on public pages: drop them here as well as escaping at
// render time, so a stored value can never *look* like markup. (The badge field
// keeps its own rule — it REJECTS anything with markup rather than stripping it,
// because a stripped tag would leave a nonsense glyph like "img".)
const plain = (v, max) => text(v, max).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/** http(s) URLs only, and only ones that parse — no javascript:/data:/mailto:. */
export function cleanUrl(v) {
  const s = text(v, LIMITS.website);
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let u;
  try { u = new URL(withScheme); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (!u.hostname.includes('.')) return '';
  return u.toString().slice(0, LIMITS.website);
}

/**
 * A short badge glyph: an emoji or a couple of letters. Anything with markup,
 * or more than a few glyphs, is dropped (the UI then falls back to initials
 * derived from the name).
 */
export function cleanEmoji(v) {
  const s = text(v, LIMITS.emoji);
  if (!s) return '';
  if (/[<>&"'/\\]/.test(s)) return '';
  // Count user-perceived characters, not UTF-16 units (emoji are surrogate pairs).
  if ([...s].length > 4) return '';
  return s;
}

/** Initials fallback for the badge when no emoji is set (e.g. "St Ives TC" → "SI"). */
export function initialsFor(name) {
  const words = String(name || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '•';
}

/**
 * Rebuild a branding object from untrusted input.
 * @returns {{ branding: object, rejected: string[] }}
 */
export function sanitizeBranding(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const rejected = [];
  const out = {};

  const publicName = plain(src.publicName, LIMITS.publicName);
  if (publicName) out.publicName = publicName;
  else if (src.publicName) rejected.push('publicName');

  if (src.website) {
    const url = cleanUrl(src.website);
    if (url) out.website = url;
    else rejected.push('website');
  }

  const blurb = plain(src.blurb, LIMITS.blurb);
  if (blurb) out.blurb = blurb;
  else if (src.blurb) rejected.push('blurb');

  if (src.emoji) {
    const e = cleanEmoji(src.emoji);
    if (e) out.emoji = e;
    else rejected.push('emoji');
  }

  if (src.accent) {
    if (Object.prototype.hasOwnProperty.call(ACCENTS, src.accent)) out.accent = src.accent;
    else rejected.push('accent');
  }

  for (const k of Object.keys(src)) if (!BRANDING_FIELDS.includes(k)) rejected.push(k);
  return { branding: out, rejected: [...new Set(rejected)] };
}

export function parseBranding(json) {
  try { return sanitizeBranding(JSON.parse(json || '{}')).branding; } catch { return {}; }
}

/**
 * The branding a public page renders for an organisation: the stored fields with
 * every gap filled, so templates never have to decide on a fallback.
 * @param {{ name?:string, slug?:string, branding_json?:string, is_demo?:number }} customer
 */
export function brandingForPublic(customer) {
  const c = customer || {};
  const b = parseBranding(c.branding_json);
  const name = b.publicName || c.name || 'A local organisation';
  const accent = b.accent && ACCENTS[b.accent] ? b.accent : DEFAULT_ACCENT;
  return {
    name,
    slug: c.slug || null,
    // Seeded demo organisation rather than a real customer. Travels with the
    // branding so every public surface can label it without a second lookup.
    isDemo: !!c.is_demo,
    website: b.website || '',
    blurb: b.blurb || '',
    badge: b.emoji || initialsFor(name),
    isEmojiBadge: !!b.emoji,
    accent,
    accentHex: ACCENTS[accent].hex,
  };
}
