// Which backup snapshots survive, and which are pruned.
//
// Split out of scripts/backup.mjs so it can be tested without taking a backup
// (scripts/test-backup-retention.mjs). backup.mjs is a top-level script that
// does its work on import, so nothing can import a function out of it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT JUST "KEEP THE NEWEST N FOLDERS" (incident 2026-08-28)
//
// It was, until this file existed: `--keep 14` sliced the sorted list at 14 and
// deleted the tail. docs/DEPLOY.md described that as "14 days on the VPS", and
// the GDPR erasure procedure in §7 computes the date a person's data actually
// leaves the estate from that number.
//
// Fourteen folders is fourteen days only if nothing but the nightly cron ever
// writes one. Plenty else does: `npm run deploy` takes one before every release,
// and so does anybody running `docker compose run --rm backup` by hand before a
// risky change. On 2026-08-27 that happened a dozen times in a working day, and
// by the following morning the host's ENTIRE retention window was 25 hours —
// 2026-08-27T12-48-05 through 2026-08-28T13-29-23. The fortnight of nightlies
// the document promised was gone, and a snapshot that a laptop-side pull had
// truncated could no longer be re-fetched from anywhere because the host had
// already dropped it.
//
// So retention is now by AGE, which is what the documents always claimed, with
// two guards that keep it bounded and safe:
//
//   • every snapshot from the last `keepRecentHours` is kept, so the run you
//     took right before a deploy is still there while the deploy is being
//     judged;
//   • beyond that window only the NEWEST snapshot of each UTC day is kept, so a
//     burst of manual backups costs one day of history rather than a fortnight
//     of it — this is what bounds disk use, and it is the whole fix;
//   • the newest `keepAll` snapshots are kept whatever their age, so if the
//     nightly cron dies for a month an age rule cannot quietly empty the
//     backups directory at exactly the moment it is the only copy left.
//
// The laptop-side mirror in community-bus-maps-ops/pull-backups.ps1 has had the
// same age-plus-floor shape since 2026-08-25; this brings the host into line
// with it.
// ---------------------------------------------------------------------------

export const SNAPSHOT_NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/;

// Snapshot folders are named 2026-08-28T03-15-02 — ISO 8601 UTC with '-' where
// the time would have ':'. Parse the NAME: a folder's mtime changes when it is
// copied or synced, without a new backup existing.
export function parseSnapshotTime(name) {
  const m = SNAPSHOT_NAME.exec(name);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Decide what to keep and what to prune.
 *
 * @param {string[]} names            Directory names found in the backups root.
 * @param {object}   opts
 * @param {Date}     opts.now         Reference time (injected so this is testable).
 * @param {number}   opts.keepDays    Age window, in days. Older than this is prunable.
 * @param {number}   opts.keepAll     Newest N kept regardless of age — the floor.
 * @param {number}   opts.keepRecentHours  Everything newer than this is kept, thinned or not.
 * @returns {{keep: string[], prune: string[], ignored: string[]}} names, newest first.
 */
export function planRetention(names, { now, keepDays, keepAll = 7, keepRecentHours = 48 }) {
  const ignored = names.filter((n) => !SNAPSHOT_NAME.test(n));
  // Newest first, which is also the order the floor is counted in.
  const dated = names.filter((n) => SNAPSHOT_NAME.test(n)).sort().reverse();

  const ageCutoff = now.getTime() - keepDays * 86400000;
  const recentCutoff = now.getTime() - keepRecentHours * 3600000;

  const keep = [];
  const prune = [];
  const dayHasKeeper = new Set();

  for (const [i, name] of dated.entries()) {
    const t = parseSnapshotTime(name).getTime();
    const day = name.slice(0, 10); // the UTC date, straight off the name

    // The floor comes first and answers to nothing else.
    if (i < keepAll) { keep.push(name); dayHasKeeper.add(day); continue; }

    if (t >= recentCutoff) { keep.push(name); dayHasKeeper.add(day); continue; }

    if (t < ageCutoff) { prune.push(name); continue; }

    // Within the window but past the recent hours: one per day, the newest.
    // `dated` is newest-first, so the first one seen for a day is that day's.
    if (dayHasKeeper.has(day)) { prune.push(name); continue; }
    dayHasKeeper.add(day);
    keep.push(name);
  }

  return { keep, prune, ignored };
}
