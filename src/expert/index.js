// Expert side (P7): the tube-map DIAGRAM pin editor, re-homed into the portal.
//
// The diagram engine solves a junction layout automatically, then lets an expert
// nudge junctions by hand; each nudge is a **pin** (a strong solver spring) stored
// in the map's `diagram-layout.json`. Pins are the one piece of hand-tuning that
// must survive a data refresh, which the engine handles by re-resolving a pin to
// the nearest junction within `pinResolveM` metres of its stored lat/lon — so this
// module only has to store them and re-solve.
//
// Two rules shape the code below:
//
//  1. **Previews never touch the live map.** Solving runs the real engine, which
//     writes a workspace + an SVG into whatever folder it is pointed at, so a
//     preview runs in a per-map SANDBOX (a copy of the map's data). Only Save
//     writes `diagram-layout.json` into the live data — and then goes through the
//     normal versioned render, so the result is a draft that still needs the P4
//     sign-off like any other change.
//
//  2. **What the expert sees is what the map is.** The solve is passed the same
//     merged overrides the real render uses (the map's expert framing plus the
//     customer's recolours/POI hides), so pins are placed against the real sheet
//     rather than a wireframe.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE_DIR, generateSvg } from '../render/renderMap.js';
import { mapDataDir, DIAGRAM_LAYOUT, OUTPUTS } from '../maps/store.js';
import { EXPERT_DIR, readBaseOverrides, mergeOverrides, readOverrides, resolveGen } from '../maps/engine.js';

const DIAGRAM_GEN = path.join(EXPERT_DIR, 'gen_internal_diagram.js');
const DIAGRAM_SVG = 'internal-diagram.svg';
const WORKDIR = 'diagram'; // the engine's workspace (holds solved-nodes.json)

/** Is the diagram output usable for this map (engine present + routes.json opts in)? */
export function diagramAvailable(id) {
  return !!resolveGen(OUTPUTS.internal_diagram, mapDataDir(id));
}

/** The pins currently saved for a map ({} when it has never been tuned). */
export function readPins(dataDir) {
  try {
    const l = JSON.parse(readFileSync(path.join(dataDir, DIAGRAM_LAYOUT), 'utf8'));
    return (l && l.pins) || {};
  } catch { return {}; }
}

export function writePins(dataDir, pins) {
  writeFileSync(path.join(dataDir, DIAGRAM_LAYOUT), JSON.stringify({ pins: pins || {} }, null, 1) + '\n');
}

/** Drop a map's layout file entirely (used when the expert clears every pin). */
export function clearPins(dataDir) {
  try { unlinkSync(path.join(dataDir, DIAGRAM_LAYOUT)); } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// Per-map preview sandbox: a copy of the map's *.json + *.js, reused across
// solves in this process (a solve rewrites the workspace each time anyway) and
// rebuilt when the live data is newer — e.g. after an accepted monthly refresh.
// ---------------------------------------------------------------------------
const sandboxes = new Map(); // id -> { dir, stamp }

function dataStamp(dataDir) {
  try { return statSync(path.join(dataDir, 'routes.json')).mtimeMs; } catch { return 0; }
}

export function diagramSandbox(id) {
  const live = mapDataDir(id);
  const stamp = dataStamp(live);
  const cached = sandboxes.get(id);
  if (cached && cached.stamp === stamp && existsSync(cached.dir)) return cached.dir;
  if (cached) { try { rmSync(cached.dir, { recursive: true, force: true }); } catch { /* ignore */ } }

  const dir = mkdtempSync(path.join(os.tmpdir(), `cbm-diagram-${id}-`));
  for (const f of readdirSync(live)) {
    const p = path.join(live, f);
    try { if (!statSync(p).isFile()) continue; } catch { continue; }
    if (!/\.(json|js)$/.test(f)) continue;
    cpSync(p, path.join(dir, f));
  }
  // The vendored generators are CommonJS; the sandbox sits in the OS temp dir, so
  // it inherits no "type":"module" — but drop the marker anyway to be explicit.
  writeFileSync(path.join(dir, 'package.json'), '{ "type": "commonjs" }\n');
  sandboxes.set(id, { dir, stamp });
  return dir;
}

export function dropSandbox(id) {
  const cached = sandboxes.get(id);
  if (!cached) return;
  try { rmSync(cached.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  sandboxes.delete(id);
}

/**
 * Solve the diagram in `dir` with the given pins and return the SVG plus the
 * solved junction positions the editor drags (page-mm in the pre-solve frame).
 *
 * @param {string} dir        a sandbox (preview) or the live data dir (save)
 * @param {object|null} pins  pins to apply; null = leave the folder's layout as-is
 * @param {object} overrides  the customer's safe-subset overrides (merged with the
 *                            map's base framing here, exactly as a real render does)
 * @returns {{ svg:string, nodes:object, log:string }}
 */
export function solveDiagram(dir, pins, overrides) {
  if (pins != null) writePins(dir, pins);
  const tmp = path.join(os.tmpdir(), `cbm-diagram-ov-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(mergeOverrides(readBaseOverrides(dir), overrides || {})));
  try {
    const { log } = generateSvg({ dataDir: dir, generator: DIAGRAM_GEN, iconsDir: ENGINE_DIR, overridesFile: tmp });
    const nodesPath = path.join(dir, WORKDIR, 'solved-nodes.json');
    return {
      svg: readFileSync(path.join(dir, DIAGRAM_SVG), 'utf8'),
      nodes: existsSync(nodesPath) ? JSON.parse(readFileSync(nodesPath, 'utf8')) : {},
      log: log || '',
    };
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** Solve a map's diagram in its sandbox, with its saved customer overrides. */
export function previewDiagram(id, pins) {
  return solveDiagram(diagramSandbox(id), pins || {}, readOverrides(id));
}

/**
 * Lines from the engine's own log that an expert needs to see: unresolved or
 * re-resolved pins, and how many were applied. (The rest is solver chatter.)
 */
export function pinNotes(log) {
  return String(log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^pin /.test(l) || /^pins: /.test(l));
}
