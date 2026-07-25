// The public read model (P6).
//
// Everything the unauthenticated site shows is derived here, from the rows the
// P6 queries in src/db/index.js already restricted to *published, listed maps of
// active customers*. This module's job is to shape those rows into the small,
// deliberately PII-free objects the public pages and the sitemap consume:
//
//   • no customer contact details, no user emails, no draft/pending versions,
//   • only the artefacts of the PUBLISHED version (P4's public-current pointer),
//   • only outputs whose files actually exist on disk.
//
// Publishing never re-renders (P4), so a public page always serves exactly the
// bytes an approver signed off.

import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { versionDir, OUTPUTS } from '../maps/store.js';
import { brandingForPublic } from '../branding/index.js';

/** Artefact basenames the public site knows about (internal / external / …). */
export const PUBLIC_BASES = Object.values(OUTPUTS).map((o) => o.base);

// A print JPG is A4 at 300 dpi (~1 MB) — far too heavy for a gallery page. The
// screen copy is DERIVED from that signed-off print file on first request and
// cached beside it, so no extra work happens at render time, versions published
// before P6 get previews too, and the print bytes are never touched.
const WEB_WIDTH = 1400;
const webName = (base) => `${base}-web.jpg`;

export async function webPreviewPath(mapId, storageKey, base) {
  const dir = versionDir(mapId, storageKey);
  const out = path.join(dir, webName(base));
  if (existsSync(out)) return out;
  const src = path.join(dir, `${base}.jpg`);
  if (!existsSync(src)) return null;
  await sharp(src).resize({ width: WEB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(out);
  return out;
}

const parseJson = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/** Public URL of a map's page. */
export const mapPageUrl = (slug) => `/m/${slug}`;
/** Public URL of an organisation's page. */
export const orgPageUrl = (slug) => `/o/${slug}`;

/**
 * The published artefacts of one map, by output — SVG + print JPG, whichever
 * exist in the published version's render folder.
 */
// The editor's output labels are written for the person editing ("Within the
// area"); a reader of a PLACE map's page needs different words. Public pages use
// these; the editor keeps OUTPUTS' own labels.
const PUBLIC_LABELS = {
  area: {
    internal_geographic: 'Buses within the area',
    external: 'Buses to nearby towns',
    internal_schematic: 'Simplified street map',
    internal_diagram: 'Network diagram',
  },
  place: {
    internal_geographic: 'Buses serving this place',
    external: 'Where those buses go',
    internal_schematic: 'Simplified street map',
    internal_diagram: 'Network diagram',
  },
};
export function publicLabel(key, kind) {
  return (PUBLIC_LABELS[kind === 'place' ? 'place' : 'area'] || {})[key] || '';
}

export function publicOutputs(row) {
  const dir = versionDir(row.id, row.pub_key);
  const enabled = parseJson(row.outputs);
  const out = [];
  for (const [key, meta] of Object.entries(OUTPUTS)) {
    if (!meta.portal) continue;
    // Same enablement rule as the engine: geographic outputs default on (maps
    // imported before toggles existed), expert styles are opt-in (P7).
    if (meta.expert ? enabled[key] !== true : enabled[key] === false) continue;
    const svg = path.join(dir, `${meta.base}.svg`);
    const jpg = path.join(dir, `${meta.base}.jpg`);
    if (!existsSync(svg) && !existsSync(jpg)) continue;
    out.push({
      key,
      base: meta.base,
      label: publicLabel(key, row.kind) || meta.label,
      svgUrl: existsSync(svg) ? fileUrl(row.slug, `${meta.base}.svg`) : null,
      jpgUrl: existsSync(jpg) ? fileUrl(row.slug, `${meta.base}.jpg`) : null,
      jpgBytes: existsSync(jpg) ? statSync(jpg).size : null,
      // Lightweight screen copy for the page itself (derived on first request).
      previewUrl: existsSync(jpg) ? `/api/public/maps/${row.slug}/preview/${meta.base}` : null,
    });
  }
  return out;
}

export const fileUrl = (slug, file) => `/api/public/maps/${slug}/${file}`;

/** One public map row → the object the public site renders. */
export function publicMap(row) {
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    subject: row.subject || '',
    version: row.pub_key,
    publishedAt: row.published_at,
    url: mapPageUrl(row.slug),
    org: brandingForPublic({
      name: row.customer_name, slug: row.customer_slug, branding_json: row.branding_json,
    }),
    outputs: publicOutputs(row),
  };
}

/** Only maps that actually have a file to show (a version folder can be pruned). */
export function publicMaps(rows) {
  return rows.map(publicMap).filter((m) => m.outputs.length);
}

/** One public organisation row → the object the public site renders. */
export function publicOrg(row) {
  return {
    ...brandingForPublic(row),
    type: row.type || 'other',
    url: row.slug ? orgPageUrl(row.slug) : null,
    publicMaps: row.public_maps != null ? row.public_maps : undefined,
  };
}

/** A one-line human description of a map, used in page titles + meta tags. */
export function mapHeadline(m) {
  return m.kind === 'place'
    ? `Buses serving ${m.name}`
    : `Buses within ${m.name}`;
}
