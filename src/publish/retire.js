// Which versions of a map may be RETIRED — buses-data OA-572.
//
// Retiring a version removes its render files and stamps `map_version.retired_at`;
// the row stays. That is Peter's ruling of 2026-10-10 ("retire, not erase"), and it
// is what keeps three things true that a DELETE would break: `nextVersion()` still
// counts the row, so a number is never handed out twice; the `publish_request` that
// carried its red-team sign-off still has a version to point at; and
// `dataChangesSince()` still walks the refresh it recorded. The design and the
// implications it rests on are buses-data
// `Development Docs/deleting-published-map-versions_2026-10-06.md`.
//
// ONE RULE, IN ONE PLACE, AND PURE. scripts/prune-versions.mjs uses it today; the
// admin and editor buttons (step 2) and the managed-customer retention job (step 3)
// are to call this same function, so the answer to "may this go?" cannot differ
// between the three. It reads no database and no disk — the caller gathers the
// facts — so it is tested the way chooseRevertTarget() is, away from HTTP.
//
// THE RULE.
//   Never retirable, whoever asks:
//     - the working head (`map.current_version_id`) — the editor is showing it;
//     - the published version (`map.published_version_id`) — the public site serves it;
//     - the revert target — the newest earlier publication still on disk, which is
//       what `POST /maps/:id/revert` would serve on the day a publish goes wrong;
//     - the highest-numbered version — belt and braces for nextVersion(), which
//       counts rows and not files, but which a future "skip retired" filter must
//       never be allowed to turn into a reused number;
//     - a version with an OPEN (`pending`) publish request — a reviewer is reading it;
//     - one of the newest `keep` versions, when the caller asks to keep some.
//   Of the rest:
//     - a version that was NEVER published (a draft, a rejected one, one that was
//       simply overtaken) is retirable by an editor or an admin;
//     - a version that WAS published and has since been superseded is retirable by
//       an admin only, with a written reason, because published renders are served
//       from an immutable URL with a one-year cache: a link or an embed of it will
//       404 and a browser that holds it will go on showing it.
//   A pending `proposed_update` points at no version (only an ACCEPTED one sets
//   `accepted_version_id`), so it protects nothing here.

/** "Was this version ever the public one?" — any one of four facts says yes. */
export function everPublished(v, { publishedVersionId = null, approvedVersionIds = [] } = {}) {
  return v.reviewState === 'published'
    || v.reviewState === 'superseded'               // only ever set on the version a publish replaced
    || v.id === publishedVersionId
    || approvedVersionIds.includes(v.id);           // publication history (review.js approves through this)
}

/**
 * Classify every version of one map.
 *
 * @param {object} facts
 * @param {Array<{id:number, major:number, minor:number, storageKey:string, reviewState:string, retiredAt?:string|null}>} facts.versions
 * @param {number|null} facts.currentVersionId    map.current_version_id
 * @param {number|null} facts.publishedVersionId  map.published_version_id
 * @param {number[]} [facts.publishedOrder]       version ids, newest publication first (listPublishedHistory order)
 * @param {number[]} [facts.openRequestVersionIds] version ids with a `pending` publish_request
 * @param {number} [facts.keep]                   keep the newest N live versions as well
 * @returns {Array<{id:number, version:string, verdict:'keep'|'retirable'|'retired', adminOnly:boolean, why:string}>}
 *          newest first. `adminOnly` is meaningful only when verdict is 'retirable'.
 */
export function classifyVersions({
  versions, currentVersionId = null, publishedVersionId = null,
  publishedOrder = [], openRequestVersionIds = [], keep = 0,
} = {}) {
  const rows = (Array.isArray(versions) ? versions : [])
    .slice()
    .sort((a, b) => (b.major - a.major) || (b.minor - a.minor));
  const keepN = Math.max(0, Math.floor(Number(keep) || 0));
  const byId = new Map(rows.map((v) => [v.id, v]));

  // The revert target as review.js would choose it: the newest earlier publication
  // that is not the live one and has not already been retired.
  const revertTargetId = (publishedOrder || [])
    .find((id) => id !== publishedVersionId && byId.has(id) && !byId.get(id).retiredAt) ?? null;
  const highestId = rows.length ? rows[0].id : null;
  const newestLive = rows.filter((v) => !v.retiredAt).slice(0, keepN).map((v) => v.id);

  return rows.map((v) => {
    const out = (verdict, why, adminOnly = false) => ({ id: v.id, version: v.storageKey, verdict, adminOnly, why });
    if (v.retiredAt) return out('retired', `already retired ${v.retiredAt}`);
    if (v.id === publishedVersionId) return out('keep', 'the published version — the public site serves it');
    if (v.id === currentVersionId) return out('keep', 'the working head — the editor shows it');
    if (v.id === revertTargetId) return out('keep', 'the revert target — what a rollback would serve');
    if (v.id === highestId) return out('keep', 'the highest number — the next version is numbered from it');
    if (openRequestVersionIds.includes(v.id)) return out('keep', 'a publish request for it is awaiting review');
    if (newestLive.includes(v.id)) return out('keep', `one of the newest ${keepN} kept by --keep`);
    if (everPublished(v, { publishedVersionId, approvedVersionIds: publishedOrder })) {
      return out('retirable', 'once published, since superseded — an admin only, with a reason (its URL will 404)', true);
    }
    return out('retirable', `never published (${v.reviewState})`);
  });
}
