/*
 * guards.js — the database rules that are not enums.
 *
 * ONE RULE SO FAR, and it is the architectural trap buses-data OA-154 named
 * before a line of the adviser seat was written: an `adviser` may hold no
 * `customer_id`.
 *
 * WHY IT IS A DATABASE RULE AND NOT A CODE ONE. `loadOwnedMap()` in
 * src/maps/detail.js reads
 *
 *     user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)
 *
 * and admits anybody it does not refuse. It never consults `role`. That is the
 * right shape for the three roles it was written for and it means the adviser
 * seat's safety rests on ONE fact holding for ever — that an adviser's
 * `customer_id` is NULL — across every route, every script, every future admin
 * form and every hand-run `UPDATE user SET ...` on the live box. A check in
 * `updateUserAdmin()` covers exactly one of those paths. This covers all of them,
 * including the ones that do not exist yet, which is the only kind of coverage
 * worth resting an access decision on.
 *
 * It is deliberately NOT a repair. A row that somehow acquires both is refused at
 * the moment of the write, loudly, rather than silently NULLed — because the
 * write is either a mistake worth seeing or an attack worth seeing, and neither
 * is improved by being tidied away.
 *
 * The mechanism, and the argument for triggers over CHECK, is ./enums.js's: SQLite
 * cannot add a constraint to an existing table, the rebuild that would be needed
 * touches a circular foreign key, and a BEFORE INSERT/UPDATE trigger raising ABORT
 * is additive, reversible by DROP TRIGGER and visible in `sqlite_master`.
 *
 * REINSTALLED ON EVERY BOOT, like the enum guards, so that a change to the words
 * or the rule reaches a database that already has the old one.
 */

/** The message a refused write carries. Asserted by scripts/test-adviser-seat.mjs. */
export const ADVISER_CUSTOMER_MESSAGE =
  'user.customer_id must be NULL when user.role is adviser — an adviser belongs to no organisation (OA-154)';

/** Every statement needed to install the guard, in order. */
export function adviserGuardSql() {
  return ['INSERT', 'UPDATE'].flatMap((op) => {
    const name = `user_adviser_no_customer_${op.toLowerCase()}`;
    return [
      `DROP TRIGGER IF EXISTS ${name}`,
      `CREATE TRIGGER ${name}
         BEFORE ${op} ON user
         FOR EACH ROW WHEN NEW.role = 'adviser' AND NEW.customer_id IS NOT NULL
         BEGIN SELECT RAISE(ABORT, '${ADVISER_CUSTOMER_MESSAGE.replace(/'/g, "''")}'); END`,
    ];
  });
}

/** The trigger names this module owns — what a test looks for in sqlite_master. */
export function adviserTriggerNames() {
  return ['user_adviser_no_customer_insert', 'user_adviser_no_customer_update'];
}
