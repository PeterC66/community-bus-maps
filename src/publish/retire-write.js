// The WRITE half of retiring a version — buses-data OA-572 step 1, lifted out of
// scripts/prune-versions.mjs by OA-622 so the CLI and the admin button cannot
// drift. src/publish/retire.js decides what MAY go and reads nothing; this file
// gathers the facts that rule needs and performs one retirement, and it is the
// only place that does either. The managed-customer retention job (OA-623) is to
// call it too, rather than grow a third copy.

import { existsSync, rmSync } from 'node:fs';
import { db, listVersionsForRetire, listPublishedHistory, markVersionRetired, recordAudit } from '../db/index.js';
import { versionDir } from '../maps/store.js';

/** The facts classifyVersions() needs for one map, gathered here so the rule itself reads nothing. */
export function retireFactsFor(map, { keep = 0 } = {}) {
  const versions = listVersionsForRetire(map.id).map((v) => ({
    id: v.id, major: v.major, minor: v.minor, storageKey: v.storage_key,
    reviewState: v.review_state, retiredAt: v.retired_at || null,
  }));
  const publishedOrder = listPublishedHistory(map.id).map((h) => h.version_id);
  const openRequestVersionIds = db.prepare(
    "SELECT version_id FROM publish_request WHERE map_id = ? AND status = 'pending'",
  ).all(map.id).map((r) => r.version_id);
  return {
    versions, publishedOrder, openRequestVersionIds, keep,
    currentVersionId: map.current_version_id ?? null,
    publishedVersionId: map.published_version_id ?? null,
  };
}

/**
 * Retire ONE version the rule has already called retirable: stamp the row, remove
 * its render folder, write one `version.retire` audit row. Throws if a write fails,
 * so the caller decides what a failure means (the CLI counts it; a route answers 500).
 *
 * @param {object} p
 * @param {{id:number}} p.map
 * @param {{id:number, version:string, why:string, adminOnly:boolean}} p.verdict  a row from classifyVersions()
 * @param {{id?:number|null, email:string}} p.actor   who asked: a signed-in user, or `cli:prune-versions`
 * @param {string|null} [p.reason]   required by the callers for a once-published version
 * @param {number} [p.keep]          recorded so the audit row says what was being kept
 * @param {string} p.via             'cli' | 'admin-button' — which door it came through
 * @returns {{retired:boolean, filesRemoved:boolean}}  retired:false when someone else retired it meanwhile
 */
export function retireVersion({ map, verdict, actor, reason = null, keep = 0, via }) {
  // Stamp FIRST, then remove the files. The other order can leave a LIVE row
  // whose files are gone, which the editor would list and fail to show; this
  // order can at worst leave a retired row with files still on disk.
  if (!markVersionRetired(verdict.id)) return { retired: false, filesRemoved: false };
  const dir = versionDir(map.id, verdict.version);
  const hadFiles = existsSync(dir);
  if (hadFiles) rmSync(dir, { recursive: true, force: true });
  recordAudit({
    actorId: actor.id ?? null,
    actorEmail: actor.email,
    action: 'version.retire',
    mapId: map.id,
    versionId: verdict.id,
    detail: {
      version: verdict.version, why: verdict.why, oncePublished: verdict.adminOnly,
      reason: reason || null, keep, filesRemoved: hadFiles, via,
    },
  });
  return { retired: true, filesRemoved: hadFiles };
}
