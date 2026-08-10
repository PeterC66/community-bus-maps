// P9 Part B — GET /api/public/search.
//
// "Does any map cover my village?" The index is built from the same rows
// listPublicMaps() already restricts to published, listed maps of active
// customers (src/db/index.js) — never a raw walk of data/maps/, which would
// leak unpublished or unlisted work. Each map contributes its own name and
// subject, plus whatever places.json (src/search/place-index.js) recorded at
// publish time. See docs/P9-header-and-place-search.md Part B, B3/B4.

import { listPublicMaps } from '../db/index.js';
import { publicMap } from '../public/index.js';
import { readPlacesSidecar } from './place-index.js';

// Bumped by every path that can change what search should return: publish
// (place-index.js's writer runs first), revert, un/re-listing a map, and a
// customer's status changing. The index rebuilds lazily on the next search —
// cheap because there are only ever a handful of published maps.
let generation = 0;
let builtGeneration = -1;
let cachedHits = [];

export function bumpSearchIndex() {
  generation += 1;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bst\.(?=\s|$)/g, 'st')
    .replace(/&/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lower = ranked first. Mirrors "map name > subject > destination > stop > poi".
const ROLE_RANK = { map: 0, subject: 1, destination: 2, stop: 3, poi: 4 };

function reasonFor(hit) {
  switch (hit.role) {
    case 'map': return `${hit.map.kind === 'place' ? 'Buses serving' : 'Buses within'} ${hit.text}`;
    case 'subject': return `Covers ${hit.text}`;
    case 'destination': return hit.via ? `Route ${hit.via} goes to ${hit.text}` : `Buses go to ${hit.text}`;
    case 'stop': return hit.via ? `Route ${hit.via} passes through ${hit.text}` : `Buses pass through ${hit.text}`;
    case 'poi': return `${hit.text} is shown on the map`;
    default: return hit.text;
  }
}

function addHit(hits, map, role, text, via) {
  const norm = normalize(text);
  if (!norm) return;
  hits.push({ map, role, text, via: via || '', norm });
}

function buildIndex() {
  const hits = [];
  for (const row of listPublicMaps()) {
    const map = publicMap(row);
    if (!map.outputs.length) continue; // same "has a file to show" rule as publicMaps()
    addHit(hits, map, 'map', map.name);
    if (map.subject) addHit(hits, map, 'subject', map.subject);
    const sidecar = readPlacesSidecar(row.id, row.pub_key);
    if (!sidecar) continue; // not yet backfilled — run `npm run places:build`
    for (const p of sidecar.places || []) addHit(hits, map, p.role === 'destination' ? 'destination' : 'stop', p.name, p.via);
    for (const name of sidecar.pois || []) addHit(hits, map, 'poi', name);
  }
  return hits;
}

function ensureIndex() {
  if (builtGeneration !== generation) {
    cachedHits = buildIndex();
    builtGeneration = generation;
  }
  return cachedHits;
}

function wholeWordMatch(norm, qn) {
  const escaped = qn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(norm);
}

// exact=0, whole-word=1, prefix=2, substring=3 (lower is a stronger match).
function matchRank(norm, qn) {
  if (norm === qn) return 0;
  if (wholeWordMatch(norm, qn)) return 1;
  if (norm.startsWith(qn)) return 2;
  if (norm.includes(qn)) return 3;
  return -1;
}

const RESULT_CAP = 20;
const MIN_QUERY_LEN = 2;

/**
 * @param {string} q
 * @returns {{ map: object, reason: string }[]}
 */
export function searchPlaces(q) {
  const qn = normalize(q);
  if (qn.length < MIN_QUERY_LEN) return [];

  const best = new Map(); // mapId -> { score, hit }
  for (const hit of ensureIndex()) {
    const mr = matchRank(hit.norm, qn);
    if (mr < 0) continue;
    const score = ROLE_RANK[hit.role] * 10 + mr;
    const cur = best.get(hit.map.slug);
    if (!cur || score < cur.score || (score === cur.score && hit.text.length < cur.hit.text.length)) {
      best.set(hit.map.slug, { score, hit });
    }
  }

  return [...best.values()]
    .sort((a, b) => a.score - b.score || a.hit.map.name.localeCompare(b.hit.map.name))
    .slice(0, RESULT_CAP)
    .map(({ hit }) => ({ map: hit.map, reason: reasonFor(hit) }));
}
