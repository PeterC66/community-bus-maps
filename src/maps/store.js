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
// Expert framing baked into a map's payload (river-hide, frozen viewport). It is
// NOT a customer edit: it lives inside data/ and is merged UNDER the customer's
// safe-subset overrides at render time. Area maps have none (absent ⇒ empty ⇒
// byte-identical baseline). See src/maps/engine.js and engine/place/README.md.
export const BASE_OVERRIDES = 'base-overrides.json';
// P7 — the expert's hand-placed junction pins for the tube-map diagram, written by
// the pin editor into the map's data folder and read by the diagram engine on every
// render. Expert work, not a customer edit and not part of a monthly payload, so it
// is carried forward when fresh data is swapped in (see swapInProposedData).
export const DIAGRAM_LAYOUT = 'diagram-layout.json';
export function diagramLayoutPath(id) {
  return path.join(mapDataDir(id), DIAGRAM_LAYOUT);
}
export function baseOverridesPath(id) {
  return path.join(mapDataDir(id), BASE_OVERRIDES);
}
export function rendersDir(id) {
  return path.join(mapDir(id), 'renders');
}
export function versionDir(id, storageKey) {
  return path.join(rendersDir(id), storageKey);
}

// P5 — a staged monthly refresh lives under proposed/<pid>/data until the
// customer accepts it (then it is swapped into data/) or declines (left as-is).
export function proposedRoot(id) {
  return path.join(mapDir(id), 'proposed');
}
export function proposedDataDir(id, pid) {
  return path.join(proposedRoot(id), String(pid), 'data');
}
// When a refresh is accepted, the outgoing live data is moved here (never deleted).
export function archiveRoot(id) {
  return path.join(mapDir(id), 'archive');
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

/**
 * Create the staging folder for a proposed update and drop the CommonJS-island
 * marker beside its generators (so the staged generators run when we render the
 * old-vs-new preview from this folder). Returns the staged data dir.
 */
export function ensureProposedDirs(id, pid) {
  const dataDir = proposedDataDir(id, pid);
  mkdirSync(dataDir, { recursive: true });
  const marker = path.join(dataDir, 'package.json');
  if (!existsSync(marker)) writeFileSync(marker, '{ "type": "commonjs" }\n');
  return dataDir;
}

// The four possible outputs of a map. `portal:true` = the portal engine can
// render it today (geographic + external); the schematic + diagram outputs are
// modelled so the toggle UI + data model are complete, but their generators are
// re-homed later (expert styles, P7), so they render as `portal:false` for now.
// `base` is the artefact basename in a render folder (<base>.svg / <base>.jpg).
//
// `gens` is a candidate list, tried in order: the first generator PRESENT in a
// map's data folder wins. This is how one output serves both kinds — an AREA map
// carries gen_internal.js / gen_external.js; a PLACE map carries the wrapper
// gen_internal_place.js (+ gen_internal.js) / gen_external_places.js. See
// resolveGen() in engine.js.
// The two EXPERT styles (P7) are portal-owned rather than per-map: a town's render
// folder never carried them, and they are geometry pre-stages that re-run the
// map's OWN gen_internal.js in a workspace. So they resolve from `engine/expert/`
// (`engine: 'expert'`) and are only available when the map's routes.json opts in
// with the config key the pre-stage requires (`requiresConfig`) — a map without it
// shows the output as unavailable instead of failing at render time.
//
// `requestOnly` marks an output the customer may SEE but not switch on: the
// tube-map diagram is generated and then pinned by hand in the pin editor, and
// those pins are ours to maintain on every later refresh, so it is quoted
// separately rather than being a tick-box. The editor shows it locked with an
// "Ask us" button; the lock itself is enforced in chooseOutputs() (engine.js) —
// hiding a checkbox is UX, not security.
//
// `buildAlways` marks an output that is RENDERED whenever the map's data
// supports it (config key present), independent of the `enabled` flag a
// customer switches: the schematic is cheap and deterministic to produce, so it
// is kept ready in every version's files, but it is still hidden from the
// customer's tabs/downloads and the public page until they tick the box —
// `enabled` there is a pure VISIBILITY gate, not a build gate. See
// effectiveOutputs() (engine.js, what gets rendered) vs outputsForClient() /
// visibleDownloadsForVersion() (server.js, what the customer is shown).
export const OUTPUTS = {
  internal_geographic: { gens: ['gen_internal_place.js', 'gen_internal.js'], base: 'internal',           label: 'Within the area', portal: true },
  external:            { gens: ['gen_external.js', 'gen_external_places.js'], base: 'external',           label: 'To nearby towns', portal: true },
  internal_schematic:  { gens: ['gen_internal_schematic.js'], engine: 'expert', expert: true, requiresConfig: 'internalSchematic', base: 'internal-schematic', label: 'Octolinear schematic', portal: true, buildAlways: true },
  internal_diagram:    { gens: ['gen_internal_diagram.js'],   engine: 'expert', expert: true, requiresConfig: 'internalDiagram',   base: 'internal-diagram',   label: 'Tube-map diagram',     portal: true, requestOnly: true },
};

// Files a rendered version can hold, with content types (derived from OUTPUTS).
// `disagreements.pdf` isn't a render output (nothing toggles it, no SVG/JPG
// pair) — it's a static per-map extra carried forward by renderVersion() from
// the map's data folder, same as diagram-layout.json. See docs/DEVELOPING.md.
export const OUTPUT_FILES = Object.fromEntries([
  ...Object.values(OUTPUTS).flatMap((o) => [
    [`${o.base}.svg`, 'image/svg+xml'],
    [`${o.base}.jpg`, 'image/jpeg'],
  ]),
  ['disagreements.pdf', 'application/pdf'],
]);
