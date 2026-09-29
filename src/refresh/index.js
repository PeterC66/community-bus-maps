// Monthly-refresh domain logic (P5) — the deterministic data diff.
//
// When the central pipeline restages a map's data, the customer needs to see, in
// plain terms, WHAT the refresh changed before accepting it. This module diffs
// the *service facts* between the current data and the proposed data:
//
//   • routes added / withdrawn        (routes.json palette keys)
//   • a route's destination reworded  (routes.json internalDesc / serviceDesc)
//   • stops added / removed per route  (routes_atco.json — counts only)
//   • operators added / removed        (routes.json operators)
//   • timetable validity moved on      (routes.json validFrom / version)
//   • landmarks that have APPEARED or GONE in OpenStreetMap  (osm.json, OA-253)
//
// The core diffs (diffRouteData, diffLandmarks) are PURE functions over
// already-parsed inputs so they are trivially unit-testable; readMapData and
// dataChangeSummary are the thin file-reading wrappers. Geometry (stop positions,
// road/river shapes) is deliberately NOT diffed here — it is not a service fact a
// customer reviews, and it changes on every refresh.
//
// THE LANDMARK HALF IS NOT A SERVICE FACT AND IS HERE ANYWAY (OA-253, Peter's
// decision of 2026-09-06). A place OpenStreetMap gains between two builds enters
// the candidate list answered by neither tier layer, so it takes the default —
// *show if there is room* — and can print on the refreshed sheet without anybody
// deciding it should. Three things could have said so and only one did: the
// landmark chooser's "Not looked at yet" chip. changeSummary() compares two
// versions' OVERRIDES, so it can report a landmark a PERSON promoted and cannot
// report one that simply arrived; and the generator's `poi.tiers:` warnings reach
// /preview and /save, which is the editing path and not the accept-an-update path.
// This closes that, at the cheap end Peter chose: a count and the names, on the
// screen where the update is accepted, pointing at the chip that lists them.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { enumerateCandidatesFromDir } from '../maps/engine.js';

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

/**
 * Read the two service-fact inputs from a map data folder.
 * @returns {{ routes: object, atco: object }}
 */
