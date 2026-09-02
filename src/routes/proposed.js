// Monthly change acceptance (P5), as a Fastify plugin (OA-231, codebase review Tier 4.4).
//
// The central pipeline stages a data refresh (scripts/propose-update.mjs); the
// customer reviews an old-vs-new preview and either Accepts it -- which re-applies
// their overrides as a new MAJOR version, a draft that still goes through the P4
// publish gate -- or Declines it. Three routes, registered by src/server.js under
// the prefix /api/maps/:id/proposed/:pid. The handlers are the ones server.js
// carried until 2026-09-02, moved verbatim: the only edit inside them is that each
// no longer opens with its own requireUser() call.
//
// THE PREFIX IS PARAMETRIC, AND THAT IS THE POINT. The other candidate was a
// prefix of /api/maps with the params left in each route path -- which works, and
// would have made this file look like the owner of a namespace it holds three of
// perhaps forty routes in. The editor spine's /api/maps/* routes are still in
// server.js and are NOT governed by anything here. A prefix naming the exact
// subtree says what this plugin owns and, more usefully, what it does not.
//
// THE GUARD HERE IS THE WEAK HALF, ON PURPOSE. requireUser only establishes that
// somebody is signed in; the decision that matters is loadOwnedMap(), which admits
// the map's own customer or an admin and is per-request because it needs the map.
// That check STAYS in the handlers and must: a plugin-level hook cannot make it,
// and pretending otherwise would move an access decision somewhere it cannot see
// its own subject. What the hook removes is three copies of the cheap half, and
// what it adds is that a fourth route in this file cannot be anonymous.
//
// THE SUBSTITUTION IS EXACT, NOT MERELY EQUIVALENT: requireUser() RETURNS req.user
// on success, so `const user = req.user` in a handler the hook has already admitted
// is the same value the call produced, not a second lookup that agrees today.
//
// scripts/test-proposed-plugin.mjs asserts the door and, more importantly, that
// ownership is still enforced BEHIND it -- a signed-in stranger must not reach
// another customer's proposed update.

import { decideProposedUpdate, getOpenRequestForMap, insertVersion, nextMajorVersion, setCurrentVersion } from '../db/index.js';
import { carryExpertTuning, editablePoiKeysFromDir, preview, previewFrom, readOverrides, readRoutesMetaFromDir, renderVersion, swapInProposedData } from '../maps/engine.js';
import { sanitizeOverrides } from '../maps/safeSubset.js';
import { mapDataDir, proposedDataDir } from '../maps/store.js';
import { changeSummary } from '../publish/index.js';
import { logAudit } from '../audit/index.js';
import { loadOwnedMap, loadPendingProposed, refreshNote, safeSubsetAllow, savedPoiTiers, visibleDownloadsForVersion, withMapLock } from '../maps/detail.js';
import { parseJson, parseOutputs, requireUser, str } from '../http/helpers.js';

