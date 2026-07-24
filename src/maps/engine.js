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
import { mapDataDir, overridesPath, versionDir, proposedDataDir, archiveRoot, OUTPUTS, OUTPUT_FILES } from './store.js';

const GEN_INTERNAL = 'gen_internal.js';

/** Default output enablement: portal-supported outputs on, the rest off. */
export function defaultOutputs() {
  const o = {};
  for (const [key, meta] of Object.entries(OUTPUTS)) o[key] = !!meta.portal;
  return o;
}

/**
 * The outputs to actually render for a map: enabled AND portal-supported AND the
 * generator is present. An empty/absent config means "portal defaults on" — so a
 * map imported before output toggles existed still renders both.
 * @returns {{ key:string, gen:string, base:string, label:string }[]}
 */
export function effectiveOutputs(config, dataDir) {
  const cfg = config && typeof config === 'object' ? config : {};
  const out = [];
  for (const [key, meta] of Object.entries(OUTPUTS)) {
    if (!meta.portal) continue;
    if (cfg[key] === false) continue; // undefined => on
    if (!existsSync(path.join(dataDir, meta.gen))) continue;
    out.push({ key, ...meta });
  }
  return out;
}

/** Full 4-output descriptor for the UI (toggles): what's available + enabled. */
export function outputsForClient(config, id) {
  const dataDir = mapDataDir(id);
  const cfg = config && typeof config === 'object' ? config : {};
  return Object.entries(OUTPUTS).map(([key, meta]) => ({
    key, base: meta.base, label: meta.label, portal: !!meta.portal,
    available: !!meta.portal && existsSync(path.join(dataDir, meta.gen)),
    enabled: meta.portal ? cfg[key] !== false : false,
  }));
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
  // Baseline (no overrides) so every POI is present; keys captured via EDITOR_KEYS.
  const empty = path.join(os.tmpdir(), `cbm-enum-${process.pid}-${Date.now()}.json`);
  writeFileSync(empty, '{}');
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
  writeFileSync(tmp, JSON.stringify(overrides || {}));
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
  // canonical overrides.json and the last-good version are left untouched.
  const tmp = path.join(os.tmpdir(), `cbm-save-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(overrides || {}));

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
  } finally {
    try { unlinkSync(tmp); } catch {}
  }

  // Success — commit the canonical overrides.json and the version's meta.
  writeFileSync(overridesPath(id), JSON.stringify(overrides || {}, null, 2) + '\n');
  writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify({ storageKey, created: new Date().toISOString(), overrides: overrides || {}, files }, null, 2),
  );
  return { storageKey, files, log };
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
  invalidatePoiCache(id);                              // drawn-POI universe may have changed
  return { archived };
}

export { OUTPUT_FILES };
