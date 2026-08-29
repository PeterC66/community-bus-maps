// The FACTS a map states, as data rather than as a picture (P8a).
//
// Every map's vendored payload already carries, next to its generators, the
// structured service facts the sheet is drawn from:
//
//   routes.json              palette, routeOrder, operators, serviceDesc /
//                            internalDesc, terminiLabels, fareNote, validFrom,
//                            external[] (area journeys) / destinations[] (place)
//   routes_intown_atco.json  route -> ordered ATCO stop ids inside the area
//   atco2name.json           ATCO id -> stop name
//   boarding_index.json      (boarding plans only) the stand register and the
//                            DESTINATION-keyed index the "Where to board" sheet
//                            is drawn from
//
// This module turns that into ONE kind-agnostic model. It exists because an
// image of a map has no text alternative: /m/<slug>/services renders this as
// real HTML so a screen-reader user, or anyone who cannot use a map at all, gets
// the same information (WCAG 2.2 AA — see docs/ACCESSIBILITY.md).
//
// It reads a DATA DIRECTORY, not a map id, so it can run against a published
// version's snapshot, a map's live data, or a staged monthly payload.
//
// Nothing here invents anything: every field is copied from the payload, and a
// missing field simply does not appear. If a fact is not in the data, it is not
// on the page.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** The stand register + destination index a boarding plan is drawn from. */
export const BOARDING_FILE = 'boarding_index.json';

/** The snapshot of these facts kept beside a rendered version's artefacts. */
export const FACTS_FILE = 'facts.json';

