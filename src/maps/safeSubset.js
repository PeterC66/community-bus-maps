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

/**
 * Why hiding an operator is refused on a map that carries a boarding plan
 * (OA-011). Exported because the EDITOR says the same sentence beside the
 * disabled control — a customer should meet this before they try, not after,
 * and two copies of the sentence would drift.
 */
export const BOARDING_CONFLICT =
  'this map has a "Where to board" sheet, and the stop each destination is boarded at was worked out across every route serving it — '
  + 'hiding one operator would drop destinations you can still get to';

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
 * @param {boolean} allow.boardingPlanOn              this map renders a "Where to board" sheet
 * @returns {{ overrides: object, rejected: string[] }}
 */
export function sanitizeOverrides(input, {
  palette = {}, poiKeys = [], operatorNames = [], operatorFilterEnabled = false, boardingPlanOn = false,
} = {}) {
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
  //
  // A MAP CARRYING A BOARDING PLAN REFUSES THE KEY OUTRIGHT (OA-011), and this
  // is the one rejection here that is not about permission. `gen_boarding.js`
  // cannot honour it: the stand a destination is boarded at was decided by
  // `boarding_index.py` across EVERY route serving that stand, so filtering
  // routes inside the generator drops destinations that are still perfectly
  // reachable from another stand. Since 2026-08-23 the generator refuses under
  // STRICT_GUARDS rather than half-apply it — which is the right call, and it
  // meant the customer's save died with a generator error at render time.
  //
  // Rebuilding the index is a Python step the portal does not have, so the two
  // edits are mutually exclusive, and the honest place to say so is here: this
  // is the one gate BOTH preview and save go through, so the customer is told
  // while they are still looking at the map instead of when they press save.
  const inHO = Array.isArray(src.hiddenOperators) ? src.hiddenOperators : [];
  const ho = [];
  for (const name of inHO) {
    if (!operatorFilterEnabled) { rejected.push(`hiddenOperators.${name} (not enabled for this customer)`); continue; }
    if (boardingPlanOn) { rejected.push(`hiddenOperators.${name} (${BOARDING_CONFLICT})`); continue; }
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
