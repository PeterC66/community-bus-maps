// OA-312 round 1 — every named place in Great Britain, and the local transport
// authority each English one belongs to.
//
// The directory matcher (src/search/directory.js) reaches an authority through
// the words the directory itself holds: 76 authority names, the hand-written
// covers[] areas, the towns listed as examples. That is the right FIRST answer,
// and it is silent for Harrogate, Lancaster and every village in England. This
// module is the second stage that runs when the first one misses: a place name
// in, the district it is in and the authority for that district out — from the
// ONS Index of Place Names (IPN), vendored from the private buses-data
// repository exactly as the directory is, byte-identical and checked by
// `npm run sync:directory -- --check`.
//
// FOUR RULES THIS FILE EXISTS TO KEEP.
//
//   1. **No guessing.** A name the Index does not hold gets `kind: 'none'`, and
//      the panel prints the same honest sentence it printed before this file
//      existed. A name in Scotland or Wales is placed in its country and
//      resolved to no authority, because the directory covers the 76 English
//      transport authorities and nothing else. A district whose authority has
//      no directory row (the Isles of Scilly) is named as such. A plausible
//      wrong county would be worse than any of these, and the letter that hangs
//      off a directory row would then be addressed to the wrong council.
//   2. **Prefix matching over 60,000 terms is a different animal from prefix
//      matching over 300.** "Whit" is the start of hundreds of names. So an
//      exact match always answers; a prefix or whole-word match answers only
//      when the query is four characters or longer AND the hits number eight or
//      fewer; otherwise the reader is told the name is too short to place and
//      how many places begin with it. Nothing here returns a page of Whitmores.
//   3. **Several places of one name are all shown, in a stated order.** Each
//      entry carries a `kind` bit field written by the builder in buses-data —
//      1 a 2022 Census built-up area, 2 a named locality, 4 a ward or division
//      in that district named for the place — and they are ordered built-up area
//      first, then locality, then ward, then England before the other two
//      countries, then by district name. St Neots is why the third bit exists:
//      its built-up area spills from Huntingdonshire into Bedford, Bedford is its
//      own transport authority, and the Index holds no locality row for the town
//      at all — the wards named "St Neots …" are what put Huntingdonshire first.
//   4. **Nothing here reads the clock.** The edition and the date it was built
//      are values in places-source.json, printed as they stand; how old the
//      edition is, is buses-data's worklist's question.
//
// THE FILES ARE SERVER-SIDE ONLY, in src/search/data/, and never in public/: the
// browser never needs 1.2 MB of place names to draw a panel the server has
// already answered. They are read once, at first use, and cached for the life of
// the process — the file never changes under a running server.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLACES_DIR = path.join(HERE, 'data');
export const PLACE_FILES = {
  places: path.join(PLACES_DIR, 'places.json'),
  lads: path.join(PLACES_DIR, 'lad-to-lta.json'),
  source: path.join(PLACES_DIR, 'places-source.json'),
};

/**
 * Deliberately the SAME normalisation as src/search/index.js and, until this
 * file existed, a private copy inside src/search/directory.js — which now imports
 * this one, so the directory stage and the place stage cannot disagree about
 * what "St." means. If index.js's normalize() changes, change this with it.
 */
