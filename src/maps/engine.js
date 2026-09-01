// Map engine wrapper for the editor spine.
//
// Reuses src/render/renderMap.js (the P0 byte-identical wrapper) to:
//   • enumerate the routes + POIs a customer may edit (build the control panel),
//   • preview a candidate safe-subset overrides (SVGs only, nothing persisted),
//   • render + version a saved map (SVG + print JPG per output, copied into
//     renders/v<ver>/).
//
// The two generators travel with the map in its data/ folder; icons.js comes
// from the vendored engine/ dir via SKILL_ASSETS (there is no sibling icons.js
// in the object store, so the generator's own fallback resolves it there).

import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { ENGINE_DIR, generateSvg, rasterise } from '../render/renderMap.js';
import { mapDataDir, overridesPath, versionDir, proposedDataDir, archiveRoot, OUTPUTS, OUTPUT_FILES, BASE_OVERRIDES, DIAGRAM_LAYOUT, ENGINE_SOURCE, versionNumber, outputHint, readSheetDeclaration } from './store.js';
import { APP_VERSION, GIT_SHA } from '../version.js';
import { buildFacts, FACTS_FILE } from './facts.js';

const GEN_INTERNAL = 'gen_internal.js';
/** Portal-owned expert-style generators (P7): the schematic + diagram pre-stages. */
export const EXPERT_DIR = path.join(ENGINE_DIR, 'expert');

/**
 * Resolve which generator an output uses for a given map data folder: the first
 * of the output's `gens` candidates that is actually present. This is how one
 * output ("internal"/"external") serves both an AREA map (gen_internal.js /
 * gen_external.js) and a PLACE map (gen_internal_place.js / gen_external_places.js).
 * Returns null if none is present (output not renderable for this map).
 */
export function resolveGen(meta, dataDir) {
  // A candidate is either a filename or `{ file, requiresConfig, requiresFiles }`.
  // The object form exists because a requirement can belong to ONE generator
  // rather than to the output — see the `external` entry in store.js.
  const gens = (meta.gens || (meta.gen ? [meta.gen] : [])).map((g) => (typeof g === 'string' ? { file: g } : g));

  // WHAT THE PAYLOAD DECLARES WINS (OA-009). A skill payload carries exactly the
  // sheets it built, and a sheet it deliberately did NOT build is not a gap in
  // the payload — it is a decision. St Ives Bus Station has no external radial
  // because the solver cannot fan its eight spokes without putting Cambridge in
  // the wrong direction; the portal drew one anyway, from a generator that
  // resolved. A declaration is recorded at import and at every staged refresh;
  // absent (a map imported before this) it says nothing and nothing changes.
  const declared = readSheetDeclaration(dataDir);
  if (declared && !declared.includes(meta.base)) return null;

  // Some outputs need data files the payload may simply not carry (the boarding
  // plan's stand register and destination index). Its generator exits non-zero
  // on a missing input, and a throwing generator fails the map's whole render —
  // so an absent file has to mean "this output is unavailable", exactly as an
  // absent config key does. Checked for every output, not only the expert ones.
  if (!meetsRequirements(meta, dataDir)) return null;

  // Portal-owned generators (the P7 expert styles, and the boarding plan) live in
  // the portal's engine rather than in the map's data — and are only offered when
  // the map's routes.json opts into them.
  if (meta.engine === 'expert') {
    for (const g of gens) {
      const p = path.join(EXPERT_DIR, g.file);
      if (existsSync(p) && meetsRequirements(g, dataDir)) return p; // absolute → generateSvg uses it as-is
    }
    return null;
  }
  for (const g of gens) {
    if (existsSync(path.join(dataDir, g.file)) && meetsRequirements(g, dataDir)) return g.file;
  }
  return null;
}

/**
 * Does this payload carry the config keys and data files something requires?
 * Applied to an OUTPUT and, independently, to each generator CANDIDATE — the
 * two ask the same question about different scopes.
 */
function meetsRequirements(spec, dataDir) {
  if (spec.requiresConfig && !hasRoutesKey(dataDir, spec.requiresConfig)) return false;
  for (const f of spec.requiresFiles || []) {
    if (!existsSync(path.join(dataDir, f))) return false;
  }
  return true;
}

