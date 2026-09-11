// OA-308 TIER 4 — the demand signal: which places people look for and cannot find.
//
// Peter's fourth question of this action was a count for the CIC papers: how
// many people come to busmaps.uk looking for a map of somewhere, and where.
// Every one of those searches ends today in a sentence and nothing else, and
// the one piece of evidence a funder or a council actually asks for — *who
// wants this?* — is thrown away as it arrives.
//
// THIS IS NOT A SEARCH LOG, AND IT MUST NEVER BECOME ONE.
//
// The portal has a standing promise, made at P9 B8 and kept in two places:
// search queries are never written to a log. src/public/logRedaction.js drops
// the whole query string of /api/public/search and /maps? before Fastify's line
// reaches the log, and the Caddyfile does the same by parameter name at the
// proxy, because a proxy does not know routes. Neither of those lists is
// touched by this file and neither should ever be relaxed for it.
//
// What this keeps instead is a TALLY: one row per place name, a count, and the
// first and last DATE it was asked for. Not a timestamp — a date. There is no
// address, no session, no user agent, no ordering and no time of day, so there
// is nothing here to join a row to a visit, or two rows to each other. "Three
// hundred and eleven people looked for Harrogate" is the fact worth having;
// "somebody in this /24 looked for Harrogate at 21:14" is the fact we have gone
// to some trouble not to hold, and this must not quietly reintroduce it.
//
// THE SHAPE FILTER IS THE OTHER HALF, and it exists because a free-text box is
// not a place-name box. People type their own names into search boxes. They
// type email addresses, postcodes, phone numbers and whole sentences. A tally
// keyed on raw input would be a small pile of personal data accumulating
// quietly in a table nobody looks at — which is the worst way to hold any. So a
// query is recorded ONLY if it looks like a place name: letters, spaces,
// hyphens and apostrophes, at most four words, at most forty characters. A
// postcode is excluded BY the no-digits rule and not by accident: a full
// postcode identifies a household. Everything rejected is counted, with its
// text discarded — so the count of misses stays honest even though the text of
// most of them is never stored.
//
// WHAT IS RECORDED IS A SUBMITTED SEARCH, NOT A KEYSTROKE. The search box fires
// on a 300ms debounce, so a reader typing "Beaconsfield" produces a dozen
// requests and eleven of them are prefixes of a word they had not finished. A
// tally full of "bea" and "beaco" would be noise with a hundred entries and no
// signal. The API records only when the caller says the search was SUBMITTED
// (`intent=submit`, which public-maps.js sends on form submit and not on
// typing), and the server-rendered /maps?q= path records because arriving at a
// URL is itself a deliberate act.
//
// Read it with `node scripts/demand-report.mjs`.

import { db } from '../db/index.js';
import { TODAY_SQL } from '../db/dates.js';

/**
 * How many DISTINCT place names the tally will hold. Past it, an unseen name is
 * counted as skipped and an already-known one still counts up.
 *
 * It is a cap on rows rather than a rate limit on callers, because the thing
 * worth defending against here is not a fast visitor — it is one script typing
 * ten thousand different words into the box to see what happens, which would
 * leave a table nobody can read and a signal nobody can trust. A real English
 * place-name vocabulary is a few thousand words; anything beyond that is not
 * demand.
 */
export const DISTINCT_CAP = 5000;

/** The longest query that can be a place name, and the most words in one. */
export const MAX_CHARS = 40;
export const MAX_WORDS = 4;

/**
 * Whether a query may be stored, and — when it may not — why, in a word that
 * goes in a counter and never beside the text.
 *
 * @param {string} q
 * @returns {{ok: boolean, key: string, reason: string}}
 */
export function recordable(q) {
  const raw = String(q == null ? '' : q).trim().replace(/\s+/g, ' ');
  if (raw.length < 2) return { ok: false, key: '', reason: 'too short' };
  if (raw.length > MAX_CHARS) return { ok: false, key: '', reason: 'too long' };
  // Letters (including accented ones — Welsh and Cornish place names are in
  // scope even though the directory is English), spaces, hyphens, apostrophes
  // and full stops. Anything else — a digit, an @, a slash, a comma — means
  // this is not a bare place name and its text is not ours to keep.
  if (!/^[\p{L}][\p{L} '’.\-]*$/u.test(raw)) return { ok: false, key: '', reason: 'not a plain name' };
  if (raw.split(' ').length > MAX_WORDS) return { ok: false, key: '', reason: 'too many words' };
  // Lower-cased, so "york", "York" and "YORK" are one row. Casing is not signal
  // here and keeping three spellings of one place would understate every one of
  // them — and a distinctive capitalisation is one more thing a row could carry
  // about the person who typed it.
  return { ok: true, key: raw.toLowerCase(), reason: '' };
}

const insert = () => db.prepare(
  `INSERT INTO search_demand (q, n, first_seen, last_seen)
   VALUES (?, 1, ${TODAY_SQL}, ${TODAY_SQL})
   ON CONFLICT(q) DO UPDATE SET n = n + 1, last_seen = ${TODAY_SQL}`,
);
const bump = () => db.prepare(
  `INSERT INTO search_demand_skipped (id, n, last_seen) VALUES (1, 1, ${TODAY_SQL})
   ON CONFLICT(id) DO UPDATE SET n = n + 1, last_seen = ${TODAY_SQL}`,
);
const known = () => db.prepare('SELECT 1 FROM search_demand WHERE q = ?');
const distinct = () => db.prepare('SELECT COUNT(*) AS c FROM search_demand');

/**
 * Record one search that found no map of ours.
 *
 * NEVER THROWS INTO A REQUEST. This is a side effect of answering a search, and
 * a search that fails because a tally could not be written would be a page
 * broken by its own bookkeeping. A failure here is logged by the caller's own
 * error handling at most; the reader still gets their answer.
 *
 * @param {string} q what the reader searched for
 * @returns {'recorded'|'skipped'|'capped'|'error'}
 */
export function recordMiss(q) {
  const verdict = recordable(q);
  try {
    if (!verdict.ok) { bump().run(); return 'skipped'; }
    if (!known().get(verdict.key) && distinct().get().c >= DISTINCT_CAP) { bump().run(); return 'capped'; }
    insert().run(verdict.key);
    return 'recorded';
  } catch { return 'error'; }
}

/**
 * The tally, commonest first. For the CIC papers and for nothing else — there
 * is no route that serves this and there should not be one: a public list of
 * what people search for is a different thing from a private count of it.
 *
 * @param {{limit?: number}} [opts]
 */
export function demandTally({ limit = 100 } = {}) {
  const rows = db.prepare(
    'SELECT q, n, first_seen, last_seen FROM search_demand ORDER BY n DESC, q ASC LIMIT ?',
  ).all(Number(limit) || 100);
  const totals = db.prepare('SELECT COUNT(*) AS places, COALESCE(SUM(n), 0) AS searches FROM search_demand').get();
  const skipped = db.prepare('SELECT n, last_seen FROM search_demand_skipped WHERE id = 1').get();
  return {
    rows,
    places: totals.places,
    searches: totals.searches,
    skipped: skipped ? skipped.n : 0,
    skippedLast: skipped ? skipped.last_seen : null,
  };
}
