// Deterministic render wrapper.
//
// Runs a map's generator (which lives in the map's own data folder) to emit an
// SVG, then rasterises that SVG to a print-ready A4 landscape JPG. No network,
// no AI — same inputs always produce the same bytes. The rasterise step mirrors
// engine/render.js exactly so the portal's output matches the desktop pipeline.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fixBadgeContrast } from './badgeContrast.js';
import { stampPilot } from './pilotStamp.js'; // PILOT: remove with docs/PILOT.md

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = path.resolve(HERE, '../../engine');

// Each generator writes one fixed-name SVG into its data folder. The place
// generators write the SAME base names (internal.svg / external.svg) as the area
// ones, so a place map's render folder is shaped identically to an area map's.
const SVG_OUT = {
  'gen_internal.js': 'internal.svg',
  'gen_external.js': 'external.svg',
  'gen_internal_place.js': 'internal.svg',
  'gen_external_places.js': 'external.svg',
  // P7 expert styles — geometry pre-stages that re-run gen_internal in a
  // workspace and copy the result out under their own artefact name.
  'gen_internal_schematic.js': 'internal-schematic.svg',
  'gen_internal_diagram.js': 'internal-diagram.svg',
};

function svgNameFor(generator) {
  const name = path.basename(generator); // may be an absolute engine path (P7)
  return (
    SVG_OUT[name] ||
    name.replace(/^gen_/, '').replace(/\.js$/, '') + '.svg'
  );
}

/**
 * Run a map's generator to (re)produce its SVG in `dataDir`.
 * @returns {{ svgPath: string, svgName: string, log: string }}
 */
export function generateSvg({
  dataDir,
  generator = 'gen_internal.js',
  iconsDir = ENGINE_DIR,
  overridesFile,
  editorKeys = false,
  // Pass false to get the generator's own bytes back untouched, with none of the
  // post-generation sheet fixes below. Only the byte-identical reproduce test
  // (scripts/verify-reproduce*.mjs) does — it is comparing generator output
  // against a shipped fixture, so anything laid on top would fail a gate that is
  // about determinism, not about presentation.
  stamp = true,
  /* The version this sheet is OF, printed in the footer band beside the QR
   * (footer.js design.sheetVersion; the engine adds the words "Map version" to a
   * bare number and prints anything else verbatim).
   *
   * Passed as an environment variable rather than written into the map's data,
   * because the data is shared by every version of the map and this is a fact
   * about ONE of them. The generator's own routes.json carries a `build <ver> ·
   * <date>` stamp put there by the skill's rollout.js — right for a sheet being
   * looked at during development, wrong the moment it reaches a customer — and
   * this is what overrides it.
   *
   * Absent (the byte-identical reproduce test, which passes nothing) the
   * generator falls back to routes.json, so the gate keeps reproducing the
   * fixture's own value and stays exactly as meaningful as it was.
   */
  sheetVersion,
} = {}) {
  if (!dataDir) throw new Error('generateSvg: dataDir is required');
  // Generators normally travel WITH the map (dataDir); the portal-owned expert
  // styles (P7) are passed as an absolute path out of engine/expert instead.
  const genPath = path.isAbsolute(generator) ? generator : path.join(dataDir, generator);
  const env = { ...process.env, LEAFLET_DIR: dataDir, SKILL_ASSETS: iconsDir };
  // Only pass OVERRIDES_FILE when explicitly given; otherwise the generator
  // falls back to <dataDir>/overrides.json (absent ⇒ byte-identical baseline).
  if (overridesFile !== undefined) env.OVERRIDES_FILE = overridesFile;
  // EDITOR_KEYS wraps routes/POIs in data-key groups so the portal can ENUMERATE
  // them. It is opt-in and never set for a shipped render, so the byte-identical
  // baseline (P0 gate) is unaffected.
  if (editorKeys) env.EDITOR_KEYS = '1';
  if (sheetVersion) env.LEAFLET_SHEET_VERSION = String(sheetVersion);

  const res = spawnSync(process.execPath, [genPath], {
    cwd: dataDir,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `generator ${generator} failed (exit ${res.status}):\n${res.stderr || res.stdout || '(no output)'}`,
    );
  }
  const svgName = svgNameFor(generator);
  const svgPath = path.join(dataDir, svgName);

  // Post-generation sheet fixes, applied here — AFTER the generator has run and
  // written its file — so (a) the generator itself stays byte-identical and the
  // P0 reproduce gate is unaffected, and (b) every consumer of the sheet (the
  // rasteriser below, the published .svg download, the editor preview) sees the
  // same artefact.
  //   1. badge contrast — a route number must stay readable on a recoloured
  //      badge; a no-op when the imported palette is used (badgeContrast.js).
  //   2. PILOT: the sample-map band. Delete this line to remove.
  if (stamp) {
    let out = fixBadgeContrast(readFileSync(svgPath, 'utf8'));
    out = stampPilot(out);
    writeFileSync(svgPath, out);
  }

  return { svgPath, svgName, log: (res.stdout || '').trim() };
}

/**
 * Rasterise an SVG (path or Buffer) to a JPG. Identical params to engine/render.js.
 * @returns {Promise<{ outJpg: string, width: number, height: number, density: number }>}
 */
export async function rasterise(svg, outJpg) {
  const buf = Buffer.isBuffer(svg) ? svg : readFileSync(svg);
  await sharp(buf)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: 300 })
    .toFile(outJpg);
  const m = await sharp(outJpg).metadata();
  return { outJpg, width: m.width, height: m.height, density: m.density };
}

/**
 * Full pipeline: generate the SVG, then rasterise it to a JPG.
 */
export async function renderMap({
  dataDir,
  generator = 'gen_internal.js',
  iconsDir = ENGINE_DIR,
  overridesFile,
  outJpg,
} = {}) {
  const { svgPath, svgName, log } = generateSvg({ dataDir, generator, iconsDir, overridesFile });
  const out = outJpg || svgPath.replace(/\.svg$/i, '.jpg');
  const ras = await rasterise(svgPath, out);
  return { svgPath, svgName, jpgPath: out, ...ras, log };
}