/**
 * Does this map's routes.json carry a (truthy) opt-in key, e.g. internalDiagram?
 *
 * An EMPTY ARRAY counts as absent. `[]` is truthy in JavaScript and meaningless
 * as a declaration: a payload whose `destinations` is empty has nothing for
 * gen_external_places.js to draw spokes from, which is the blank sheet this
 * guard exists to refuse.
 */
export function hasRoutesKey(dataDir, key) {
  const rj = readJson(path.join(dataDir, 'routes.json'), null);
  const v = rj ? rj[key] : null;
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function isPlainObject(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

/**
 * Deep-merge two overrides objects; `over` (the customer safe-subset layer) wins
 * on conflict. Used to lay a customer's recolours/POI-hides ON TOP of a map's
 * expert framing (base-overrides). Area maps have empty base ⇒ this is a no-op.
 */
export function mergeOverrides(base, over) {
  const b = isPlainObject(base) ? base : {};
  const o = isPlainObject(over) ? over : {};
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(o)])) {
    if (isPlainObject(b[k]) && isPlainObject(o[k])) out[k] = mergeOverrides(b[k], o[k]);
    else out[k] = k in o ? o[k] : b[k];
  }
  return out;
}

/** The expert framing baked into a map's payload (data/base-overrides.json), or {}. */
export function readBaseOverrides(dataDir) {
  return readJson(path.join(dataDir, BASE_OVERRIDES), {}) || {};
}

/**
 * Default output ENABLEMENT — i.e. visibility to the customer: the two
 * geographic outputs on; the **expert styles off** (P7). A schematic or diagram
 * showing up in a customer's tabs/downloads is an editorial choice (and the
 * diagram usually wants pin-tuning first), so a map opts in deliberately. This
 * is independent of whether an output is actually RENDERED — see
 * effectiveOutputs()'s `buildAlways` handling below.
 */
export function defaultOutputs() {
  const o = {};
  for (const [key, meta] of Object.entries(OUTPUTS)) o[key] = !!meta.portal && !meta.expert;
  return o;
}

/**
 * The outputs to actually RENDER for a map: portal-supported, the generator is
 * present, and — for most outputs — enabled. An empty/absent config means
 * "portal defaults on" — so a map imported before output toggles existed still
 * renders both geographic outputs.
 *
 * `buildAlways` outputs (the schematic) are the one exception: they render
 * whenever the map's data supports them, REGARDLESS of the enabled flag. This
 * keeps the files ready the moment a customer ticks the visibility box, instead
 * of them landing on the next save — enablement there is purely what
 * outputsForClient()/visibleDownloadsForVersion() (server.js) and the public
 * page (src/public/index.js) show, not what gets built.
 * @returns {{ key:string, gen:string, base:string, label:string }[]}
 */
export function effectiveOutputs(config, dataDir) {
  const cfg = config && typeof config === 'object' ? config : {};
  const out = [];
  for (const [key, meta] of Object.entries(OUTPUTS)) {
    if (!meta.portal) continue;
    if (!meta.buildAlways) {
      // Geographic outputs: undefined => on (a map imported before output toggles
      // existed still renders both). Expert styles: opt-in only, so a map imported
      // before P7 doesn't silently start producing two more sheets.
      if (meta.expert ? cfg[key] !== true : cfg[key] === false) continue;
    }
    const gen = resolveGen(meta, dataDir);
    if (!gen) continue; // no candidate generator present/configured for this map
    out.push({ key, base: meta.base, label: meta.label, gen, expert: !!meta.expert });
  }
  return out;
}

/**
 * Full 4-output descriptor for the UI (toggles): what's available + enabled.
 * `kind` picks the wording — a place map's sheets are not "within the area"
 * (findings D1); absent it, the area labels are used exactly as before.
 */