export function normalize(s) {
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

const COUNTRY = { E: 'England', S: 'Scotland', W: 'Wales' };
const KIND_BUA = 1, KIND_LOC = 2, KIND_WARD = 4;

/** Higher sorts first: built-up area, then locality, then a namesake ward. */
function weight(kind) {
  return (kind & KIND_BUA ? 4 : 0) + (kind & KIND_LOC ? 2 : 0) + (kind & KIND_WARD ? 1 : 0);
}

export const PREFIX_MIN_LENGTH = 4;
export const PREFIX_MAX_HITS = 8;

let cached = null;

/**
 * Read and index the vendored place files. Cached. A missing or broken file
 * yields an empty index with `error` set, never a throw: the maps half of the
 * page and the directory's own matching are still worth giving.
 */
export function loadPlaces(files = PLACE_FILES) {
  if (cached && cached.files === files) return cached;
  let placesDoc, ladDoc, source;
  try {
    placesDoc = JSON.parse(readFileSync(files.places, 'utf8'));
    ladDoc = JSON.parse(readFileSync(files.lads, 'utf8'));
    source = JSON.parse(readFileSync(files.source, 'utf8'));
  } catch (e) {
    cached = { files, entries: [], exact: new Map(), source: null, error: e.message };
    return cached;
  }
  const ltaByLad = new Map();
  for (const d of ladDoc.districts || []) ltaByLad.set(d.lad, { lta: d.lta, by: d.by || '' });
  const lads = (placesDoc.lads || []).map(([code, name, county, country]) => ({ code, name, county: county || '', country }));
  const entries = [];
  const exact = new Map(); // normalised term -> entries (a term may name several places)
  const addTerm = (term, entry) => {
    const n = normalize(term);
    if (!n) return;
    const list = exact.get(n);
    if (list) { if (!list.includes(entry)) list.push(entry); } else exact.set(n, [entry]);
  };
  for (const [name, ladIndex, kind] of placesDoc.places || []) {
    const lad = lads[ladIndex];
    if (!lad) continue;
    const join = lad.country === 'E' ? ltaByLad.get(lad.code) : undefined;
    const entry = {
      name,
      norm: normalize(name),
      district: lad.name,
      county: lad.county,
      country: COUNTRY[lad.country] || lad.country,
      lad: lad.code,
      kind,
      weight: weight(kind),
      // undefined outside England; null for an English district with no directory row
      lta: join ? join.lta : undefined,
      ltaWhy: join ? join.by : '',
    };
    entries.push(entry);
    addTerm(name, entry);
    // The qualified forms, so "Burford Torridge" and "Burford Devon" each land on
    // one entry: it is how the "other places called Burford" links work.
    addTerm(`${name} ${lad.name}`, entry);
    if (lad.county) addTerm(`${name} ${lad.county}`, entry);
  }
  cached = { files, entries, exact, source, error: null, lads: lads.length };
  return cached;
}

/** Test seam. */
export function resetPlacesCache() { cached = null; }

function orderHits(hits) {
  return [...hits].sort((a, b) =>
    b.weight - a.weight
    || (a.country === 'England' ? 0 : 1) - (b.country === 'England' ? 0 : 1)
    || a.district.localeCompare(b.district, 'en')
    || a.name.localeCompare(b.name, 'en'));
}

/**
 * Where is this place?
 *
 * @param {string} q  what the reader typed
 * @returns {{kind:'none'}
 *   | {kind:'short', count:number}
 *   | {kind:'found', hits: object[], exact: boolean}}
 *   `hits` are entries as built in loadPlaces(), best first (rule 3).
 */
export function resolvePlace(q, files = PLACE_FILES) {
  const qn = normalize(q);
  if (qn.length < 2) return { kind: 'none' };
  const { entries, exact } = loadPlaces(files);
  const direct = exact.get(qn);
  if (direct && direct.length) return { kind: 'found', hits: orderHits(direct), exact: true };
  if (qn.length < PREFIX_MIN_LENGTH) return entries.length ? { kind: 'short', count: null } : { kind: 'none' };
  const re = new RegExp(`(^|\\s)${qn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const near = entries.filter((e) => e.norm.startsWith(qn) || re.test(e.norm));
  if (!near.length) return { kind: 'none' };
  if (near.length > PREFIX_MAX_HITS) return { kind: 'short', count: near.length };
  return { kind: 'found', hits: orderHits(near), exact: false };
}

/** A hit, flattened for the panel — what the reader is told about this place. */
export function describeHit(h) {
  return {
    name: h.name,
    district: h.district,
    county: h.county,
    country: h.country,
    // The search that lands on exactly this entry, for the "other places called X" links.
    query: `${h.name} ${h.district}`,
    where: h.county && h.county !== h.district ? `${h.district}, ${h.county}` : h.district,
  };
}

/** The provenance the panel footer prints. Values from the file, never the clock. */
export function placesSource(files = PLACE_FILES) {
  const s = loadPlaces(files).source || {};
  return { dataset: s.dataset || 'Index of Place Names in Great Britain', edition: s.edition || '', licence: s.licence || '', publisher: s.publisher || '' };
}

/** How many places the vendored index holds — for tests and the health of the join. */
export function placesSize(files = PLACE_FILES) {
  return loadPlaces(files).entries.length;
}
