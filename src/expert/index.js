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
//     review like any other change.
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

// ---------------------------------------------------------------------------
// Handle frame: where a solved junction actually lands on the finished sheet.
//
// A pin lives in the diagram solver's own page-mm frame. The sheet the expert is
// looking at does NOT use that frame: the solver writes a workspace (positions
// carried as synthetic lat/lons), gen_internal re-projects it and fits it to the
// map viewport, and the pilot band then shrinks the whole document again. Drawing
// a handle at the solved x/y therefore puts it somewhere near, but not on, its
// junction — which is exactly the "I can't tell which handle does what" problem.
//
// Rather than re-deriving any of those transforms (they belong to the generators,
// and would rot), we MEASURE the composite. Both frames contain the same stops:
// the workspace's atco2ll.json holds each stop's synthetic lat/lon, and the sheet
// — rendered with EDITOR_KEYS so its stop ticks are tagged — holds where that
// stop was drawn. Every step between the two is affine, so a least-squares fit
// over those pairs recovers the composite exactly, and one more fit turns it into
// mm → sheet. The editor gets that matrix and uses it (and its inverse) for
// handles and drags.
// ---------------------------------------------------------------------------

/** Solve `A·p = b` for a small square system (Gaussian elimination); null if singular. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Least-squares 2D affine mapping src[i] → dst[i], as { a,b,c,d,e,f } where
 * X = a·x + b·y + c and Y = d·x + e·y + f. Null if under-determined/degenerate.
 */
export function fitAffine(src, dst) {
  if (src.length < 3) return null;
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rx = [0, 0, 0], ry = [0, 0, 0];
  for (let i = 0; i < src.length; i++) {
    const u = [src[i][0], src[i][1], 1];
    for (let p = 0; p < 3; p++) {
      for (let q = 0; q < 3; q++) N[p][q] += u[p] * u[q];
      rx[p] += u[p] * dst[i][0];
      ry[p] += u[p] * dst[i][1];
    }
  }
  const X = solveLinear(N.map((r) => [...r]), rx);
  const Y = solveLinear(N.map((r) => [...r]), ry);
  if (!X || !Y || [...X, ...Y].some((v) => !Number.isFinite(v))) return null;
  return { a: X[0], b: X[1], c: X[2], d: Y[0], e: Y[1], f: Y[2] };
}

const applyAffine = (m, [x, y]) => [m.a * x + m.b * y + m.c, m.d * x + m.e * y + m.f];

/**
 * Affine fit that ignores reference points which disagree with the majority.
 *
 * The stop ticks we measure against are drawn ON the route line the stop was
 * map-matched to, a little off the stop's own coordinates, and a few are matched
 * badly. Plain least squares lets those few drag the whole frame, so fit once,
 * keep the points that agree, and fit again on those.
 */
function fitAffineRobust(src, dst, keep = 0.7) {
  const first = fitAffine(src, dst);
  if (!first || src.length < 8) return first;
  const idx = src
    .map((s, i) => ({ i, r: Math.hypot(...applyAffine(first, s).map((v, k) => v - dst[i][k])) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, Math.max(6, Math.round(src.length * keep)))
    .map((e) => e.i);
  return fitAffine(idx.map((i) => src[i]), idx.map((i) => dst[i])) || first;
}

/** Stop ticks in a sheet rendered with EDITOR_KEYS: ATCO → [x, y] in sheet units. */
function taggedStops(svg) {
  const re = /<g data-kind="stop" data-key="([^"]*)"><circle\s+cx="(-?[\d.]+)"\s+cy="(-?[\d.]+)"/g;
  const out = new Map();
  let m;
  while ((m = re.exec(svg))) {
    // Route-offset ticks are keyed "<route>:<ATCO>" and sit beside the stop, not
    // on it — only the plain per-stop tick is a trustworthy reference point.
    if (m[1].includes(':')) continue;
    if (!out.has(m[1])) out.set(m[1], [Number(m[2]), Number(m[3])]);
  }
  return out;
}

/** The pilot band's document transform, as an affine (identity when not stamped). */
function pilotTransform(svg) {
  const m = /<g id="pilot-content" transform="translate\((-?[\d.]+),(-?[\d.]+)\) scale\((-?[\d.]+)\)"/.exec(svg);
  if (!m) return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
  const s = Number(m[3]);
  return { a: s, b: 0, c: Number(m[1]), d: 0, e: s, f: Number(m[2]) };
}

/**
 * The affine taking a solved junction's page-mm to its position on the sheet.
 * Null when it cannot be measured (no tagged stops, too few junctions, or a
 * non-affine warp) — the editor then falls back to the raw solver coordinates.
 */
function measureHandleFrame(dir, svg, nodes) {
  let atco2ll;
  try { atco2ll = JSON.parse(readFileSync(path.join(dir, WORKDIR, 'atco2ll.json'), 'utf8')); }
  catch { return null; }
  const drawn = taggedStops(svg);
  // Synthetic lat/lon → sheet. The workspace carries positions as [lat, lon]; the
  // generator's planar projection is (lon, −lat), so feed it in that orientation.
  const src = [], dst = [];
  for (const [atco, ll] of Object.entries(atco2ll)) {
    const p = drawn.get(atco);
    if (!p || !Array.isArray(ll)) continue;
    src.push([ll[1], -ll[0]]);
    dst.push(p);
  }
  const llToSheet = fitAffineRobust(src, dst);
  if (!llToSheet) return null;

  // …then mm → sheet, via the junctions (which know both their mm and their
  // synthetic lat/lon), with the pilot band's document transform composed on.
  const pilot = pilotTransform(svg);
  const mm = [], sheet = [];
  for (const n of Object.values(nodes)) {
    if (!n || !Array.isArray(n.wll)) continue;
    mm.push([n.x, n.y]);
    sheet.push(applyAffine(pilot, applyAffine(llToSheet, [n.wll[1], -n.wll[0]])));
  }
  return fitAffine(mm, sheet);
}

/**
 * Solve the diagram in `dir` with the given pins and return the SVG, the solved
 * junction positions the editor drags (page-mm in the pre-solve frame), and the
 * affine that maps those onto the sheet the editor draws handles over.
 *
 * @param {string} dir        a sandbox (preview) or the live data dir (save)
 * @param {object|null} pins  pins to apply; null = leave the folder's layout as-is
 * @param {object} overrides  the customer's safe-subset overrides (merged with the
 *                            map's base framing here, exactly as a real render does)
 * @returns {{ svg:string, nodes:object, frame:object|null, log:string }}
 */
export function solveDiagram(dir, pins, overrides) {
  if (pins != null) writePins(dir, pins);
  const tmp = path.join(os.tmpdir(), `cbm-diagram-ov-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(mergeOverrides(readBaseOverrides(dir), overrides || {})));
  try {
    // editorKeys tags the stop ticks so the handle frame can be measured. It only
    // adds <g> wrappers, and this SVG is a preview — a save re-renders through the
    // ordinary versioned path, which never sets it.
    const { log } = generateSvg({
      dataDir: dir, generator: DIAGRAM_GEN, iconsDir: ENGINE_DIR, overridesFile: tmp, editorKeys: true,
    });
    const nodesPath = path.join(dir, WORKDIR, 'solved-nodes.json');
    const svg = readFileSync(path.join(dir, DIAGRAM_SVG), 'utf8');
    const nodes = existsSync(nodesPath) ? JSON.parse(readFileSync(nodesPath, 'utf8')) : {};
    return { svg, nodes, frame: measureHandleFrame(dir, svg, nodes), log: log || '' };
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
