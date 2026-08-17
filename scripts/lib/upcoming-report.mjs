// Shared parsing for the Buses side's monthly "get ahead" GTFS scan
// (upcoming-report_<date>.md), used by both scripts/check-upcoming-refreshes.mjs
// (flags already-built maps) and scripts/import-map.mjs (seeds a new map's
// banner at build time if we already know of a change it doesn't reflect yet).
//
// The scan reports TOWNS and, since 2026-08-17, PLACES. A place section carries a
// `_kind place · …_` meta line naming its parent town and service radius, so a
// place map can be joined to its own section by name instead of being guessed at
// by substring. Reports written before that change have no place sections at all,
// which is what `reportHasPlaces` detects — see mapsForSection below.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const BUSES_DIR = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
export const UPCOMING_DIR = path.join(BUSES_DIR, '_gtfs', 'upcoming');

export function newestReportPath() {
  if (!existsSync(UPCOMING_DIR)) return null;
  const files = readdirSync(UPCOMING_DIR).filter((f) => /^upcoming-report_\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  return files.length ? path.join(UPCOMING_DIR, files[files.length - 1]) : null;
}

export function reportDateOf(reportPath) {
  return (path.basename(reportPath).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || path.basename(reportPath);
}

/**
 * The `_…_` meta line under a section heading: `_region <r>_` for a town,
 * `_kind place · region <r> · town <T> · radius <k> km_` for a place.
 */
function parseMeta(bodyLines) {
  const line = (bodyLines.find((l) => l.trim().startsWith('_')) || '').trim();
  const field = (name) => (line.match(new RegExp(`${name} ([^·_]+)`)) || [])[1]?.trim() || null;
  return {
    kind: /^_kind place\b/.test(line) ? 'place' : 'area',
    region: field('region'),
    parent: field('town'),
    radiusKm: field('radius') ? parseFloat(field('radius')) : null,
  };
}

/**
 * One section per town or place: "## <Name> — <verdict>" plus its meta line and
 * bullets, up to the next "## " or EOF. Split on the heading marker rather than a
 * lookahead-bounded regex — CRLF line endings make `$`/`\n?$` match at every line
 * end in multiline mode, not just EOF, so a lookahead-based "stop before the next
 * heading or EOF" silently stopped after the section's FIRST line every time.
 *
 * The verdict is parsed field-by-field rather than by one all-or-nothing regex.
 * It previously required `— (\d+) upcoming`, so a section reading "2 to verify"
 * (0 actionable, some [ENDS?]) matched nothing and was dropped in silence — a
 * possible withdrawal is exactly the advance notice this scan exists to give.
 *
 * EVERY scanned unit is returned, including "nothing upcoming" ones, with
 * `actionable` saying which have something to report. Callers that only want
 * flags should filter on it — but keeping the quiet ones is what lets a caller
 * tell "this map was scanned and is clear" from "this map was never scanned at
 * all", which is the difference between good news and a coverage hole. Only the
 * trailing "## Not checked — dataset unavailable" section is dropped: it lists
 * reasons, not units. Reports before 2026-08-01 have no `_…_` meta line at all,
 * hence the area/self defaults in parseMeta.
 *
 * @returns {Array<{name:string, town:string, kind:string, parent:string|null,
 *                  region:string|null, radiusKm:number|null, actionable:boolean,
 *                  upcoming:string, toVerify:string|null, bullets:string[]}>}
 */
export function parseSections(md) {
  return md.split(/^## /m).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const head = (nl >= 0 ? part.slice(0, nl) : part).replace(/\r$/, '');
    const lines = (nl >= 0 ? part.slice(nl + 1) : '').split('\n').map((l) => l.replace(/\r$/, ''));
    const h = head.match(/^(.+?) — (.+)$/);
    if (!h) return null;
    const name = h[1].trim();
    if (name === 'Not checked') return null; // the report's trailing "dataset unavailable" list
    const upcoming = (h[2].match(/(\d+) upcoming/) || [])[1] || '0';
    const toVerify = (h[2].match(/(\d+) to verify/) || [])[1] || null;
    const meta = parseMeta(lines);
    return {
      name,
      town: meta.kind === 'place' ? meta.parent || name : name, // back-compat: callers that only knew towns
      ...meta,
      actionable: upcoming !== '0' || !!toVerify,
      upcoming,
      toVerify,
      bullets: lines.filter((l) => l.trim().startsWith('- ')),
    };
  }).filter(Boolean);
}

/** Does this report distinguish places itself, or is it a pre-2026-08-17 one? */
export function reportHasPlaces(sections) {
  return sections.some((s) => s.kind === 'place');
}

/**
 * Maps a section applies to — exact, per kind. A place section matches the place
 * map of the same name; a town section matches only the AREA map of that name.
 *
 * The town arm deliberately no longer reaches place maps. It used to match them
 * by substring on `map.subject` ("Aldi, Tannery Road, High Wycombe" contains
 * "High Wycombe"), which was the only place coverage there was. The problem is
 * not duplicate flags — insertMessage is deduped per map per report date — it is
 * MIS-ATTRIBUTION, and it reaches the public: setMapBannerNoteAuto seeds a map's
 * "changes coming" banner from the matched section's first bullet, so on the real
 * 2026-08-17 report the Aldi map's public banner would have read "[NEW] WW1",
 * a brand-new service that does not serve that store, while the changes that DO
 * affect it (M40, X74) were relegated to "+2 more". The substring rule also could
 * not see a route reaching a place from outside its town's radius, and left a
 * place whose town isn't scanned with no coverage at all.
 */
export function mapsForSection(maps, section) {
  const lower = section.name.toLowerCase();
  const kind = section.kind === 'place' ? 'place' : 'area';
  return maps.filter((m) => m.kind === kind && (m.name || '').toLowerCase() === lower);
}

/**
 * The pre-places join, kept for reports written before the scan knew about
 * places: there, a place map's only hope of being flagged is its town's section.
 * Loose on purpose — a missed match just means a human reads the report the old
 * way; a false match just means an extra "you might want to check this".
 */
export function mapsForSectionLegacy(maps, section) {
  const lower = section.name.toLowerCase();
  return maps.filter((m) => (
    m.kind === 'area' ? (m.name || '').toLowerCase() === lower : (m.subject || '').toLowerCase().includes(lower)
  ));
}

/**
 * Live PLACE maps this report never looked at — the coverage hole that silence
 * hides. "No flag" for these means "nobody checked", not "no changes", and the
 * two are indistinguishable to a reader unless it is said out loud. A place is
 * scanned iff the Buses tree holds a built place folder of the same name, so a
 * map missing here is either named differently there or was never built as one.
 *
 * Only meaningful for a place-aware report; an older one lists no places at all,
 * which would make every place map look like a hole.
 */
export function unscannedPlaceMaps(sections, maps) {
  if (!reportHasPlaces(sections)) return [];
  const scanned = new Set(sections.filter((s) => s.kind === 'place').map((s) => s.name.toLowerCase()));
  return maps.filter((m) => m.kind === 'place' && !scanned.has((m.name || '').toLowerCase()));
}

/**
 * A short, public-facing sentence for a map's "changes coming" banner — plain
 * text (no markdown), capped to the DB column's 500 chars. Just the first (most
 * relevant) bullet plus a count of any others.
 */
export function summariseBullet(line) {
  return line.replace(/^- /, '').replace(/\*\*/g, '').trim();
}
export function bannerNoteFor(bullets) {
  if (!bullets || !bullets.length) return null;
  const first = summariseBullet(bullets[0]);
  const more = bullets.length > 1 ? ` (+${bullets.length - 1} more change${bullets.length > 2 ? 's' : ''} expected)` : '';
  return `${first}${more}`.slice(0, 500);
}

/**
 * Sections that apply to one map, for seeding its banner at import time. Prefers
 * the map's own section; falls back to the town-substring rule for reports
 * written before places had sections of their own.
 */
export function sectionsForMap(sections, map) {
  if (!map) return [];
  const live = sections.filter((s) => s.actionable);
  const exact = live.filter((s) => mapsForSection([map], s).length);
  if (exact.length || reportHasPlaces(sections)) return exact;
  return live.filter((s) => mapsForSectionLegacy([map], s).length);
}
