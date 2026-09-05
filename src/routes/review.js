// The review & publish gate (P4), as a Fastify plugin (OA-231, codebase review Tier 4.4).
//
// Approvers and admins review a submitted version and publish it. The customer
// who edits never publishes -- that separation of duties is the whole point of
// the section -- so publishing requires a completed review checklist, records
// the change-summary evidence, advances the map's public-current pointer, and
// writes the audit trail. Eight routes, registered under the prefix /api/review
// by src/server.js. The handlers are the ones server.js carried until
// 2026-09-02, moved verbatim: the only edit inside them is that each no longer
// opens with its own requireApprover() call.
//
// ONE GUARD, NOT EIGHT. Every route here is approver-or-admin, and each said so
// for itself. The preHandler below runs before every handler registered in this
// plugin, so a route cannot be added here without it -- the same move the admin
// console made, for the same finding (portal-src F8).
//
// THE SUBSTITUTION IS EXACT, NOT MERELY EQUIVALENT. requireApprover() RETURNS
// req.user on success, so `const user = req.user` in a handler that the hook has
// already admitted is the same value the call produced, not a second lookup that
// happens to agree. Nothing else in the handler bodies changed.
//
// scripts/test-review-plugin.mjs enumerates the live route table and asserts the
// door on every route under /api/review/, so the ninth is checked like the first.

import { clearMapBannerNote, dataChangesSince, decidePublishRequest, getMap, getOpenRequestForMap, getPublicMapBySlug, getPublishRequest, getVersionById, listPendingPublishRequests, listPublishedMaps, setMapStatus, setPublishedVersion, setVersionState } from '../db/index.js';
import { mapPageUrl } from '../public/index.js';
import { factsForPublicMap, publicServices } from '../public/services.js';
import { buildFacts, readFactsSnapshot } from '../maps/facts.js';
import { readRoutesMeta } from '../maps/engine.js';
import { mapDataDir, readBuildWarnings, readComplexity, versionDir } from '../maps/store.js';
import { STEP_UP_MINUTES, stepUpFresh } from '../auth/index.js';
import { CHECKLIST, CHECKLIST_VERSION, changeSummary, chooseRevertTarget, validateChecklist } from '../publish/index.js';
import { logAudit } from '../audit/index.js';
import { writePlacesSidecar } from '../search/place-index.js';
import { bumpSearchIndex } from '../search/index.js';
import { downloadsForVersion, publishedHistoryFor } from '../maps/detail.js';
import { notify, appUrl } from '../email/notify.js';
import { parseJson, requireApprover, requireStepUp, stepUpDeadline, str } from '../http/helpers.js';
import { allowSelfApproval } from '../config.js';

