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

/** The three answers the landmark chooser can give (OA-212). Engine keys, never shown. */
const POI_TIERS = new Set(['must', 'may', 'miss']);

/** Longest rename accepted. The sheet has no room for more and the placer would drop it. */
const MAX_POI_NAME = 60;

/**
 * Characters a renamed POI may not carry. The double quote is the one that
 * matters — see the note at the poiTiers block — and the angle brackets and
 * control characters are refused with it because no place name needs them and a
 * name that reaches an SVG should not be the thing that tests an escaper.
 */
function badPoiName(t) {
  if (/["<>]/.test(t)) return true;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;   // control characters
  }
  return false;
}

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
  // (superseded by internal.poiTiers below; still accepted so saved maps work)
  const inInt = src.internal && typeof src.internal === 'object' ? src.internal : {};
  const inPois = inInt.pois && typeof inInt.pois === 'object' ? inInt.pois : {};
  const pois = {};
  for (const k of Object.keys(inPois)) {
    if (!poiSet.has(k)) { rejected.push(`internal.pois["${k}"] (unknown POI)`); continue; }
    const o = inPois[k];
    if (o && typeof o === 'object' && o.hide === true) pois[k] = { hide: true };
    // hide:false / missing -> POI stays visible -> no entry (keeps file minimal)
  }
  // --- internal.poiTiers[key] = { tier, as } — the landmark chooser (OA-212) ---
  //
  // WHY THIS IS NOT `internal.pois[key].hide`, two lines up, which looks like it
  // does the same job. `hide` is a RENDER-time override: the POI is still
  // selected, still reserves its 4.2 mm box, still anchors the placer, and still
  // counts in ci-reference, the byte gate and the quality ledger. A `miss` tier
  // is applied in poi_select.js at SELECTION time, before any of that happens,
  // so it is the only one of the two that gives the room back. A customer told
  // "untick this to free up space" and handed `hide` would be told something
  // false — which is why the chooser writes tiers, and why the editor's older
  // tick box is being retired ONTO them rather than extended.
  //
  // Saved `hide` entries are still accepted above, so nothing already saved
  // breaks. The chooser simply does not send them, and because this function
  // rebuilds the overrides object from scratch, the next save through it drops
  // them. That is exactly how a hidden POI becomes a properly missed one.
  const inTiers = inInt.poiTiers && typeof inInt.poiTiers === 'object' ? inInt.poiTiers : {};
  const tiers = {};
  for (const k of Object.keys(inTiers)) {
    // The key must be one this map actually has, and that list has to be the
    // CANDIDATE set rather than the drawn set. A POI classified `miss` in the
    // map's own routes.json is not on the sheet at all, so validating against
    // the sheet would reject the very key that is keeping it off: the
    // classification would be dropped on the next save and the POI would
    // silently come back. See editablePoiKeysFromDir().
    if (!poiSet.has(k)) { rejected.push(`internal.poiTiers["${k}"] (unknown POI)`); continue; }
    const o = inTiers[k];
    if (!o || typeof o !== 'object') { rejected.push(`internal.poiTiers["${k}"] (not an object)`); continue; }
    const tier = o.tier === undefined ? 'may' : o.tier;
    if (!POI_TIERS.has(tier)) { rejected.push(`internal.poiTiers["${k}"] (tier "${tier}" is not must/may/miss)`); continue; }

    // The rename. Optional, and BLANK MEANS ABSENT rather than invalid: an
    // earlier draft rejected the whole entry when `as` trimmed to nothing, which
    // threw away the tier too — the main answer discarded because the optional
    // box beside it held a space. test-landmark-tiers.mjs found it.
    let as = null;
    if (typeof o.as === 'string' && o.as.trim()) {
      const t = o.as.trim();
      if (t.length > MAX_POI_NAME) { rejected.push(`internal.poiTiers["${k}"].as (longer than ${MAX_POI_NAME} characters)`); continue; }
      // A rename REPLACES the POI's identity, so this string becomes the key the
      // generator writes into `data-key="…"` when it runs in editor mode. The
      // engine's esc() escapes &, < and > — it does NOT escape a double quote,
      // so a name carrying one would break out of that attribute. Refusing it
      // here is the fix, and it is the right layer: this is the boundary that
      // exists to validate untrusted input, it costs no real place name (not one
      // of High Wycombe's 171 contains any of these), and it needs no second
      // change to an engine file whose hash gates all twenty maps.
      if (badPoiName(t)) { rejected.push(`internal.poiTiers["${k}"].as (contains a character a place name cannot carry)`); continue; }
      as = t;
    } else if (o.as !== undefined && o.as !== null && typeof o.as !== 'string') {
      rejected.push(`internal.poiTiers["${k}"].as (not a string)`); continue;
    }

    // AN EXPLICIT `may` IS KEPT (OA-215), and until today it was dropped here
    // with the reasoning that it "changes nothing". It changes nothing about the
    // SHEET — poi_select.js applies it and the drawing is byte-identical, which
    // is why this is safe — but it is the whole of what the reader said, and
    // discarding it left the chooser unable to tell "I have looked at this and
    // it is right as it is" from "I have not reached this row yet". Across 145
    // rows worked through over several sittings, that is the difference between
    // a screen somebody can finish and one they cannot.
    //
    // The property the byte gate actually cares about is untouched: a map nobody
    // has answered still serialises to {}, because the page sends no entry for a
    // row nobody has answered. What is gone is only the belief that the SERVER
    // should decide an answer is not worth recording.
    tiers[k] = as ? { tier, as } : { tier };
  }

  if (Object.keys(pois).length || Object.keys(tiers).length) {
    out.internal = {};
    if (Object.keys(pois).length) out.internal.pois = pois;
    if (Object.keys(tiers).length) out.internal.poiTiers = tiers;
  }

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
    if (k !== 'pois' && k !== 'poiTiers') rejected.push(`internal.${k} (expert-only)`);
  }

  return { overrides: out, rejected };
}