export function readMapData(dataDir) {
  // Per-route stop lists, keyed by display route with flat-array values. Area maps
  // write routes_atco.json; place maps write routes_intown_atco.json (the drawn /
  // walkshed stops) in that same shape — try both so stop-count diffs work for
  // either kind. (A place's routes_full_atco.json is NOT used here: its values are
  // {directions,canonical,all} objects, not flat stop arrays.)
  const atco = readJson(path.join(dataDir, 'routes_atco.json'), null)
    || readJson(path.join(dataDir, 'routes_intown_atco.json'), null) || {};
  return {
    routes: readJson(path.join(dataDir, 'routes.json'), {}) || {},
    atco,
  };
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const descOf = (routes, r) => {
  const d = (routes.internalDesc && routes.internalDesc[r]) || (routes.serviceDesc && routes.serviceDesc[r]);
  return d != null ? d : null;
};
const operatorNames = (routes) => asArray(routes.operators).map((o) => (o && o.name ? String(o.name) : '')).filter(Boolean);
const sortRoutes = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * Deterministic diff of the service facts between two parsed data payloads.
 * @param {{routes:object, atco:object}} from  the map's CURRENT data
 * @param {{routes:object, atco:object}} to    the PROPOSED (refreshed) data
 * @returns {{
 *   unchanged:boolean,
 *   routesAdded:string[], routesRemoved:string[],
 *   descChanged:{id:string, from:any, to:any}[],
 *   stopsChanged:{id:string, added:number, removed:number, before:number}[],
 *   operatorsAdded:string[], operatorsRemoved:string[],
 *   validity:{from:string,to:string}|null, versionLabel:{from:string,to:string}|null,
 *   routeCount:number
 * }}
 *
 * `before` (a route's stop count in the CURRENT data) and `routeCount` (every
 * route on either side) exist for isMajorChange() below; summaries stored before
 * 2026-09-29 lack both.
 */
export function diffRouteData(from, to) {
  const fromR = (from && from.routes) || {}, toR = (to && to.routes) || {};
  const fromA = (from && from.atco) || {}, toA = (to && to.atco) || {};
  const fromPal = fromR.palette || {}, toPal = toR.palette || {};

  const fromRoutes = new Set(Object.keys(fromPal));
  const toRoutes = new Set(Object.keys(toPal));

  const routesAdded = [...toRoutes].filter((r) => !fromRoutes.has(r)).sort(sortRoutes);
  const routesRemoved = [...fromRoutes].filter((r) => !toRoutes.has(r)).sort(sortRoutes);

  // Routes present in BOTH: reworded destination? changed stop list?
  const common = [...toRoutes].filter((r) => fromRoutes.has(r)).sort(sortRoutes);
  const descChanged = [];
  const stopsChanged = [];
  for (const r of common) {
    const df = descOf(fromR, r), dt = descOf(toR, r);
    if (JSON.stringify(df) !== JSON.stringify(dt)) descChanged.push({ id: r, from: df, to: dt });

    const sf = new Set(asArray(fromA[r])), st = new Set(asArray(toA[r]));
    const added = [...st].filter((s) => !sf.has(s)).length;
    const removed = [...sf].filter((s) => !st.has(s)).length;
    if (added || removed) stopsChanged.push({ id: r, added, removed, before: sf.size });
  }

  const fromOps = new Set(operatorNames(fromR)), toOps = new Set(operatorNames(toR));
  const operatorsAdded = [...toOps].filter((o) => !fromOps.has(o)).sort();
  const operatorsRemoved = [...fromOps].filter((o) => !toOps.has(o)).sort();

  const vf = fromR.validFrom || '', vt = toR.validFrom || '';
  const validity = vf !== vt ? { from: vf, to: vt } : null;
  const lf = fromR.version != null ? String(fromR.version) : '', lt = toR.version != null ? String(toR.version) : '';
  const versionLabel = lf !== lt ? { from: lf, to: lt } : null;

  const unchanged =
    !routesAdded.length && !routesRemoved.length && !descChanged.length && !stopsChanged.length &&
    !operatorsAdded.length && !operatorsRemoved.length && !validity && !versionLabel;

  return { unchanged, routesAdded, routesRemoved, descChanged, stopsChanged, operatorsAdded, operatorsRemoved, validity, versionLabel,
    routeCount: new Set([...fromRoutes, ...toRoutes]).size };
}

/**
 * The routes an accepted update TRANSFORMS (buses-data OA-510): new, withdrawn,
 * or with at least a quarter of its stops added or removed, measured against the
 * stop count it had before. A stopsChanged row without `before` — every summary
 * stored before this rule, and a route whose old stop list was empty — counts as
 * not transformed, which errs toward the minor.
 * @returns {string[]} route ids, sorted
 */
export function transformedRoutes(summary) {
  const s = summary || {};
  const ids = new Set([...asArray(s.routesAdded), ...asArray(s.routesRemoved)].map(String));
  for (const c of asArray(s.stopsChanged)) {
    const before = Number(c && c.before);
    if (!(before > 0)) continue;
    if (4 * ((Number(c.added) || 0) + (Number(c.removed) || 0)) >= before) ids.add(String(c.id));
  }
  return [...ids].sort(sortRoutes);
}

/**
 * Does accepting this update take a new MAJOR version, or a minor? (buses-data
 * OA-510, the rule Peter agreed on 2026-09-29.)
 *
 * A MAJOR only when at least half the routes on the map, and at least two, are
 * transformed (see transformedRoutes). Everything else is a MINOR: one new or
 * withdrawn route, some stop changes, a new operator or timetable date, new
 * landmarks, an engine redraw. `forceMajor`, which `propose-update.mjs --major`
 * writes into the stored summary, takes a MAJOR for a redesign whatever changed.
 *
 * "The routes on the map" is every route on EITHER side, `routeCount`, so a map
 * that gains two routes to four is measured against six, not four. A summary
 * with no `routeCount` (stored before this rule) takes a minor, unless forced.
 *
 * PURE, over the summary diffRouteData() wrote, so both sides of each threshold
 * are tested without a data folder (scripts/test-version-rule.mjs).
 */
export function isMajorChange(summary) {
  if (!summary) return false;
  if (summary.forceMajor === true) return true;
  const total = Number(summary.routeCount);
  if (!(total > 0)) return false;
  const n = transformedRoutes(summary).length;
  return n >= 2 && 2 * n >= total;
}

/**
 * Which places OpenStreetMap has gained or lost between two builds (OA-253).
 *
 * PURE, over the two candidate lists `enumerateCandidatesFromDir()` returns, so
 * the interesting half can be tested without a data folder. Keyed on the POI key
 * — `<cat>:<name>` — because that is the identity a tier answer is written
 * against, so "appeared" here means precisely "arrived carrying no answer, and
 * will therefore be drawn if there is room".
 *
 * A RENAME LOOKS LIKE ONE OF EACH, and that is correct rather than a limitation:
 * the key IS the identity, so a renamed place really has lost its answer and
 * really does need answering again. The generator says the same thing from the
 * other side, by putting the orphaned key in `unknownTierKeys`.
 *
 * @param {{key:string,cat:string,name:string}[]} from  the live build's candidates
 * @param {{key:string,cat:string,name:string}[]} to    the staged build's candidates
 * @returns {{added:{key:string,cat:string,name:string}[], removed:{...}[]}}
 */
export function diffLandmarks(from, to) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const pick = (p) => ({ key: String(p.key), cat: String(p.cat || ''), name: String(p.name || '') });
  const byKey = (a, b) => a.key.localeCompare(b.key);
  const fromKeys = new Set(list(from).map((p) => String(p && p.key)));
  const toKeys = new Set(list(to).map((p) => String(p && p.key)));
  // De-duplicated on the way out: two candidates really can share one key since
  // OA-234 (two unnamed pharmacies), and one arrival should be reported once.
  const uniq = (arr) => {
    const seen = new Set(); const out = [];
    for (const p of arr) { if (seen.has(p.key)) continue; seen.add(p.key); out.push(p); }
    return out;
  };
  return {
    added: uniq(list(to).filter((p) => p && !fromKeys.has(String(p.key))).map(pick)).sort(byKey),
    removed: uniq(list(from).filter((p) => p && !toKeys.has(String(p.key))).map(pick)).sort(byKey),
  };
}

