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

// The four possible outputs of a map. `portal:true` = the portal engine can
// render it today (geographic + external); the schematic + diagram outputs are
// modelled so the toggle UI + data model are complete, but their generators are
// re-homed later (expert styles, P7), so they render as `portal:false` for now.
// `base` is the artefact basename in a render folder (<base>.svg / <base>.jpg).
export const OUTPUTS = {
  internal_geographic: { gen: 'gen_internal.js',       base: 'internal',           label: 'Within the area', portal: true },
  external:            { gen: 'gen_external.js',        base: 'external',           label: 'To nearby towns', portal: true },
  internal_schematic:  { gen: 'schematize_internal.js', base: 'internal-schematic', label: 'Octolinear schematic', portal: false },
  internal_diagram:    { gen: 'diagram_internal.js',    base: 'internal-diagram',   label: 'Tube-map diagram', portal: false },
};

// Files a rendered version can hold, with content types (derived from OUTPUTS).
export const OUTPUT_FILES = Object.fromEntries(
  Object.values(OUTPUTS).flatMap((o) => [
    [`${o.base}.svg`, 'image/svg+xml'],
    [`${o.base}.jpg`, 'image/jpeg'],
  ]),
);