export default async function proposedRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (!requireUser(req, reply)) return reply;
  });

  app.post('/preview', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    const { pu, code: pcode, error: perror } = loadPendingProposed(id, Number(req.params.pid));
    if (!pu) return reply.code(pcode).send({ ok: false, error: perror });
    if (!map.cur_key) return reply.code(400).send({ ok: false, error: 'This map has no current version to compare against.' });

    const stagedDir = pu.data_dir || proposedDataDir(id, pu.id);
    const outputs = parseOutputs(map.outputs);
    const saved = readOverrides(id);
    try {
      const result = await withMapLock(id, async () => {
        // The staged payload comes from central data and carries no expert tuning;
        // lay the map's own pins on it so the "after" side is what accepting gives.
        carryExpertTuning(id, stagedDir);
        const stagedMeta = readRoutesMetaFromDir(stagedDir);
        const poiKeys = editablePoiKeysFromDir(stagedDir, savedPoiTiers(id));
        const after = sanitizeOverrides(saved, safeSubsetAllow(map, stagedMeta, poiKeys, stagedDir)); // re-apply onto proposed data
        return {
          before: previewFrom(mapDataDir(id), saved, outputs),
          after: previewFrom(stagedDir, after.overrides, outputs),
          dropped: after.rejected, // overrides the refresh made obsolete
        };
      });
      return { ok: true, ...result, summary: parseJson(pu.summary_json) };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: 'Preview render failed: ' + e.message });
    }
  });

  // Accept the refresh: render the new major version FROM the staged data first
  // (so a failure leaves the live map untouched), then swap the data in, re-apply
  // the overrides, and record the new draft head + audit. The published pointer is
  // unchanged — the new version must be reviewed (P4) before it goes public.
  app.post('/accept', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    const { pu, code: pcode, error: perror } = loadPendingProposed(id, Number(req.params.pid));
    if (!pu) return reply.code(pcode).send({ ok: false, error: perror });
    if (!map.current_version_id || !map.cur_key) {
      return reply.code(400).send({ ok: false, error: 'This map has no current version to update.' });
    }
    // Accepting moves the head — not allowed while a publication awaits review.
    if (getOpenRequestForMap(id)) {
      return reply.code(409).send({ ok: false, error: 'This map is awaiting publication review. Withdraw that request before accepting an update.' });
    }

    const stagedDir = pu.data_dir || proposedDataDir(id, pu.id);
    const outputs = parseOutputs(map.outputs);
    const saved = readOverrides(id);
    const { major, minor } = nextMajorVersion(id);
    const storageKey = `v${major}.${minor}`;
    const decisionNote = str((req.body || {}).note, 1000);
    const summary = parseJson(pu.summary_json);

    try {
      const applied = await withMapLock(id, async () => {
        // Expert hand-tuning first: the new version is rendered FROM the staged data,
        // so the pins must be in there before we render, not just after the swap.
        const carried = carryExpertTuning(id, stagedDir);
        if (carried.length) req.log.info({ mapId: id, carried }, 'carried expert tuning into the refreshed data');
        // Re-apply the customer's overrides onto the PROPOSED data (orphans dropped).
        const stagedMeta = readRoutesMetaFromDir(stagedDir);
        const poiKeys = editablePoiKeysFromDir(stagedDir, savedPoiTiers(id));
        const reapplied = sanitizeOverrides(saved, safeSubsetAllow(map, stagedMeta, poiKeys, stagedDir));
        // Render from the staged data BEFORE committing the swap.
        const rend = await renderVersion(id, reapplied.overrides, storageKey, outputs, stagedDir);
        // Render OK → make the staged data the live data (old data archived).
        // What the swap carried forward from the archive is worth a line: the list is
        // how the expert's pins and the pack's engine-source declaration survive a
        // refresh, and a declaration it deliberately REFUSED to carry (OA-199) is a
        // fact about this map that nothing else would ever say out loud.
        const swap = swapInProposedData(id, pu.id);
        if (swap.carried.length) req.log.info({ mapId: id, carried: swap.carried }, 'carried pack extras onto the refreshed data');
        for (const d of swap.dropped) req.log.warn({ mapId: id, file: d.file }, `did NOT carry ${d.file} forward — ${d.why}`);
        return { rend, overrides: reapplied.overrides, dropped: reapplied.rejected };
      });

      const noteBits = refreshNote(summary);
      const versionId = insertVersion({
        map_id: id, major, minor,
        note: `Accepted update${noteBits ? ' — ' + noteBits : ''}`,
        overrides: applied.overrides, storage_key: storageKey,
        // The diff travels WITH the version, so every later screen can say what
        // this version changed without digging through the audit log (findings A1).
        data_change: { proposedId: pu.id, sourceNote: pu.source_note || '', summary },
      });
      setCurrentVersion(id, versionId);
      decideProposedUpdate(pu.id, { status: 'accepted', reviewedBy: user.id, decisionNote, acceptedVersionId: versionId });
      req.log.info({ mapId: id, version: storageKey, proposedId: pu.id, by: user.email }, 'monthly update accepted');
      logAudit(req, 'refresh.accept', { mapId: id, versionId, detail: { proposedId: pu.id, version: storageKey, changeSummary: summary, droppedOverrides: applied.dropped, note: decisionNote } });
      return {
        ok: true, version: storageKey, dropped: applied.dropped,
        files: applied.rend.files, downloads: visibleDownloadsForVersion(id, storageKey, outputs),
      };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: 'Accepting the update failed: ' + e.message });
    }
  });

  // Decline the refresh: keep the current data; mark the proposal declined.
  app.post('/decline', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    const { pu, code: pcode, error: perror } = loadPendingProposed(id, Number(req.params.pid));
    if (!pu) return reply.code(pcode).send({ ok: false, error: perror });
    const note = str((req.body || {}).note, 1000);
    decideProposedUpdate(pu.id, { status: 'declined', reviewedBy: user.id, decisionNote: note });
    req.log.info({ mapId: id, proposedId: pu.id, by: user.email }, 'monthly update declined');
    logAudit(req, 'refresh.decline', { mapId: id, detail: { proposedId: pu.id, note } });
    return { ok: true };
  });
}
