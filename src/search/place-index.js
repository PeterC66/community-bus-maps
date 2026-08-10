// P9 Part B — the place-name index.
//
// Builds the small "places.json" sidecar for one published version, and reads
// it back for the search endpoint. The sidecar is derived from routes.json (an
// AREA map's `external[]`, a PLACE map's `destinations[]`) plus an optional
// pois.json, exactly as they stood when the version was published — never from
// the live data dir, which can run ahead of what a person actually reviewed.
// See docs/P9-header-and-place-search.md Part B, B1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mapDataDir, versionDir } from '../maps/store.js';

const SCHEMA = 1;

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

// Dedupe by (name, role, via) — the same place can legitimately appear as a
// destination on one route and an intermediate stop on another.
function addPlace(out, seen, name, role, via) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return;
  const key = `${clean.toLowerCase()}|${role}|${via || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(via ? { name: clean, role, via } : { name: clean, role });
}

/**
 * Read an AREA/PLACE map's routes.json (+ pois.json if present) from an
 * explicit data dir and derive the place-name universe. Pure read — no
 * generator run, so this is safe to call at publish time.
 * @param {string} dataDir
 * @param {'area'|'place'} kind
 * @returns {{ places: {name:string, role:string, via?:string}[], pois: string[] }}
 */
export function buildPlacesFromDir(dataDir, kind) {
  const rj = readJson(path.join(dataDir, 'routes.json'), {}) || {};
  const places = [];
  const seen = new Set();

  if (kind === 'place') {
    for (const d of Array.isArray(rj.destinations) ? rj.destinations : []) {
      const via = Array.isArray(d.routes) ? d.routes.filter(Boolean).join('/') : '';
      addPlace(places, seen, d.name, 'destination', via);
      for (const s of Array.isArray(d.stops) ? d.stops : []) addPlace(places, seen, s, 'stop', via);
    }
  } else {
    for (const r of Array.isArray(rj.external) ? rj.external : []) {
      const via = r.route || r.id || '';
      addPlace(places, seen, r.label, 'destination', via);
      for (const s of Array.isArray(r.stops) ? r.stops : []) addPlace(places, seen, s, 'stop', via);
    }
  }

  // pois.json is a vendored extra, present for some maps and not others (it is
  // not written by the generator, so its absence is normal, not an error).
  const pois = [];
  const poiJson = readJson(path.join(dataDir, 'pois.json'), null);
  if (Array.isArray(poiJson)) {
    const seenPoi = new Set();
    for (const p of poiJson) {
      const name = p && typeof p.name === 'string' ? p.name.trim() : '';
      if (!name || seenPoi.has(name.toLowerCase())) continue;
      seenPoi.add(name.toLowerCase());
      pois.push(name);
    }
  }

  return { places, pois };
}

/**
 * Write the places.json sidecar into a published version's own render folder,
 * derived from the map's LIVE data dir as it stands right now. Call this only
 * at the moment the publish pointer moves (or during the one-off backfill),
 * never speculatively — the sidecar's whole point is to describe exactly the
 * sheet that was reviewed.
 * @param {number} mapId
 * @param {string} storageKey  the published version's storage key
 * @param {{ kind: 'area'|'place', subject: string }} meta
 */
export function writePlacesSidecar(mapId, storageKey, meta) {
  const { places, pois } = buildPlacesFromDir(mapDataDir(mapId), meta.kind);
  const sidecar = {
    schema: SCHEMA,
    builtAt: new Date().toISOString(),
    kind: meta.kind,
    subject: meta.subject || '',
    places,
    pois,
  };
  const dir = versionDir(mapId, storageKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'places.json'), JSON.stringify(sidecar));
  return sidecar;
}

/** Read a published version's places.json sidecar, or null if it has none (not yet backfilled). */
export function readPlacesSidecar(mapId, storageKey) {
  const p = path.join(versionDir(mapId, storageKey), 'places.json');
  if (!existsSync(p)) return null;
  return readJson(p, null);
}