export function outputsForClient(config, id, kind) {
  const dataDir = mapDataDir(id);
  const cfg = config && typeof config === 'object' ? config : {};
  return Object.entries(OUTPUTS).map(([key, meta]) => ({
    key, base: meta.base, label: (kind === 'place' && meta.placeLabel) || meta.label, portal: !!meta.portal,
    // What this sheet shows — the editor puts it on the tab's tooltip and under
    // the tab row, because the customer is being asked to review every one.
    hint: outputHint(key, kind),
    expert: !!meta.expert,
    // Locked to the customer: shown, never switched by them (see chooseOutputs).
    requestOnly: !!meta.requestOnly,
    available: !!meta.portal && !!resolveGen(meta, dataDir),
    enabled: meta.portal ? (meta.expert ? cfg[key] === true : cfg[key] !== false) : false,
  }));
}

/** How `config` reads for one output, the same way effectiveOutputs() reads it. */
function isOn(meta, cfg, key) {
  return meta.expert ? cfg[key] === true : cfg[key] !== false;
}

/**
 * Decide a map's stored output set from what a client asked for (PATCH
 * /api/maps/:id/outputs). Pure, so the rules are testable without a server.
 *
 * Three rules, in order:
 *   • **request-only** outputs (the hand-finished tube-map diagram) are never
 *     moved by a non-admin. Whatever is posted, the stored value stays as it is
 *     and the key is reported in `refused` — the route turns that into a 403
 *     rather than a silent no-op, so a customer is told to ask rather than left
 *     thinking they switched something on. We are the ones who grant it, via the
 *     pin editor's save or an admin PATCH.
 *   • an **expert style** can only be switched on for a map whose data actually
 *     carries the config it needs (`available`).
 *   • a key the client omits falls back to the shipped default (geographic on,
 *     expert off) — except a locked one, which holds its current value.
 *
 * @param {any} incoming        `outputs` from the client (untrusted)
 * @param {object} opts
 * @param {object} opts.current  the map's stored output config
 * @param {string[]} opts.available  keys whose generator resolves for this map
 * @param {boolean} opts.isAdmin     admins are the expert side; the lock is not for them
 * @returns {{ outputs: object, refused: string[] }}
 */
export function chooseOutputs(incoming, { current = {}, available = [], isAdmin = false } = {}) {
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const cur = current && typeof current === 'object' ? current : {};
  const availSet = new Set(available);
  const outputs = {};
  const refused = [];
  for (const [key, meta] of Object.entries(OUTPUTS)) {
    if (!meta.portal) continue;
    if (meta.requestOnly && !isAdmin) {
      const now = isOn(meta, cur, key);
      outputs[key] = now;
      if (typeof inc[key] === 'boolean' && inc[key] !== now) refused.push(key);
      continue;
    }
    const wanted = typeof inc[key] === 'boolean' ? inc[key] : !meta.expert;
    outputs[key] = wanted && (availSet.has(key) || !meta.expert);
  }
  return { outputs, refused };
}

/**
 * Which outputs a change switches ON whose FILE is not in the map's current
 * version — i.e. which grants actually need a render to take effect (OA-007).
 *
 * Granting an output used to render nothing. Walked for real on the St Ives Bus
 * Station import, 2026-08-24: `PATCH /api/maps/14/outputs` set
 * `boarding_plan: true`, returned 200, and produced no file at all. The sheet
 * appeared only after a second delivery of the same S5 was staged as a proposed
 * update and ACCEPTED, because accept is what renders — so the working sequence
 * was grant → re-deliver → accept → publish, two steps of which existed purely
 * to make a flag take effect.
 *
 * Deliberately asks about the FILE rather than about the output's flags. A
 * `buildAlways` sheet is already on disk, so enabling it is a pure visibility
 * change that must stay instant and free; a `requestOnly` one usually is not.
 * But "expert", "request-only" and "build-always" are all proxies for the real
 * question, and a map that happens to carry the file for some other reason
 * should not be re-rendered either.
 *
 * Pure, so the rule is testable without a server — same reason chooseOutputs()
 * is separated from its route.
 *
 * @param {object} before   the map's stored output config before the change
 * @param {object} after    the config chooseOutputs() settled on
 * @param {string} dataDir  the map's payload
 * @param {string|null} verDir  the current version's folder, or null if none
 * @returns {string[]} output keys, in OUTPUTS order
 */
