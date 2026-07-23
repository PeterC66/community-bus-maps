// Object store for maps. Everything here lives UNDER DATA_DIR, which is
// git-ignored — per-map data, overrides and renders never enter the repo.
//
//   <DATA_DIR>/maps/<id>/
//     data/                 the map's generators + *.json inputs (its S4/S5 payload)
//     overrides.json        canonical saved safe-subset edits (source of truth)
//     renders/v<maj>.<min>/  internal.svg internal.jpg external.svg external.jpg meta.json
//
// The generator reads its inputs from data/ (LEAFLET_DIR) and writes the working
// SVG back into data/; a completed render is then copied into renders/v<ver>/.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db/index.js';

export const MAPS_DIR = path.join(DATA_DIR, 'maps');

export function mapDir(id) {
  return path.join(MAPS_DIR, String(id));
}
export function mapDataDir(id) {
  return path.join(mapDir(id), 'data');
}
export function overridesPath(id) {
  return path.join(mapDir(id), 'overrides.json');
}
export function rendersDir(id) {
  return path.join(mapDir(id), 'renders');
}
export function versionDir(id, storageKey) {
  return path.join(rendersDir(id), storageKey);
}

/** Create the folder skeleton for a new map and return its paths. */
export function ensureMapDirs(id) {
  const dirs = { root: mapDir(id), data: mapDataDir(id), renders: rendersDir(id) };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  // The vendored generators are CommonJS (they use require), but the repo root
  // package.json is "type":"module" and the object store lives inside the repo.
  // Drop a CommonJS-island marker beside the generators so Node runs them as CJS
  // (mirrors engine/package.json). Nearest package.json wins over the repo's.
  const marker = path.join(dirs.data, 'package.json');
  if (!existsSync(marker)) writeFileSync(marker, '{ "type": "commonjs" }\n');
  return dirs;
}

// The four artefacts a rendered version holds, and their content types.
export const OUTPUT_FILES = {
  'internal.svg': 'image/svg+xml',
  'internal.jpg': 'image/jpeg',
  'external.svg': 'image/svg+xml',
  'external.jpg': 'image/jpeg',
};
