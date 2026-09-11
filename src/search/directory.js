// OA-308 tier 2 — the national directory of local bus maps, in the place search.
//
// The search above this one (src/search/index.js) answers "does any map WE
// published cover my village?". This one answers the question a miss leaves
// behind: "then does anybody publish one?" — from a vendored copy of the
// directory kept in the private buses-data repository, one row per English
// local transport authority plus Transport for London.
//
// THREE RULES THIS FILE EXISTS TO KEEP.
//
//   1. **A directory row is never ours and must never read as ours.** Every row
//      we surface is somebody else's map, checked once on a date, and the card
//      says so in as many words: "Published by <authority>, last checked on
//      <date>". We vouch for the fact that it existed on that date and for
//      nothing else — not its accuracy, not its currency, not its licence.
//   2. **Matching is on the AUTHORITY and on the town names the directory
//      already records, and on nothing else.** There is no place-to-authority
//      dataset here, so a query this file cannot place gets an honest miss
//      rather than a guessed authority. "Harrogate" matching nothing is the
//      correct answer today, and the page says plainly that it found nothing
//      rather than naming a plausible county.
//   3. **An absence is a result.** An authority that publishes NOTHING is the
//      most useful row on the page for a reader who is about to ask somebody
//      for a map, so `status: 'none'` is rendered, not filtered out.
//
// The vendored file is public/data/bus-map-directory.json, a byte-identical
// copy of BusMapsUK/bus-map-directory/directory.json in buses-data, kept in
// step by `npm run sync:directory` and checked by `-- --check` in verify.yml,
// which is the workflow that already has a buses-data checkout. Nothing here
// reads the clock: `checked` is a value in the file, so the same query gives
// the same answer tomorrow.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DIRECTORY_FILE = path.join(HERE, '..', '..', 'public', 'data', 'bus-map-directory.json');

// Words that say what KIND of body an authority is, not which one it is. A
// reader searches for "Bedford", never for "Bedford Borough Council", so these
// are stripped to make a second match term — the full name stays a term too.
const GOVERNANCE_WORDS = /\b(county|borough|city|district|metropolitan|mayoral|combined|authority|council|of|the|royal)\b/g;

// Deliberately the SAME normalisation as src/search/index.js. Two search
// boxes on one page that disagreed about what "St." means would be a bug a
// reader could see, and the rule lives in one shape rather than two copies
// that drift: if that file's normalize() changes, change this with it. The
// duplication is here rather than shared because src/search/index.js imports
// the database and this module must stay loadable without one.
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

function wholeWordMatch(norm, qn) {
  const escaped = qn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(norm);
}

// exact=0, whole-word=1, prefix=2 (lower is stronger). Substring is NOT a match
// here, unlike the map search: "ton" hitting eleven authorities because they
// contain the letters is noise on a panel that is already a second answer.
function matchRank(norm, qn) {
  if (norm === qn) return 0;
  if (wholeWordMatch(norm, qn)) return 1;
  if (norm.startsWith(qn)) return 2;
  return -1;
}

// A term is what a reader might type; `kind` is how we explain the hit to them.
// HOW STRONGLY a term matched decides the order (matchRank above, ×10); which
// kind of term it was only breaks ties, because an exact town name is a better
// answer than a half-matched county however much the county looks official.
const KIND_TIEBREAK = { authority: 0, area: 1, town: 2 };

let cached = null;

