// The public read model for a map's FACTS and its provenance (P8a).
//
// Two jobs:
//
//   1. factsForPublicMap() — the facts a PUBLISHED map states. It prefers the
//      snapshot written beside the version's artefacts (src/maps/facts.js), so
//      the text alternative describes exactly the data the signed-off picture
//      was drawn from. Versions rendered before P8a have no snapshot; they fall
//      back to the map's live payload and pick one up on their next render.
//
//   2. provenanceFor() — "correct as at", the published date, and whether the
//      map has gone STALE. A printed leaflet on a noticeboard is obviously a
//      snapshot; a web page implies currency, so an online map has to say how
//      old it is and admit when that is too old.
//
// Nothing here reaches into a draft, another tenant, or anything the SQL gate in
// src/db/index.js has not already declared publicly visible.

import { mapDataDir, versionDir } from '../maps/store.js';
import { buildFacts, readFactsSnapshot, parseValidFrom, stripLeadingId } from '../maps/facts.js';
import { staleAfterMonths } from '../config.js';
import { parseDbDate } from '../db/dates.js';

// How long after its data's valid-from date a map is called out as possibly out
// of date. The refresh cycle is monthly, so anything past two full seasons has
// been left alone through several offered updates. Configurable because it is a
// policy number, not an engineering one.
export const STALE_AFTER_MONTHS = staleAfterMonths();   // snapshotted at load, as it always was

/**
 * The facts of one publicly-visible map row, or null when its payload has none.
 * @param {object} row  a row from listPublicMaps()/getPublicMapBySlug()
 */
export function factsForPublicMap(row) {
  const snapshot = readFactsSnapshot(versionDir(row.id, row.pub_key));
  if (!snapshot) return buildFacts(mapDataDir(row.id), { kind: row.kind });
  // A snapshot written before OA-010 (schema 1) has no boarding index in it,
  // and a "Where to board" sheet already published would otherwise show no
  // index at all until somebody re-rendered it — which is a portal operation
  // needing a session, on maps whose whole accessibility argument IS the table.
  // So fill that ONE field from the live payload, and only for a snapshot old
  // enough not to have been asked the question. Every later render writes its
  // own, at which point this never runs again for that version. The usual rule
  // still holds everywhere else: the snapshot describes the picture that was
  // signed off, and nothing here reaches past it.
  if (snapshot.boarding === undefined) {
    const live = buildFacts(mapDataDir(row.id), { kind: row.kind });
    return { ...snapshot, boarding: (live && live.boarding) || null };
  }
  return snapshot;
}

const MONTH_MS = 2629746000; // average month, only ever used for a coarse age

/**
 * When the map's information is correct as at, and whether that is now old.
 * Falls back to the publication date when the payload carries no `validFrom`.
 */
export function provenanceFor(row, facts, now = new Date()) {
  const published = parseDbDate(row.published_at);
  const fromLabel = (facts && facts.validFrom) || '';
  const fromDate = parseValidFrom(fromLabel) || (published && !isNaN(published) ? published : null);
  const ageMonths = fromDate ? Math.floor((now - fromDate) / MONTH_MS) : null;
  return {
    version: row.pub_key,
    publishedAt: row.published_at || null,
    // The words the payload itself uses ("June 2026") read better than a date we
    // reconstruct, so show those when we have them.
    dataAsAt: fromLabel || null,
    dataAsAtDate: fromDate && !isNaN(fromDate) ? fromDate.toISOString().slice(0, 10) : null,
    ageMonths,
    stale: ageMonths != null && ageMonths >= STALE_AFTER_MONTHS,
    staleAfterMonths: STALE_AFTER_MONTHS,
  };
}

/**
 * The services payload behind /m/<slug>/services — the map's text alternative.
 * Shaped for rendering: no ATCO codes, no geometry, no internal keys.
 */
export function publicServices(row, facts) {
  if (!facts) return null;
  return {
    kind: facts.kind,
    subject: facts.subject || row.subject || row.name,
    anchorLabel: facts.anchorLabel || null,
    fareNote: facts.fareNote || null,
    note: facts.note || null,
    operators: facts.operators || [],
    destinations: facts.destinations || [],
    // The "Where to board" index, or null on a map that has no such sheet
    // (OA-010). Already stripped of ATCO codes, geometry and the trip counts
    // that decided the ranking — see buildBoarding() in src/maps/facts.js.
    boarding: facts.boarding || null,
    routes: (facts.routes || []).map((r) => ({
      id: r.id,
      colour: r.colour,
      textOn: r.textOn,
      // Presentation, applied on read rather than baked into the snapshot, so
      // versions rendered before this existed get it too.
      title: stripLeadingId(r.title, r.id) || null,
      days: r.days,
      operator: r.operator,
      terminus: r.terminus,
      stopsInArea: r.stopsInArea || [],
      journeys: r.journeys || [],
      goesTo: r.goesTo || [],
    })),
  };
}

/** Public URL of a map's services (text-alternative) page. */
export const servicesPageUrl = (slug) => `/m/${slug}/services`;
