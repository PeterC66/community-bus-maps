/*
 * dates.js — one place that knows how this database spells a timestamp.
 *
 * THE FAULT (codebase review 2026-09-01, portal-src F11). Every timestamp column
 * is written by SQLite's `datetime('now')`, which produces `2026-09-03 01:23:45`
 * — a space, and no timezone marker, though the value IS UTC. Everything that
 * reads one wants an ISO instant, so the conversion was hand-written at NINE
 * sites in five files, and only ONE of them (`worklist/index.js`) guarded the
 * shape before converting. The other eight would quietly produce an Invalid Date
 * for any value that was not exactly what they expected, and an Invalid Date in
 * this codebase renders as an empty string rather than as an error.
 *
 * WHY THE STORED FORMAT IS NOT BEING CHANGED, which is what the review's plan
 * first proposed. Two measurements, both taken before this file was written:
 *
 *   1. IT WOULD BREAK THE DOCUMENTED ROLLBACK. docs/DEPLOY.md promises that
 *      rolling back to the previous release is safe, and scripts/test-schema-compat.mjs
 *      exists to hold that promise: migrations are additive columns, and older
 *      code's `SELECT *` tolerates one it does not know. A CHANGED VALUE is not
 *      additive. Rolled-back code runs `String(v).replace(' ', 'T') + 'Z'` — on
 *      an already-ISO `2026-09-03T01:23:45Z` that yields `...ZZ`, and
 *      `new Date()` of it is **Invalid Date**. Measured, not reasoned: every
 *      date on every screen would go blank after a rollback.
 *
 *   2. ANY MIXED STATE ORDERS WRONGLY, and a migration that fails part-way
 *      through leaves exactly that. `T` is 0x54 and a space is 0x20, so in a
 *      plain string comparison — which is what SQLite does to TEXT and what every
 *      `ORDER BY created_at` here relies on — `'2026-09-03 23:00:00'` (11pm, old
 *      form) sorts BEFORE `'2026-09-03T01:00:00Z'` (1am, new form). The
 *      inversion is silent and it is in the direction that puts the newest row
 *      at the bottom of a list somebody is reading to find out what just
 *      happened.
 *
 * So the duplication is what gets fixed, not the storage. One reader, one writer,
 * both tolerant, and the nine copies go. If the storage format is ever worth
 * changing, it is a release with no rollback path and its own plan — not a line
 * inside a consistency tidy-up.
 */

/** What goes in an INSERT/UPDATE. The one spelling, so a new column cannot pick
 *  a different one by accident. It is a SQL fragment rather than a JS value
 *  because the clock that matters is the database's, not the app process's. */
export const NOW_SQL = "datetime('now')";

/**
 * A stored timestamp as a Date, or null.
 *
 * TOLERANT OF BOTH SHAPES ON PURPOSE, and this is not defensive padding: the
 * database already holds both. `datetime('now')` writes the space form; a few
 * columns are written from JS with `toISOString()`; and a rollback or a restored
 * backup can put either in front of this function. The guard is the one
 * `worklist/index.js` already had and the other eight sites lacked.
 */
export function parseDbDate(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  // `YYYY-MM-DD HH:MM:SS[.sss]` — SQLite's datetime(), which is UTC without saying so.
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)
    ? new Date(`${s.replace(' ', 'T')}Z`)
    : new Date(s);              // already ISO, with or without a Z
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A stored timestamp as an ISO string, or null. What most callers actually want. */
export function dbDateToIso(v) {
  const d = parseDbDate(v);
  return d ? d.toISOString() : null;
}

/** A stored timestamp as epoch milliseconds, or NaN — for arithmetic and comparison. */
export function dbDateMs(v) {
  const d = parseDbDate(v);
  return d ? d.getTime() : NaN;
}