export default async function reviewRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (!requireApprover(req, reply)) return reply;
  });

  app.get('/queue', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    return { ok: true, requests: listPendingPublishRequests(), checklist: CHECKLIST };
  });

  app.get('/:id', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const pr = getPublishRequest(Number(req.params.id));
    if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
    const meta = readRoutesMeta(pr.map_id);
    const pub = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
    const summary = changeSummary(
      parseJson(pr.version_overrides), parseJson(pub ? pub.overrides_json : '{}'),
      {
        palette: meta.palette, hasBaseline: !!pub,
        // Bounded at the SUBMITTED version, so the reviewer reads what they are
        // signing off and not anything saved after it (findings A1).
        dataChanges: dataChangesSince(pr.map_id, pr.published_version_id, pr.version_id),
      },
    );
    const decided = pr.status !== 'pending';
    return {
      ok: true,
      request: {
        id: pr.id, status: pr.status, createdAt: pr.created_at, note: pr.note || '',
        map: { id: pr.map_id, name: pr.map_name, slug: pr.map_slug, kind: pr.map_kind, subject: pr.map_subject },
        customer: pr.customer_id ? { id: pr.customer_id, name: pr.customer_name } : null,
        version: pr.version_key, versionNote: pr.version_note || '',
        publishedVersion: pub ? pub.storage_key : null,
        requestedBy: pr.requested_by_email || null,
        // Told to the review screen so an approver sees, BEFORE ticking anything,
        // that they are about to sign off their own submission — and whether the
        // server will let them (technical-audit_2026-08-19 S6). Sending both flags
        // rather than one lets the UI say which of the two situations it is.
        selfReview: pr.requested_by != null && Number(pr.requested_by) === Number(user.id),
        selfApprovalAllowed: ALLOW_SELF_APPROVAL,
        // Step-up belongs in that same "before ticking anything" set, and was missing
        // from it. Publishing needs a sign-in from the last STEP_UP_MINUTES, and the
        // only thing that ever said so was the 403 from the Publish button — raised
        // after the approver had opened every sheet and ticked the checklist, which is
        // the entire cost of a review. Reported from the operator's seat 2026-08-22.
        // A DEADLINE rather than a boolean, deliberately: step-up is anchored on the
        // session's CREATION and the sliding window never moves it, so the freshness
        // can expire *during* a review. A flag captured at page load would go quietly
        // stale exactly when it mattered; an absolute time stays true.
        stepUpFresh: stepUpFresh(user),
        stepUpExpiresAt: stepUpDeadline(user),
        stepUpMinutes: STEP_UP_MINUTES,
        reviewedBy: pr.reviewed_by_email || null, reviewedAt: pr.reviewed_at || null,
        decisionNote: pr.decision_note || '',
        evidence: decided ? parseJson(pr.evidence_json) : null,
      },
      changeSummary: summary,
      checklist: CHECKLIST,
      // Files to eyeball before signing off (approver read-access is enforced above).
      inspect: downloadsForVersion(pr.map_id, pr.version_key),
      // WHAT THE ENGINE THOUGHT OF THIS BUILD (OA-046).
      //
      // The bus skill writes build-warnings.txt beside every run and, until
      // 2026-08-30, nothing downstream read it: 161 of them on the map tree, zero
      // mentions of the name anywhere in this repository. So the one place a
      // human has already agreed to look at a sheet — this screen — was the one
      // place the engine’s own verdict on it never reached.
      //
      // It is carried with the delivery rather than re-derived. Re-running the
      // guards here would give TODAY’S engine’s opinion of an older pack, and the
      // severity contract itself widened on 2026-08-28; what an approver needs is
      // the verdict the sheet actually shipped under. A pack that carries no file
      // reports null, never a zero — see readBuildWarnings().
      buildWarnings: readBuildWarnings(mapDataDir(pr.map_id)),
      // AND WHAT THE GATE THOUGHT OF THE TOWN (buses-data OA-088). The end-of-S2
      // complexity band has ridden with every area delivery and been read by
      // nothing here; RED is the pipeline's one "do not build the standard
      // sheet" verdict, and a published RED town existed before this screen
      // could say so. A place pack carries none — null is its ordinary answer,
      // not a gap, and the screen tells the two apart by the map's kind.
      complexity: readComplexity(mapDataDir(pr.map_id)),
      town: meta.town,
    };
  });

  // Checklist item `alternative` asks the approver to open the map's text
  // alternative and check it — but the map may not be published yet (a first
  // submission has no public page at all), and even when it is, the PUBLIC
  // /m/:slug/services route serves the PUBLISHED version's facts, not the one
  // under review. So this builds the SUBMITTED version's own facts straight
  // from its render folder, same read as factsForPublicMap() but keyed off the
  // pending version rather than the published pointer — the approver always
  // previews exactly what they are about to sign off, whether or not anything
  // has ever been published before.
  app.get('/:id/services', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const pr = getPublishRequest(Number(req.params.id));
    if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
    const dir = versionDir(pr.map_id, pr.version_key);
    const facts = readFactsSnapshot(dir) || buildFacts(mapDataDir(pr.map_id), { kind: pr.map_kind });
    const services = publicServices({ subject: pr.map_subject, name: pr.map_name }, facts);
    if (!services) return reply.code(404).send({ ok: false, error: 'This version has no service list.' });
    return {
      ok: true,
      map: { name: pr.map_name, kind: pr.map_kind, version: pr.version_key },
      services,
    };
  });

  // SEPARATION OF DUTIES, ENFORCED (technical-audit_2026-08-19 S6).
  //
  // README.md and src/publish/index.js have said since P4 that "the editor who
  // makes a change never publishes it — that's a deliberate separation of
  // duties". Until 2026-08-20 the code did not implement it: approve checked the
  // role, the request's existence, its pending status and the checklist, and
  // never once compared pr.requested_by to the approving user. Every one of the
  // 41 publications to date was self-approved, on a deployment with two users.
  // That is fine for a pilot; documenting a control that does not exist is not,
  // and it is precisely what a reviewer tests.
  //
  // So: refuse a self-approval, unless ALLOW_SELF_APPROVAL is explicitly set, and
  // when it is, RECORD that the publication was self-approved in the decision
  // evidence, the audit row and the API response. The override is not a way of
  // switching the rule off quietly; it is a way of being honest that a
  // one-operator pilot has no second pair of eyes, in a form that shows up
  // afterwards in the audit trail rather than only in someone's memory.
  //
  // WHEN TO TURN IT OFF: as soon as a second person holds `approver`. Until then
  // leaving it unset would simply stop Peter publishing anything, which is a
  // worse outcome than a recorded self-approval — see docs/R3-review-and-publish.md.
  const ALLOW_SELF_APPROVAL = allowSelfApproval();

  app.post('/:id/approve', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const pr = getPublishRequest(Number(req.params.id));
    if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
    if (pr.status !== 'pending') return reply.code(409).send({ ok: false, error: `This request was already ${pr.status}.` });

    // Self-approval BEFORE step-up, deliberately. Step-up says "not right now";
    // self-approval says "not by you, ever, on this request". Telling someone to
    // go and re-authenticate before telling them the action was never theirs to
    // take wastes a round trip and teaches the wrong lesson.
    const selfApproval = pr.requested_by != null && Number(pr.requested_by) === Number(user.id);
    if (selfApproval && !ALLOW_SELF_APPROVAL) {
      req.log.warn({ requestId: pr.id, mapId: pr.map_id, by: user.email }, 'self-approval refused');
      return reply.code(409).send({
        ok: false,
        error: 'You submitted this version, so you cannot approve it. Ask another approver to review it.',
        code: 'self-approval',
      });
    }

    if (!requireStepUp(req, reply, 'publishing a version')) return;

    // The review gate: every checklist item must be confirmed. No exceptions —
    // it is public transit information people rely on.
    const { ok, missing, checklist } = validateChecklist((req.body || {}).checklist);
    if (!ok) return reply.code(400).send({ ok: false, error: 'Please confirm every item on the review checklist before publishing.', missing });

    const meta = readRoutesMeta(pr.map_id);
    const pub = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
    const summary = changeSummary(
      parseJson(pr.version_overrides), parseJson(pub ? pub.overrides_json : '{}'),
      {
        palette: meta.palette, hasBaseline: !!pub,
        // Bounded at the SUBMITTED version, so the reviewer reads what they are
        // signing off and not anything saved after it (findings A1).
        dataChanges: dataChangesSince(pr.map_id, pr.published_version_id, pr.version_id),
      },
    );
    const decisionNote = str((req.body || {}).note, 2000);
    const complexity = readComplexity(mapDataDir(pr.map_id));
    const evidence = {
      checklistVersion: CHECKLIST_VERSION, checklist, changeSummary: summary, decidedAt: new Date().toISOString(),
      // The band the town was scored at when this pack was built, so the decision
      // record says what the approver was told (OA-088). Absent when the pack
      // carries none, which every place pack and every pre-gate area pack does.
      ...(complexity ? { complexity: { band: complexity.band, failed: complexity.failed, scoredAt: complexity.scoredAt } } : {}),
      // Present and true only when the approver is the submitter and the operator
      // override allowed it. Absent on a genuine two-person review, so a later
      // reader can tell the two apart without inferring it from user ids.
      ...(selfApproval ? { selfApproved: true } : {}),
    };

    decidePublishRequest(pr.id, { status: 'approved', reviewedBy: user.id, decisionNote, evidence });
    // Advance the public-current pointer; retire the previous published version.
    if (pr.published_version_id && pr.published_version_id !== pr.version_id) setVersionState(pr.published_version_id, 'superseded');
    setVersionState(pr.version_id, 'published');
    setPublishedVersion(pr.map_id, pr.version_id);
    setMapStatus(pr.map_id, 'published');
    // The newly-published data is presumed to reflect any change the banner warned
    // about — clear it. (If it still applies, the GTFS scan or an admin re-sets it.)
    clearMapBannerNote(pr.map_id);
    // P9 — index the place names this version actually shows, from the live data
    // dir at this exact moment (never re-read later, so it can't drift ahead of
    // what was reviewed). See src/search/place-index.js.
    const mapRow = getMap(pr.map_id);
    writePlacesSidecar(pr.map_id, pr.version_key, { kind: mapRow.kind, subject: mapRow.subject });
    bumpSearchIndex();

    req.log.info({ mapId: pr.map_id, requestId: pr.id, version: pr.version_key, by: user.email }, 'version published');
    logAudit(req, 'version.publish', { mapId: pr.map_id, versionId: pr.version_id, detail: { requestId: pr.id, version: pr.version_key, changeSummary: summary, note: decisionNote, ...(selfApproval ? { selfApproved: true } : {}) } });
    // Tell the people whose map it is (findings B2). Deliberately after every
    // state change and the audit row: the publication has happened whether or not
    // the email does, and notify() never throws.
    //
    // suppressNotify: true skips this one call — the ONLY caller is the laptop
    // batch script (scripts/accept-publish-batch.mjs), which collects every map
    // it publishes in a run and asks for one grouped digest per customer via
    // POST /api/admin/notify-published-batch instead, so a 12-map round sends
    // one email per customer, not twelve. The interactive review screen never
    // sends this flag, so a human approving one map through the UI is unaffected.
    if ((req.body || {}).suppressNotify !== true) {
      notify('published', {
        customerId: pr.customer_id, log: req.log,
        mapName: pr.map_name, versionKey: pr.version_key,
        mapUrl: appUrl(`/app/maps/${pr.map_id}`),
        publicUrl: mapRow.public_listed && getPublicMapBySlug(mapRow.slug) ? appUrl(mapPageUrl(mapRow.slug)) : null,
      });
    }
    return {
      ok: true, publishedVersion: pr.version_key, downloads: downloadsForVersion(pr.map_id, pr.version_key),
      customerId: pr.customer_id,
      publicUrl: mapRow.public_listed && getPublicMapBySlug(mapRow.slug) ? appUrl(mapPageUrl(mapRow.slug)) : null,
      ...(selfApproval ? { selfApproved: true } : {}),
    };
  });

  app.post('/:id/reject', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const pr = getPublishRequest(Number(req.params.id));
    if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
    if (pr.status !== 'pending') return reply.code(409).send({ ok: false, error: `This request was already ${pr.status}.` });
    const note = str((req.body || {}).note, 2000);
    if (!note) return reply.code(400).send({ ok: false, error: 'Please give a reason so the editor knows what to change.', fields: ['note'] });

    decidePublishRequest(pr.id, { status: 'rejected', reviewedBy: user.id, decisionNote: note, evidence: {} });
    // Return the version to draft (unless it somehow is the published one) so the editor can revise + resubmit.
    if (pr.version_id !== pr.published_version_id) setVersionState(pr.version_id, 'rejected');
    req.log.info({ mapId: pr.map_id, requestId: pr.id, by: user.email }, 'publication rejected');
    logAudit(req, 'version.reject', { mapId: pr.map_id, versionId: pr.version_id, detail: { requestId: pr.id, version: pr.version_key, note } });
    // The one state change the customer has no other way of learning about: their
    // map simply becomes editable again (findings B2).
    const publishedNow = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
    notify('sent-back', {
      customerId: pr.customer_id, log: req.log,
      mapName: pr.map_name, versionKey: pr.version_key, reason: note,
      publishedVersion: publishedNow ? publishedNow.storage_key : null,
      mapUrl: appUrl(`/app/maps/${pr.map_id}`),
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Rollback (incident response). When a published version turns out to be wrong,
  // the fast mitigation is un-listing it, but the FIX is serving a known-good
  // version again. These two routes make that one click for an approver instead of
  // a re-run through the whole gate:
  //
  //   GET  /api/review/published                → maps with a published version
  //   GET  /api/review/maps/:id/published-history → the versions ever published
  //   POST /api/review/maps/:id/revert           → move the pointer back to one
  //
  // It is deliberately NOT a general "publish anything" button: the only versions
  // on offer are ones an approver already reviewed (they have an approved
  // publish_request), and whose rendered files are still on disk. So reverting can
  // never serve bytes that never passed the gate. A reason is required and the whole
  // thing is audited.
  // ---------------------------------------------------------------------------

  app.get('/published', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const maps = listPublishedMaps().map((m) => ({
      id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
      customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
      customerSuspended: m.customer_status === 'suspended',
      publishedVersion: m.pub_key, publishedVersions: m.published_versions,
      // A revert needs somewhere to go back TO — flag the maps where one is possible.
      canRevert: m.published_versions > 1,
      publicListed: !!m.public_listed,
      publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
    }));
    return { ok: true, maps };
  });

  app.get('/maps/:id/published-history', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const m = getMap(Number(req.params.id));
    if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
    const history = publishedHistoryFor(m);
    return {
      ok: true,
      map: {
        id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
        customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
        publishedVersion: m.pub_key || null, currentVersion: m.cur_key || null,
        publicListed: !!m.public_listed,
        publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
      },
      history,
    };
  });

  app.post('/maps/:id/revert', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const m = getMap(Number(req.params.id));
    if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
    if (!m.published_version_id) {
      return reply.code(409).send({ ok: false, error: 'This map has no published version, so there is nothing to revert.' });
    }
    const b = req.body || {};
    const reason = str(b.reason, 2000);
    if (!reason) {
      return reply.code(400).send({ ok: false, error: 'Please record why you are reverting — it goes in the audit trail and the incident log.', fields: ['reason'] });
    }
    // An open publish request would leave an approver reviewing a version while the
    // pointer moves under them; make the order explicit rather than racing it.
    const open = getOpenRequestForMap(m.id);
    if (open) {
      return reply.code(409).send({ ok: false, error: 'A version of this map is awaiting review. Decide that request first, then revert.' });
    }

    // Which version to serve again (default: the one published before this). The
    // rules live in src/publish so they are unit-tested away from HTTP.
    const chosen = chooseRevertTarget(publishedHistoryFor(m), b.versionId != null ? Number(b.versionId) : null);
    if (chosen.error) return reply.code(chosen.code).send({ ok: false, error: chosen.error });
    const target = chosen.target;

    const from = getVersionById(m.published_version_id);
    // Move the public-current pointer back. The editor's working head is untouched:
    // reverting is about what the public is served, not about undoing their edits.
    setVersionState(m.published_version_id, 'superseded');
    setVersionState(target.versionId, 'published');
    setPublishedVersion(m.id, target.versionId);
    setMapStatus(m.id, 'published');
    bumpSearchIndex(); // P9 — the reverted-to version has its own places.json from when it was published

    req.log.warn({ mapId: m.id, from: from ? from.storage_key : null, to: target.version, by: user.email }, 'published version reverted');
    logAudit(req, 'version.revert', {
      mapId: m.id, versionId: target.versionId,
      detail: {
        from: from ? from.storage_key : null, to: target.version,
        reason, publishedAt: target.publishedAt, approver: target.approver,
        stillListed: !!m.public_listed,
      },
    });
    return {
      ok: true,
      publishedVersion: target.version,
      revertedFrom: from ? from.storage_key : null,
      downloads: downloadsForVersion(m.id, target.version),
      publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
      publicListed: !!m.public_listed,
    };
  });
}