/** Read and index the vendored directory. Cached — the file never changes under a running process. */
export function loadDirectory(file = DIRECTORY_FILE) {
  if (cached && cached.file === file) return cached;
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    // A missing or broken vendored file must not take the whole search down:
    // the maps half of the answer is still worth giving. Tests assert the file
    // is present and well-formed, so this path is a runtime guard, not a
    // tolerated state.
    cached = { file, rows: [], terms: [], error: e.message };
    return cached;
  }
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const terms = [];
  for (const row of rows) {
    const add = (text, kind) => {
      const norm = normalize(text);
      if (norm) terms.push({ row, kind, text, norm });
    };
    add(row.lta, 'authority');
    const bare = String(row.lta || '').replace(GOVERNANCE_WORDS, ' ').replace(/\s+/g, ' ').trim();
    if (bare && bare !== row.lta) add(bare, 'authority');
    // `covers` is the half of "authority and area name" that the authority's own
    // name does not carry: Derbyshire inside the East Midlands Combined
    // Authority, Wigan inside Greater Manchester, Allerdale inside Cumberland.
    // Without these a reader searching the place they live in matched nothing at
    // all, because their council was abolished into one named after somewhere
    // else — see the directory README's note on the two added fields.
    for (const area of row.covers || []) add(area, 'area');
    for (const town of (row.townMaps && row.townMaps.examples) || []) add(town, 'town');
  }
  cached = { file, rows, terms, error: null };
  return cached;
}

/** Test seam: forget the cached parse so a test can point at another file. */
export function resetDirectoryCache() { cached = null; }

/**
 * What one row offers, flattened for rendering. `status` is the ONE word the
 * card leads with, and it is about what the authority publishes — never about
 * whether we like it.
 *
 * @returns {{status:'network'|'town'|'none', ...}}
 */
export function offerOf(row) {
  const net = row.networkMap || {};
  const town = row.townMaps || {};
  const hasNet = net.status === 'yes';
  const hasTown = town.status === 'yes' || town.status === 'some';
  const url = (hasNet && net.url) || (hasTown && town.url) || row.landingPage || '';
  return {
    authority: row.lta,
    status: hasNet ? 'network' : hasTown ? 'town' : 'none',
    url,
    format: hasNet ? net.format || '' : '',
    dated: hasNet ? net.dated || '' : '',
    towns: hasTown ? (town.examples || []).slice(0, 5) : [],
    townsMore: hasTown && town.status === 'some',
    landingPage: row.landingPage || '',
    checked: row.checked || '',
    // Somebody ELSE's map for part of this area. It travels with every row,
    // status 'none' included — in fact especially then, because a row that says
    // only "publishes nothing" is the one a reader is most likely to be wrongly
    // discouraged by. York is the case that put this field here.
    also: (row.alsoPublished || []).map((a) => ({
      publisher: a.publisher || '',
      covers: a.covers || '',
      what: a.what || '',
      url: a.url || '',
      checked: a.checked || row.checked || '',
    })),
  };
}

const RESULT_CAP = 3;

/**
 * Directory rows that answer a query, best first.
 *
 * A row is returned at most once however many of its terms matched, and the
 * strongest match wins — so searching "Essex" gets the authority once, not the
 * authority plus five of its towns.
 *
 * @param {string} q
 * @param {{file?: string, cap?: number}} [opts]
 * @returns {{ offer: object, reason: string }[]}
 */
export function searchDirectory(q, { file = DIRECTORY_FILE, cap = RESULT_CAP } = {}) {
  const qn = normalize(q);
  if (qn.length < 2) return [];
  const { terms } = loadDirectory(file);

  const best = new Map(); // lta -> { score, term }
  for (const term of terms) {
    const mr = matchRank(term.norm, qn);
    if (mr < 0) continue;
    const score = mr * 10 + KIND_TIEBREAK[term.kind];
    const cur = best.get(term.row.lta);
    if (!cur || score < cur.score || (score === cur.score && term.text.length < cur.term.text.length)) {
      best.set(term.row.lta, { score, term });
    }
  }

  return [...best.values()]
    .sort((a, b) => a.score - b.score || a.term.row.lta.localeCompare(b.term.row.lta, 'en'))
    .slice(0, cap)
    .map(({ term }) => ({ offer: offerOf(term.row), reason: reasonFor(term) }));
}

/** Why this row came back — the reader's words, not the index's. */
function reasonFor(term) {
  if (term.kind === 'town') return `${term.text} is in this area`;
  if (term.kind === 'area') return `${term.text} is part of this authority`;
  return 'The transport authority for this area';
}

/** How many authorities the vendored directory holds, for the honest miss line. */
export function directorySize(file = DIRECTORY_FILE) {
  return loadDirectory(file).rows.length;
}
