/*
 * enums.js — the two state enums, as data rather than as a comment.
 *
 * THE FAULT (codebase review 2026-09-01, portal-src F12). `map.status` has six
 * legal values and `map_version.review_state` five, and until now BOTH existed
 * only as a `--` comment beside the column. `schema.sql` carried 15 `REFERENCES`
 * and not one `CHECK`; the values were enforced in whichever handler happened to
 * write them, and a handler that wrote `Published` or `pubished` would be
 * accepted by the database, would fail no test, and would take the map off the
 * public site — because every public query filters on the string.
 *
 * WHY TRIGGERS AND NOT `CHECK`, WHICH IS WHAT THE PLAN ASKED FOR. SQLite cannot
 * add a constraint to an existing table; a `CHECK` means the twelve-step
 * table-rebuild, and this database has `PRAGMA foreign_keys = ON` (deliberately,
 * since 2026-08) with a CIRCULAR reference across the two tables that would need
 * rebuilding — `map.current_version_id` and `map.published_version_id` point at
 * `map_version`, and `map_version.map_id` points back at `map`. A rebuild there
 * is the one operation in this repository that drops and recreates a live table
 * with the constraint checking turned off around it, and the reward would be a
 * constraint that behaves identically to the trigger below.
 *
 * A `BEFORE INSERT`/`BEFORE UPDATE` trigger raising ABORT is:
 *   - ADDITIVE, so `docs/DEPLOY.md`'s rollback promise is untouched and
 *     `test-schema-compat.mjs` keeps meaning what it says. Older code writes the
 *     same values it always wrote and never meets the trigger.
 *   - REVERSIBLE by `DROP TRIGGER`, with no data movement at all.
 *   - VISIBLE: it is in `sqlite_master`, so `.schema` shows the rule.
 * The one thing it does NOT do is reject a value already in the table, which a
 * rebuild's CHECK would. So the migration ASKS that question separately, against
 * the real rows, and says so loudly — see `checkExistingStates` below.
 *
 * THE COMMENTS IN schema.sql ARE NOW HELD TO THIS FILE by
 * scripts/test-db-constraints.mjs. That is the point of moving them here: a
 * comment nothing reads is what the review found, and a second copy of a list is
 * only an improvement if something joins the two.
 */

/** `map.status` — where a map is in its life. */
export const MAP_STATUSES = ['requested', 'approved', 'building', 'draft', 'published', 'archived'];

/** `map_version.review_state` — where one saved version is in the P4 publish gate. */
export const REVIEW_STATES = ['draft', 'pending', 'published', 'superseded', 'rejected'];

/** Every enum this module owns, keyed by `table.column`. One place to iterate. */
export const ENUMS = {
  'map.status': MAP_STATUSES,
  'map_version.review_state': REVIEW_STATES,
};

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

/**
 * The SQL that installs (or reinstalls) the guard for one enum.
 *
 * DROP THEN CREATE, not `CREATE TRIGGER IF NOT EXISTS`: the trigger body carries
 * the value list, so adding a seventh status to the array above has to reach the
 * database. `IF NOT EXISTS` would leave the old list in place for ever on every
 * database that already had it, which is a constraint quietly enforcing the
 * previous release's rules — the exact class of silent staleness this repository
 * keeps finding.
 */
export function enumGuardSql(qualified, values) {
  const [table, column] = qualified.split('.');
  const list = values.map(quote).join(', ');
  const message = `${qualified} must be one of: ${values.join(', ')}`;
  return ['INSERT', 'UPDATE'].flatMap((op) => {
    const name = `${table}_${column}_valid_${op.toLowerCase()}`;
    return [
      `DROP TRIGGER IF EXISTS ${name}`,
      `CREATE TRIGGER ${name}
         BEFORE ${op} ON ${table}
         FOR EACH ROW WHEN NEW.${column} NOT IN (${list})
         BEGIN SELECT RAISE(ABORT, ${quote(message)}); END`,
    ];
  });
}

/** Every statement needed to install every guard, in order. */
export function allEnumGuardSql() {
  return Object.entries(ENUMS).flatMap(([q, v]) => enumGuardSql(q, v));
}

/** The trigger names this module owns — what a test looks for in sqlite_master. */
export function enumTriggerNames() {
  return Object.keys(ENUMS).flatMap((q) => {
    const [table, column] = q.split('.');
    return [`${table}_${column}_valid_insert`, `${table}_${column}_valid_update`];
  });
}