export function outputsNeedingRender(before, after, dataDir, verDir) {
  if (!verDir) return []; // nothing rendered yet — the first save makes them all
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  const renderable = new Set(effectiveOutputs(a, dataDir).map((o) => o.key));
  return Object.keys(OUTPUTS).filter((k) => (
    a[k] && !b[k]
    && renderable.has(k)
    && !existsSync(path.join(verDir, `${OUTPUTS[k].base}.svg`))
  ));
}

function readJson(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

/** routes.json palette + textOn + display metadata, read from an explicit data dir. */
export function readRoutesMetaFromDir(dataDir) {
  const rj = readJson(path.join(dataDir, 'routes.json'), {}) || {};
  return {
    palette: rj.palette || {},
    textOn: rj.textOn || {},
    routeOrder: rj.panelOrder || rj.routeOrder || Object.keys(rj.palette || {}),
    internalDesc: rj.internalDesc || rj.serviceDesc || {},
    town: rj.town || rj.place || '',
    operatorNames: Array.isArray(rj.operators) ? rj.operators.map((o) => (o && o.name ? String(o.name) : '')).filter(Boolean) : [],
  };
}

/** routes.json palette + textOn + display metadata for a map (its live data). */
export function readRoutesMeta(id) {
  return readRoutesMetaFromDir(mapDataDir(id));
}

// ---------------------------------------------------------------------------
// CANDIDATE POIs — what COULD be drawn, which is not what IS drawn (OA-212).
//
// `enumeratePoisFromDir()` below answers "what is on the sheet", by rendering it
// and reading the data-key tags back out. That is the right answer for a control
// that adjusts a POI already on the page, and it is the WRONG answer for a
// control that decides whether a POI is on the page at all:
//
//   a POI classified `miss` is dropped by poi_select.js at SELECTION time, so
//   it never reaches the generator and never gets a data-key. Offer the chooser
//   that list and a missed POI cannot be shown as missed or turned back on;
//   worse, sanitizeOverrides() validates keys against the same list, so the next
//   save would reject the key that was keeping it off and the POI would quietly
//   return.
//
//   MEASURED, and narrower than it first looks. That render is built from BASE
//   overrides, so it never sees the CUSTOMER's layer — a miss a customer sets in
//   their own overrides is still drawn by it and still enumerated. The case that
//   bites is a miss carried in the MAP PACK'S OWN routes.json, which is the
//   state every map reaches the moment a town's answer is exported back into its
//   source data. That is half of what this feature is for, so it is not an edge
//   case; it is the destination.
//
// So this asks the selector directly instead. Same module the generator uses,
// same tidy rules, same de-duplication, same file order (osm.json then osm2.json
// — that order decides which of two duplicates survives, so it is load-bearing
// and not an implementation detail). It runs no generator, writes nothing, and
// touches no run folder.
const poiSelectRequire = createRequire(import.meta.url);

/**
 * Every POI this map could draw, with the tier it currently carries.
 *
 * @param {string} dataDir  a map data folder (osm.json + routes.json)
 * @param {object} tiersOverlay  overrides.internal.poiTiers, merged over
 *        routes.json's poi.tiers exactly as gen_internal.js merges it, so the
 *        tier reported here is the tier the sheet would actually be drawn with.
 * @returns {{ key:string, cat:string, name:string, ll:number[], tier:string,
 *             as:string|null, printsName:boolean }[]}
 */
export function enumerateCandidatesFromDir(dataDir, tiersOverlay = null) {
  const routes = readJson(path.join(dataDir, 'routes.json'), {}) || {};
  let selectPois;
  try {
    ({ selectPois } = poiSelectRequire(path.join(ENGINE_DIR, 'poi_select.js')));
  } catch { return []; }

  // osm2.json is optional — some payloads carry only the first sweep.
  const sets = [];
  for (const f of ['osm.json', 'osm2.json']) {
    const j = readJson(path.join(dataDir, f), null);
    if (j && Array.isArray(j.elements)) sets.push(j.elements);
  }
  if (!sets.length) return [];

  const base = routes.poi || {};
  const poiCfg = (tiersOverlay && Object.keys(tiersOverlay).length)
    ? { ...base, tiers: { ...(base.tiers || {}), ...tiersOverlay } }
    : base;

  const report = {};
  try { selectPois(sets, poiCfg, report); } catch { return []; }
  return report.candidates || [];
}

/**
 * The POI keys a customer's saved overrides may legitimately name: the UNION of
 * what is drawn and what could be drawn.
 *
 * This is what every sanitizeOverrides() call site must validate against, and
 * the union rather than either half on purpose:
 *
 *  • A key only in CANDIDATES is one already classified `miss` in the map
 *    pack's own routes.json — off the sheet, and so absent from the drawn
 *    enumeration entirely. Validate against that set alone and the next save
 *    rejects the key that is keeping it off, drops the classification, and the
 *    POI comes back. The re-apply during a monthly proposed update is the worst
 *    place for it: the customer's answer would be silently undone by a refresh
 *    they only clicked Accept on.
 *  • A key only in DRAWN is one the map's own generator produced but the
 *    vendored selector did not. That should be impossible — drawn is candidates
 *    minus the missed ones — but a map pack that has not yet been brought
 *    forward by track-engine.mjs runs the generator it was IMPORTED with, so
 *    the two really can disagree. Losing a customer's existing edit to that is
 *    not a trade worth making, and the union costs nothing.
 */
export function editablePoiKeysFromDir(dataDir, tiersOverlay = null) {
  const keys = new Set();
  for (const p of enumerateCandidatesFromDir(dataDir, tiersOverlay)) keys.add(p.key);
  for (const p of enumeratePoisFromDir(dataDir)) keys.add(p.key);
  return [...keys];
}

// The drawn-POI universe is static for an imported map (it only changes if the
// underlying data is re-imported), and enumerating runs a generator — so memoise
// it for the process lifetime. Import runs in a separate process, so a freshly
// imported map is always enumerated fresh by the server on first request.
const poiCache = new Map();

/**
 * Enumerate the POIs actually drawn on the internal map from an explicit data
 * dir, in document order. Renders once with EDITOR_KEYS=1 (baseline overrides)
 * and reads the data-key tags — so the toggle list matches exactly what the
 * generator would draw. Uncached (used for proposed data + to rebuild the cache).
 * @returns {{ key:string, cat:string, name:string }[]}
 */
export function enumeratePoisFromDir(dataDir) {
  if (!existsSync(path.join(dataDir, GEN_INTERNAL))) return [];
  // Framing-only overrides (base, no customer hides) so EVERY POI is present and the
  // framing matches the real render; keys captured via EDITOR_KEYS. Area maps have no
  // base ⇒ this writes {} exactly as before.
  const empty = path.join(os.tmpdir(), `cbm-enum-${process.pid}-${Date.now()}.json`);
  writeFileSync(empty, JSON.stringify(readBaseOverrides(dataDir)));
  let svg = '';
  try {
    const { svgPath } = generateSvg({
      dataDir, generator: GEN_INTERNAL, iconsDir: ENGINE_DIR,
      overridesFile: empty, editorKeys: true,
    });
    svg = readFileSync(svgPath, 'utf8');
  } finally {
    try { unlinkSync(empty); } catch {}
  }
  const seen = new Set();
  const out = [];
  const re = /data-kind="poi"\s+data-key="([^"]*)"/g;
  let m;
  while ((m = re.exec(svg))) {
    const key = decodeEntities(m[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    const i = key.indexOf(':');
    out.push({ key, cat: i >= 0 ? key.slice(0, i) : '', name: i >= 0 ? key.slice(i + 1) : key });
  }
  return out;
}

/** Enumerate a map's drawn POIs (memoised for the process; see poiCache note). */
export function enumeratePois(id) {
  if (poiCache.has(id)) return poiCache.get(id);
  const out = enumeratePoisFromDir(mapDataDir(id));
  poiCache.set(id, out);
  return out;
}

/** Drop the memoised POI list for a map — call after its data is swapped (P5 accept). */
export function invalidatePoiCache(id) {
  poiCache.delete(id);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** The currently-saved overrides for a map ({} if none). */
export function readOverrides(id) {
  return readJson(overridesPath(id), {}) || {};
}

/**
 * Render the enabled outputs of a data folder for a candidate overrides object
 * WITHOUT persisting anything. Returns SVG strings keyed by artefact base name.
 * Works for any map data dir — the live one (preview) or a staged proposed one
 * (the "after" side of a P5 old-vs-new comparison).
 */
export function previewFrom(dataDir, overrides, outputsConfig) {
  const tmp = path.join(os.tmpdir(), `cbm-preview-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(mergeOverrides(readBaseOverrides(dataDir), overrides || {})));
  const result = {};
  try {
    for (const o of effectiveOutputs(outputsConfig, dataDir)) {
      const { svgPath } = generateSvg({
        dataDir, generator: o.gen, iconsDir: ENGINE_DIR, overridesFile: tmp,
        // A preview is of no version at all — it is the customer's unsaved edits.
        // Without this it would fall back to routes.json, which on a map delivered
        // from the skill carries a `build 6.54 · 19 Aug 2026` development stamp:
        // the one audience that must never see the engine's build number is the
        // customer editing their own map.
        sheetVersion: 'Preview \u2014 unsaved',
      });
      result[o.base] = readFileSync(svgPath, 'utf8');
    }
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
  return result; // { internal?: svg, external?: svg, ... } by base name
}

/** Preview a map's LIVE data with candidate overrides (the editor's live preview). */
export function preview(id, overrides, outputsConfig) {
  return previewFrom(mapDataDir(id), overrides, outputsConfig);
}

/**
 * Render + persist a version: write the canonical overrides.json, run each
 * generator (no editor keys → shippable bytes), rasterise to print JPGs, and
 * copy the four artefacts into renders/<storageKey>/ with a meta.json.
 *
 * `srcDataDir` defaults to the map's live data. P5 accept renders from the
 * STAGED proposed data (before swapping it in), so a render failure leaves the
 * live map completely untouched.
 * @returns {{ storageKey:string, files: Record<string,number>, log: string[] }}
 */
export async function renderVersion(id, overrides, storageKey, outputsConfig, srcDataDir = mapDataDir(id)) {
  const dataDir = srcDataDir;
  const outDir = versionDir(id, storageKey);
  mkdirSync(outDir, { recursive: true });

  // Render from a TEMP overrides file: if a generator or rasterise fails, the
  // canonical overrides.json and the last-good version are left untouched. The
  // customer overrides are merged OVER the map's base framing (empty for area maps).
  const tmp = path.join(os.tmpdir(), `cbm-save-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(mergeOverrides(readBaseOverrides(dataDir), overrides || {})));

  const files = {};
  const log = [];
  try {
    for (const o of effectiveOutputs(outputsConfig, dataDir)) {
      const { svgPath, log: genLog } = generateSvg({
        dataDir, generator: o.gen, iconsDir: ENGINE_DIR, overridesFile: tmp,
        // The PLAIN number, and deliberately nothing about the version's state.
        //
        // A version is always a draft at the moment it is rendered, and publishing
        // it does NOT re-render — approving a publish request flips review_state and
        // moves the map's pointer, and the bytes the approver signed off are the
        // bytes that go public. So a "Draft" baked in here would become a lie on
        // every published sheet, and the only ways round that are to re-render on
        // publish (the reviewed artwork would no longer be the published artwork) or
        // to rewrite a reviewed file in place. Neither is worth it.
        //
        // "5.0" is true while it is a draft and still true once it is published, so
        // nothing here ever has to change. The DRAFT marking is added on the way out
        // instead, on the authenticated per-version download route, derived and
        // cached beside the original exactly as the public watermark is — see
        // src/render/draftStamp.js. The public route serves the reviewed bytes
        // untouched.
        sheetVersion: versionNumber(storageKey),
      });
      if (genLog) log.push(`${o.gen}: ${genLog}`);
      const svgOut = path.join(outDir, `${o.base}.svg`);
      const jpgOut = path.join(outDir, `${o.base}.jpg`);
      cpSync(svgPath, svgOut);
      await rasterise(svgPath, jpgOut);
      files[`${o.base}.svg`] = statSync(svgOut).size;
      files[`${o.base}.jpg`] = statSync(jpgOut).size;
    }
    // Static per-map extra, not a render output: carry the customer-facing
    // disagreements PDF forward from the map's data folder into this version,
    // same as the map images, so every version's downloads carry it. The .docx
    // source never leaves the internal Buses tree — see OUTPUT_FILES in store.js.
    const disagSrc = path.join(dataDir, 'disagreements.pdf');
    if (existsSync(disagSrc)) {
      const disagOut = path.join(outDir, 'disagreements.pdf');
      cpSync(disagSrc, disagOut);
      files['disagreements.pdf'] = statSync(disagOut).size;
    }
  } finally {
    try { unlinkSync(tmp); } catch {}
  }

  // Success — commit the canonical overrides.json and the version's meta.
  writeFileSync(overridesPath(id), JSON.stringify(overrides || {}, null, 2) + '\n');
  writeFileSync(
    path.join(outDir, 'meta.json'),
    // GO-LIVE.md §5: the product is byte-identical output, so "which app build
    // rendered this sheet" needs to be recoverable from the sheet's own version
    // directory, not just from whichever deploy happened to be live at the time.
    JSON.stringify({ storageKey, created: new Date().toISOString(), overrides: overrides || {}, files, appVersion: APP_VERSION, gitSha: GIT_SHA }, null, 2),
  );
  // P8a — snapshot the FACTS this version states, from the very payload it was
  // drawn from. The public services page (the sheet's text alternative) reads
  // this, so it can never describe newer data than the published picture: a
  // monthly refresh renders from the STAGED payload, and its facts travel with
  // it. Advisory only — a failure here must not lose a good render.
  try {
    const facts = buildFacts(dataDir);
    if (facts) writeFileSync(path.join(outDir, FACTS_FILE), JSON.stringify(facts, null, 2));
  } catch { /* versions rendered without a snapshot fall back to live data */ }
  return { storageKey, files, log };
}

/**
 * Copy the expert's hand-tuning — and other extras a fresh monthly payload
 * doesn't regenerate — from a map's LIVE data into a staged payload that lacks
 * its own copy (P7's `diagram-layout.json`; the disagreements PDF, if that
 * month's import didn't re-run the S1 audit). This must run BEFORE anything
 * renders from the staged folder — otherwise the refreshed version (and the
 * old-vs-new preview) would silently lose the pins/report even though the file
 * is carried forward afterwards.
 *
 * Returns the filenames carried. Safe to call repeatedly.
 */
export function carryExpertTuning(id, stagedDir) {
  const live = mapDataDir(id);
  const carried = [];
  for (const f of [DIAGRAM_LAYOUT, 'disagreements.pdf']) {
    const from = path.join(live, f);
    const to = path.join(stagedDir, f);
    if (existsSync(from) && !existsSync(to)) { cpSync(from, to); carried.push(f); }
  }
  return carried;
}

/* Which of the two vendored external generators a file IS, read off the file
 * itself. This is signal 2 of the pair `backfill-engine-source.mjs` uses, and it is
 * deliberately the same expression: the busway generator dereferences `D.busway[`,
 * the radial one never mentions `.busway` at all. */
const externalKind = (src) => (/D\.busway\[/.test(src) ? 'busway' : 'radial');

/**
 * OA-199 - should a pack's archived `engine-source.json` be carried onto the data
 * that has just replaced it?
 *
 * WHY IT HAS TO BE CARRIED AT ALL. The file records which vendored external
 * generator a pack's `gen_external.js` is a copy of (OA-143), because an AREA pack
 * stores both candidates under that one name and the name cannot say. Only
 * `import-map.mjs` and `backfill-engine-source.mjs` write it, and neither runs on
 * the accept path - so before this it died with the archived data directory every
 * time an update was accepted. Eight of eighteen live maps went back to `skipped`
 * on `track-engine.mjs` the day after they were recorded, and a skip is not a
 * failure, so the summary line still read `0 BEHIND`.
 *
 * WHY IT MUST NOT BE CARRIED BLINDLY, which is the half the row that raised this
 * did not have. A refresh is exactly the moment a town's layout can change. Carry a
 * `radial` declaration onto a pack that now holds the BUSWAY generator and the
 * tracker - which trusts a declaration precisely so that it never guesses - will
 * overwrite that generator with the radial file at the next re-vendor. That is the
 * silent corruption the whole design exists to refuse, and the fix would have been
 * what introduced it. So the declaration is checked against the generator it
 * describes, and one that has stopped being true is dropped rather than kept:
 * absent means "nobody has answered", which is a state the tracker already handles
 * correctly, and it is recoverable by re-running the backfill.
 *
 * An entry naming a file the new pack does not have is moot rather than wrong, and
 * is left alone - the declaration is dropped only on a genuine disagreement.
 */
export function engineSourceVerdict(declPath, liveDir) {
  let decl;
  try { decl = JSON.parse(readFileSync(declPath, 'utf8')); }
  catch { return { keep: false, why: 'the archived declaration will not parse' }; }
  const gens = decl && typeof decl.generators === 'object' && decl.generators;
  if (!gens || !Object.keys(gens).length) return { keep: false, why: 'the archived declaration names no generator' };
  for (const [packFile, rel] of Object.entries(gens)) {
    if (typeof rel !== 'string' || !rel) return { keep: false, why: packFile + ' is declared as something that is not a path' };
    const onDisk = path.join(liveDir, packFile);
    if (!existsSync(onDisk)) continue;                 // moot, not wrong
    const declared = /busway/i.test(rel) ? 'busway' : 'radial';
    const actual = externalKind(readFileSync(onDisk, 'utf8'));
    if (declared !== actual) {
      return { keep: false, why: packFile + ' is declared ' + declared + ' (' + rel + ') and the refreshed pack holds the ' + actual + ' generator' };
    }
  }
  return { keep: true, why: 'the declaration still describes the refreshed pack' };
}

/**
 * Accept a staged monthly refresh (P5): move the outgoing live data into the
 * archive (never deleted) and swap the staged proposed data into the live data
 * location. The map's data_dir path is unchanged (only its contents), and the
 * customer's saved overrides.json (which sits ABOVE data/) is untouched — the
 * caller re-sanitises + re-renders it against the fresh data. Returns the
 * archive path. Throws if the proposed data is not actually staged.
 */
export function swapInProposedData(id, pid) {
  const live = mapDataDir(id);
  const staged = proposedDataDir(id, pid);
  if (!existsSync(path.join(staged, 'routes.json'))) {
    throw new Error(`proposed update #${pid} is not staged (no routes.json under ${staged})`);
  }
  mkdirSync(archiveRoot(id), { recursive: true });
  const archived = path.join(archiveRoot(id), `proposed-${pid}-prev`);
  if (existsSync(live)) renameSync(live, archived);   // outgoing data → archive
  renameSync(staged, live);                            // staged data → live
  // Expert hand-tuning must survive a data refresh (P7): the diagram's pins are
  // the expert's own work, not part of the monthly payload, and the diagram engine
  // re-resolves a pin by its stored lat/lon if a node key moved. Carry the layout
  // forward when the fresh payload doesn't bring one of its own.
  const carried = [];
  for (const f of [DIAGRAM_LAYOUT]) {
    const from = path.join(archived, f);
    if (existsSync(from) && !existsSync(path.join(live, f))) {
      cpSync(from, path.join(live, f));
      carried.push(f);
    }
  }
  // The engine-source declaration is the second entry this list has ever had, and it
  // does NOT get the same unconditional carry - see engineSourceVerdict() for why a
  // stale one is worse than an absent one. `dropped` names what was deliberately not
  // carried, so a refusal is something the caller can log rather than a silence.
  const dropped = [];
  const declFrom = path.join(archived, ENGINE_SOURCE);
  if (existsSync(declFrom) && !existsSync(path.join(live, ENGINE_SOURCE))) {
    const verdict = engineSourceVerdict(declFrom, live);
    if (verdict.keep) { cpSync(declFrom, path.join(live, ENGINE_SOURCE)); carried.push(ENGINE_SOURCE); }
    else dropped.push({ file: ENGINE_SOURCE, why: verdict.why });
  }
  invalidatePoiCache(id);                              // drawn-POI universe may have changed
  return { archived, carried, dropped };
}

export { OUTPUT_FILES };
