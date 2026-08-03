// The safe-subset security boundary.
//
// P1 lets a customer do TWO deterministic, engine-supported edits:
//   • recolour a route          -> top-level  routeColors[<route>] = "#rrggbb"
//   • hide/show a POI icon       -> internal.pois[<cat:name>] = { hide: true }
// A THIRD is opt-in per customer (2026-08-03):
//   • hide an operator's routes -> top-level  hiddenOperators = ["<operator name>"...]
//     only accepted when the caller passes allow.operatorFilterEnabled (from
//     customer.hide_operators_enabled — off by default; most customers never see
//     this key accepted, even if they somehow send it).
//
// Everything else the override system can express — moving stops, straightening
// runs, rotation, viewport, panel position, linear-feature geometry, external
// branch/hub layout, POI moves/labels — is EXPERT-ONLY and must never reach the
// generator from a customer request. This module is the gate: it rebuilds a
// fresh overrides object from scratch, copying across only the whitelisted keys
// after validating every value. Whatever the client POSTs, the output can only
// ever contain the safe knobs actually enabled for this customer, so a hostile
// or buggy client can't smuggle a layout edit through (or a filter feature it
// hasn't been granted). No-op entries (a colour equal to the palette default, a
// POI left visible, an empty hiddenOperators list) are dropped, so an untouched
// map serialises to {} and stays byte-identical to the shipped baseline.

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v) {
  return typeof v === 'string' && HEX.test(v);
}

const norm = (hex) => hex.toLowerCase();

/**
 * @param {any} input                 raw overrides from the client (untrusted)
 * @param {object} allow
 * @param {Record<string,string>} allow.palette   route id -> default hex (routes.json)
 * @param {string[]} allow.poiKeys                 known "cat:name" POI keys
 * @param {string[]} allow.operatorNames            known routes.json operators[].name
 * @param {boolean} allow.operatorFilterEnabled     this customer may use hiddenOperators
 * @returns {{ overrides: object, rejected: string[] }}
 */
export function sanitizeOverrides(input, { palette = {}, poiKeys = [], operatorNames = [], operatorFilterEnabled = false } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const routeIds = new Set(Object.keys(palette));
  const poiSet = new Set(poiKeys);
  const opSet = new Set(operatorNames);
  const rejected = [];
  const out = {};

  // --- routeColors: known route -> valid hex, dropping palette-default no-ops ---
  const inRC = src.routeColors && typeof src.routeColors === 'object' ? src.routeColors : {};
  const rc = {};
  for (const r of Object.keys(inRC)) {
    if (!routeIds.has(r)) { rejected.push(`routeColors.${r} (unknown route)`); continue; }
    const v = inRC[r];
    if (!isHexColor(v)) { rejected.push(`routeColors.${r} (not a hex colour)`); continue; }
    const def = typeof palette[r] === 'string' ? norm(palette[r]) : null;
    if (def && norm(v) === def) continue; // same as default -> no override needed
    rc[r] = v;
  }
  if (Object.keys(rc).length) out.routeColors = rc;

  // --- internal.pois[key] = { hide:true } only, for known POIs ---
  const inInt = src.internal && typeof src.internal === 'object' ? src.internal : {};
  const inPois = inInt.pois && typeof inInt.pois === 'object' ? inInt.pois : {};
  const pois = {};
  for (const k of Object.keys(inPois)) {
    if (!poiSet.has(k)) { rejected.push(`internal.pois["${k}"] (unknown POI)`); continue; }
    const o = inPois[k];
    if (o && typeof o === 'object' && o.hide === true) pois[k] = { hide: true };
    // hide:false / missing -> POI stays visible -> no entry (keeps file minimal)
  }
  if (Object.keys(pois).length) out.internal = { pois };

  // --- hiddenOperators: known operator name only, and only if this customer
  // has the feature enabled at all. Not enabled => reject every entry (even a
  // valid operator name), same as if the customer had never sent the key.
  const inHO = Array.isArray(src.hiddenOperators) ? src.hiddenOperators : [];
  const ho = [];
  for (const name of inHO) {
    if (!operatorFilterEnabled) { rejected.push(`hiddenOperators.${name} (not enabled for this customer)`); continue; }
    if (typeof name !== 'string' || !opSet.has(name)) { rejected.push(`hiddenOperators.${name} (unknown operator)`); continue; }
    ho.push(name);
  }
  if (ho.length) out.hiddenOperators = ho;

  // --- report anything expert-only the client tried to send (for logging/UX) ---
  for (const k of Object.keys(src)) {
    if (k !== 'routeColors' && k !== 'internal' && k !== 'hiddenOperators') rejected.push(`${k} (expert-only)`);
  }
  for (const k of Object.keys(inInt)) {
    if (k !== 'pois') rejected.push(`internal.${k} (expert-only)`);
  }

  return { overrides: out, rejected };
}
