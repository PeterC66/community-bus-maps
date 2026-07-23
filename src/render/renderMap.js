// Deterministic render wrapper.
//
// Runs a map's generator (which lives in the map's own data folder) to emit an
// SVG, then rasterises that SVG to a print-ready A4 landscape JPG. No network,
// no AI — same inputs always produce the same bytes. The rasterise step mirrors
// engine/render.js exactly so the portal's output matches the desktop pipeline.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = path.resolve(HERE, '../../engine');

// Each generator writes one fixed-name SVG into its data folder.
const SVG_OUT = {
  'gen_internal.js': 'internal.svg',
  'gen_external.js': 'external.svg',
};

function svgNameFor(generator) {
  return (
    SVG_OUT[generator] ||
    generator.replace(/^gen_/, '').replace(/\.js$/, '') + '.svg'
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
} = {}) {
  if (!dataDir) throw new Error('generateSvg: dataDir is required');
  const genPath = path.join(dataDir, generator);
  const env = { ...process.env, LEAFLET_DIR: dataDir, SKILL_ASSETS: iconsDir };
  // Only pass OVERRIDES_FILE when explicitly given; otherwise the generator
  // falls back to <dataDir>/overrides.json (absent ⇒ byte-identical baseline).
  if (overridesFile !== undefined) env.OVERRIDES_FILE = overridesFile;

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
  return { svgPath: path.join(dataDir, svgName), svgName, log: (res.stdout || '').trim() };
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