/**
 * Diff two map data FOLDERS (reads the JSON inputs, then diffs). Returns
 * { unchanged:true, ... } and a `missing` flag if either folder can't be read.
 *
 * THE LANDMARK DIFF FALLS SILENT WHEN IT IS NOT SURE, which is the opposite of
 * this estate's usual "every uncertain answer falsifies" rule and is deliberate.
 * `enumerateCandidatesFromDir()` returns `[]` for a folder with no `osm.json`, for
 * a payload whose selector will not load, and for a place pack that carries
 * neither — and an empty list on one side alone would report the WHOLE of the
 * other side as arrivals or departures. Telling a customer that 145 places have
 * appeared when nothing has is worse than telling them nothing, and telling them
 * nothing is exactly the behaviour that stood before this existed. So a side with
 * no candidates at all suppresses the comparison and says so in `landmarksKnown`.
 */
export function dataChangeSummary(oldDataDir, newDataDir) {
  const okOld = oldDataDir && existsSync(path.join(oldDataDir, 'routes.json'));
  const okNew = newDataDir && existsSync(path.join(newDataDir, 'routes.json'));
  const summary = diffRouteData(readMapData(oldDataDir || ''), readMapData(newDataDir || ''));

  const oldPois = okOld ? enumerateCandidatesFromDir(oldDataDir) : [];
  const newPois = okNew ? enumerateCandidatesFromDir(newDataDir) : [];
  const landmarksKnown = oldPois.length > 0 && newPois.length > 0;
  const lm = landmarksKnown ? diffLandmarks(oldPois, newPois) : { added: [], removed: [] };
  const withLandmarks = {
    ...summary,
    landmarksKnown,
    landmarksAdded: lm.added,
    landmarksRemoved: lm.removed,
    // `unchanged` is what every downstream reader trusts — isEmptyDataChange()
    // returns it verbatim when present — so a refresh whose ONLY change is a new
    // landmark must not go on reporting itself as identical.
    unchanged: summary.unchanged && !lm.added.length && !lm.removed.length,
  };

  if (!okOld || !okNew) return { ...withLandmarks, missing: true };
  return withLandmarks;
}