function readJson(dir, name, fallback = null) {
  const p = path.join(dir, name);
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * Place payloads write the route number into the description itself ("102
 * Beaconsfield – Heathrow") because the diagram has no separate badge for it.
 * The text version does have one, so drop the repeat.
 */
export function stripLeadingId(title, id) {
  const t = String(title || '');
  if (!id || !t.startsWith(String(id))) return t;
  const rest = t.slice(String(id).length);
  return /^[\s–—-]/.test(rest) ? rest.replace(/^[\s–—-]+/, '') : t;
}

/** Drop consecutive repeats (a circular route passes the same stop twice). */
function dedupeRun(names) {
  const out = [];
  for (const n of names) if (n && n !== out[out.length - 1]) out.push(n);
  return out;
}

/**
 * "June 2026" / "2026-06" / "June 2026 timetable" -> a Date at the start of that
 * month, or null. Payloads write `validFrom` by hand, so be forgiving and never
 * throw: an unparseable string just means we fall back to the publication date.
 */
export function parseValidFrom(s) {
  const v = str(s);
  if (!v) return null;
  const iso = v.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +(iso[3] || 1)));
    return isNaN(d) ? null : d;
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const m = v.match(/([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return new Date(Date.UTC(+m[2], i, 1));
  }
  const y = v.match(/^(\d{4})$/);
  if (y) return new Date(Date.UTC(+y[1], 0, 1));
  return null;
}

/**
 * The boarding index as facts (OA-010).
 *
 * A "Where to board" sheet is the one output whose text equivalent is arguably
 * BETTER than the picture: the index is inherently a table — destination, the
 * stop you stand at, how far that is, and which services — so this page gains a
 * real second section rather than a prose description of an image. That is the
 * point on which a PDF-only spider map cannot compete, and it is what permits a
 * purchase under the Public Sector Bodies Accessibility Regulations 2018. See
 * Development Docs/boarding-plan-product_2026-08-22.md §4 and §12.7.
 *
 * `boarding_index.json` has travelled with every such payload since 2026-08-23;
 * until now nothing read it.
 *
 * Everything INTERNAL is dropped here rather than at the public read model: the
 * ATCO codes, the lat/lon, and the trip counts and arrival bands that decided
 * the ranking. A reader needs the stop letter on the flag, not the arithmetic
 * behind it.
 *
 * @returns {object|null} null when the payload carries no boarding index, or
 *   carries one with nothing in it.
 */
function buildBoarding(dataDir, rj) {
  const bi = readJson(dataDir, BOARDING_FILE);
  if (!bi) return null;
  const cfg = obj(rj && rj.boardingPlan);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const stands = arr(bi.stands).map((s) => ({
    label: str(s && s.label),
    name: str(s && s.name),
    facing: str(s && s.facing) || null,
    walkMin: num(s && s.walkMin),
    distM: num(s && s.distM),
    routes: arr(s && s.routes).map(String),
    // The count rather than the list: the list is the destination table below,
    // and printing it twice makes the page longer without saying more.
    destinationCount: arr(s && s.destinations).length,
  })).filter((s) => s.label);

  const destinations = arr(bi.destinations).map((d) => ({
    name: str(d && d.destination),
    boardAt: str(d && d.boardAt),
    walkMin: num(d && d.walkMin),
    routes: arr(d && d.routes).map(String),
    limited: !!(d && d.limited),
    // A second stand that also gets you there. Kept because the sheet prints it
    // and because it is the honest answer to "can I catch it from here too?".
    alsoFrom: arr(d && d.alsoFrom).map((a) => ({
      label: str(a && a.label),
      walkMin: num(a && a.walkMin),
      routes: arr(a && a.routes).map(String),
    })).filter((a) => a.label),
  })).filter((d) => d.name && d.boardAt);

  if (!stands.length || !destinations.length) return null;
  return {
    place: str(bi.place) || null,
    homeLocality: str(bi.homeLocality) || null,
    heading: str(cfg.indexHeading) || null,
    // The sheet's own caveats — which journeys are NOT indexed, and why. The
    // text version must carry them or it claims a completeness the picture
    // explicitly disclaims.
    notes: arr(cfg.note).map(str).filter(Boolean),
    stands,
    destinations,
  };
}

/**
 * Build the facts model from a map payload directory.
 *
 * @param {string} dataDir  a folder holding routes.json and friends
 * @param {{kind?: 'area'|'place'}} [opts]
 * @returns {object|null}   null when the folder has no routes.json
 */
export function buildFacts(dataDir, { kind } = {}) {
  const rj = readJson(dataDir, 'routes.json');
  if (!rj) return null;

  // A place payload names a place and lists `destinations[]`; an area payload
  // names a town and lists `external[]`. Trust the caller's `kind` when given
  // (the DB knows), otherwise infer from the payload itself.
  const isPlace = kind ? kind === 'place' : !!(rj.place || rj.destinations);

  const palette = obj(rj.palette);
  const textOn = obj(rj.textOn);
  // Descriptions live under different keys in the two engines; area payloads
  // carry both (the panel text and the in-town text), and the panel one reads
  // better as a heading.
  const desc = { ...obj(rj.internalDesc), ...obj(rj.serviceDesc) };
  const termini = obj(rj.terminiLabels);

  const operators = arr(rj.operators)
    .map((o) => ({ name: str(o && o.name), routes: arr(o && o.routes).map(String) }))
    .filter((o) => o.name);
  const operatorOf = new Map();
  for (const o of operators) for (const r of o.routes) operatorOf.set(r, o.name);

  // Stops inside the area, by route, as names. The *_intown_ file is the set the
  // internal sheet actually draws; fall back to the full list when absent.
  const intown = obj(readJson(dataDir, 'routes_intown_atco.json', null) || readJson(dataDir, 'routes_atco.json', {}));
  const atco2name = obj(readJson(dataDir, 'atco2name.json', {}));

  // Area: each `external[]` entry is one drawn journey (a route can have more
  // than one — a variant "via Old Hurst", a limited school working).
  const journeysByRoute = new Map();
  for (const e of arr(rj.external)) {
    const r = String(e && e.route != null ? e.route : '');
    if (!r) continue;
    if (!journeysByRoute.has(r)) journeysByRoute.set(r, []);
    journeysByRoute.get(r).push({
      label: str(e.label),
      days: str(e.days),
      limited: !!e.limited,
      places: arr(e.stops).map(str).filter(Boolean),
    });
  }

  // Place: each `destinations[]` entry is somewhere you can get to, and lists
  // the routes that take you there. Invert it to hang off each route as well as
  // keeping the place-level list (the external sheet's own shape).
  const destinations = arr(rj.destinations).map((d) => ({
    name: str(d && d.name),
    sub: str(d && d.sub),
    limited: !!(d && d.limited),
    routes: arr(d && d.routes).map(String),
  })).filter((d) => d.name);
  const goesToByRoute = new Map();
  for (const d of destinations) {
    for (const r of d.routes) {
      if (!goesToByRoute.has(r)) goesToByRoute.set(r, []);
      goesToByRoute.get(r).push({ name: d.name, sub: d.sub, limited: d.limited });
    }
  }

  // Route order: the payload's own order first (it is the order on the sheet),
  // then anything else that has a colour, so nothing is silently dropped.
  const order = arr(rj.routeOrder).map(String);
  const ids = [...new Set([...order, ...Object.keys(palette)])];

  const routes = ids.map((id) => {
    const d = arr(desc[id]);
    return {
      id,
      colour: str(palette[id]) || null,
      textOn: str(textOn[id]) || null,
      title: str(d[0]) || null,
      days: str(d[1]) || null,
      operator: operatorOf.get(id) || null,
      terminus: str(termini[id]) || null,
      stopsInArea: dedupeRun(arr(intown[id]).map((a) => str(atco2name[a]) || '')),
      journeys: journeysByRoute.get(id) || [],
      goesTo: goesToByRoute.get(id) || [],
    };
  });

  return {
    // 2 adds `boarding` (OA-010). A snapshot at schema 1 predates the boarding
    // index and carries none, which is what factsForPublicMap() looks for
    // before it backfills one — see src/public/services.js.
    schema: 2,
    generatedAt: new Date().toISOString(),
    kind: isPlace ? 'place' : 'area',
    subject: str(rj.place) || str(rj.town) || null,
    town: str(rj.town) || null,
    anchorLabel: str(rj.anchorLabel) || null,
    validFrom: str(rj.validFrom) || null,
    dataVersion: str(rj.version) || null,
    fareNote: str(rj.fareNote) || null,
    note: str(rj.note) || null,
    operators,
    routes,
    destinations,
    boarding: buildBoarding(dataDir, rj),
  };
}

/** Read the facts snapshot written beside a rendered version, or null. */
export function readFactsSnapshot(dir) {
  const f = readJson(dir, FACTS_FILE, null);
  return f && f.routes ? f : null;
}
