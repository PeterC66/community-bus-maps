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
//
// The core diff (diffRouteData) is a PURE function over already-parsed objects so
// it is trivially unit-testable; readMapData is the thin file-reading wrapper.
// Geometry (stop positions, road/river shapes) is deliberately NOT diffed here —
// it is not a service fact a customer signs off, and it changes on every refresh.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

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
 *   stopsChanged:{id:string, added:number, removed:number}[],
 *   operatorsAdded:string[], operatorsRemoved:string[],
 *   validity:{from:string,to:string}|null, versionLabel:{from:string,to:string}|null
 * }}
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
    if (added || removed) stopsChanged.push({ id: r, added, removed });
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

  return { unchanged, routesAdded, routesRemoved, descChanged, stopsChanged, operatorsAdded, operatorsRemoved, validity, versionLabel };
}

/**
 * Diff two map data FOLDERS (reads the JSON inputs, then diffs). Returns
 * { unchanged:true, ... } and a `missing` flag if either folder can't be read.
 */
export function dataChangeSummary(oldDataDir, newDataDir) {
  const okOld = oldDataDir && existsSync(path.join(oldDataDir, 'routes.json'));
  const okNew = newDataDir && existsSync(path.join(newDataDir, 'routes.json'));
  const summary = diffRouteData(readMapData(oldDataDir || ''), readMapData(newDataDir || ''));
  if (!okOld || !okNew) return { ...summary, missing: true };
  return summary;
}
