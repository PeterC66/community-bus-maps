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
import { ENGINE_DIR, generateSvg, rasterise } from '../render/renderMap.js';
import { mapDataDir, overridesPath, versionDir, proposedDataDir, archiveRoot, OUTPUTS, OUTPUT_FILES, BASE_OVERRIDES, DIAGRAM_LAYOUT } from './store.js';
import { APP_VERSION, GIT_SHA } from '../version.js';

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
  const gens = meta.gens || (meta.gen ? [meta.gen] : []);
  // Expert styles (P7) live in the portal's engine, not in the map's data — and
  // are only offered when the map's routes.json opts into them.
  if (meta.engine === 'expert') {
    if (meta.requiresConfig && !hasRoutesKey(dataDir, meta.requiresConfig)) return null;
    for (const g of gens) {
      const p = path.join(EXPERT_DIR, g);
      if (existsSync(p)) return p; // absolute → generateSvg uses it as-is
    }
    return null;
  }
  for (const g of gens) if (existsSync(path.join(dataDir, g))) return g;
  return null;
}

/** Does this map's routes.json carry a (truthy) opt-in key, e.g. internalDiagram? */
export function hasRoutesKey(dataDir, key) {
  const rj = readJson(path.join(dataDir, 'routes.json'), null);
  return !!(rj && rj[key]);
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

/** Full 4-output descriptor for the UI (toggles): what's available + enabled. */
export function outputsForClient(config, id) {
  const dataDir = mapDataDir(id);
  const cfg = config && typeof config === 'object' ? config : {};
  return Object.entries(OUTPUTS).map(([key, meta]) => ({
    key, base: meta.base, label: meta.label, portal: !!meta.portal,
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
      const { svgPath } = generateSvg({ dataDir, generator: o.gen, iconsDir: ENGINE_DIR, overridesFile: tmp });
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
      const { svgPath, log: genLog } = generateSvg({ dataDir, generator: o.gen, iconsDir: ENGINE_DIR, overridesFile: tmp });
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
  invalidatePoiCache(id);                              // drawn-POI universe may have changed
  return { archived, carried };
}

export { OUTPUT_FILES };
