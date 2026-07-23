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

import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ENGINE_DIR, generateSvg, rasterise } from '../render/renderMap.js';
import { mapDataDir, overridesPath, versionDir, OUTPUT_FILES } from './store.js';

const GEN = { internal: 'gen_internal.js', external: 'gen_external.js' };

function readJson(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

/** routes.json palette + textOn + display metadata for a map. */
export function readRoutesMeta(id) {
  const rj = readJson(path.join(mapDataDir(id), 'routes.json'), {}) || {};
  return {
    palette: rj.palette || {},
    textOn: rj.textOn || {},
    routeOrder: rj.panelOrder || rj.routeOrder || Object.keys(rj.palette || {}),
    internalDesc: rj.internalDesc || rj.serviceDesc || {},
    town: rj.town || rj.place || '',
  };
}

// The drawn-POI universe is static for an imported map (it only changes if the
// underlying data is re-imported), and enumerating runs a generator — so memoise
// it for the process lifetime. Import runs in a separate process, so a freshly
// imported map is always enumerated fresh by the server on first request.
const poiCache = new Map();

/**
 * Enumerate the POIs actually drawn on the internal map, in document order.
 * Renders once with EDITOR_KEYS=1 (baseline overrides) and reads the data-key
 * tags — so the toggle list matches exactly what the generator would draw.
 * @returns {{ key:string, cat:string, name:string }[]}
 */
export function enumeratePois(id) {
  if (poiCache.has(id)) return poiCache.get(id);
  const dataDir = mapDataDir(id);
  if (!existsSync(path.join(dataDir, GEN.internal))) return [];
  // Baseline (no overrides) so every POI is present; keys captured via EDITOR_KEYS.
  const empty = path.join(os.tmpdir(), `cbm-enum-${process.pid}-${Date.now()}.json`);
  writeFileSync(empty, '{}');
  let svg = '';
  try {
    const { svgPath } = generateSvg({
      dataDir, generator: GEN.internal, iconsDir: ENGINE_DIR,
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
  poiCache.set(id, out);
  return out;
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
 * Render both maps for a candidate overrides object WITHOUT persisting anything.
 * Writes the overrides to a temp file and returns the two SVG strings.
 */
export function preview(id, overrides) {
  const dataDir = mapDataDir(id);
  const tmp = path.join(os.tmpdir(), `cbm-preview-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(overrides || {}));
  const result = {};
  try {
    for (const [name, gen] of Object.entries(GEN)) {
      if (!existsSync(path.join(dataDir, gen))) continue;
      const { svgPath } = generateSvg({ dataDir, generator: gen, iconsDir: ENGINE_DIR, overridesFile: tmp });
      result[name] = readFileSync(svgPath, 'utf8');
    }
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
  return result; // { internal?: svgString, external?: svgString }
}

/**
 * Render + persist a version: write the canonical overrides.json, run each
 * generator (no editor keys → shippable bytes), rasterise to print JPGs, and
 * copy the four artefacts into renders/<storageKey>/ with a meta.json.
 * @returns {{ storageKey:string, files: Record<string,number>, log: string[] }}
 */
export async function renderVersion(id, overrides, storageKey) {
  const dataDir = mapDataDir(id);
  const outDir = versionDir(id, storageKey);
  mkdirSync(outDir, { recursive: true });

  // Render from a TEMP overrides file: if a generator or rasterise fails, the
  // canonical overrides.json and the last-good version are left untouched.
  const tmp = path.join(os.tmpdir(), `cbm-save-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(overrides || {}));

  const files = {};
  const log = [];
  try {
    for (const [name, gen] of Object.entries(GEN)) {
      if (!existsSync(path.join(dataDir, gen))) continue;
      const { svgPath, log: genLog } = generateSvg({ dataDir, generator: gen, iconsDir: ENGINE_DIR, overridesFile: tmp });
      if (genLog) log.push(`${gen}: ${genLog}`);
      const svgOut = path.join(outDir, `${name}.svg`);
      const jpgOut = path.join(outDir, `${name}.jpg`);
      cpSync(svgPath, svgOut);
      await rasterise(svgPath, jpgOut);
      files[`${name}.svg`] = statSync(svgOut).size;
      files[`${name}.jpg`] = statSync(jpgOut).size;
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

export { OUTPUT_FILES };
