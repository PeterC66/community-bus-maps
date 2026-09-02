// The editor spine's API (P1, tenant-scoped in P2), as a Fastify plugin (OA-231,
// codebase review Tier 4.4).
//
// The map list, a map request, one map's detail, preview, the landmark chooser's
// list and basemap, save, the publish-request pair, the output toggles, the
// diagram request, public listing, the banner note and the version file server:
// 14 routes, registered under the prefix /api/maps by src/server.js. The
// handlers are the ones server.js carried until 2026-09-02, moved verbatim --
// the only edit inside them is that each no longer opens with its own
// requireUser() call.
//
// ONE GUARD, NOT 14, and the fourteenth route cannot forget it (portal-src F8).
// The single exception is declared as route config rather than as a second call
// site: GET /api/maps admits the read-only OPERATOR_TOKEN (OA-203), the same
// shape GET /api/admin/worklist already uses, and the guard is the only reader
// of that flag.
//
// THE HOOK IS THE WEAK HALF, ON PURPOSE -- the same shape as src/routes/proposed.js
// and for the same reason. requireUser establishes only that somebody is signed
// in. The decision that matters is per-map and per-request: loadOwnedMap() (the
// map's own customer, or an admin) on the twelve routes that write or reveal a
// map's working state, and loadReadableMap() on the two that only read. Both
// need the map, so a plugin-level hook cannot make either call, and hoisting the
// cheap half is exactly the cut that would pass every anonymous-is-refused
// assertion ever written while letting any signed-in customer save over another
// organisation's map. That is what scripts/test-editor-plugin.mjs asserts, and
// what the middle arm of scripts/prove-red-editor-plugin.mjs breaks.
//
// THE SUBSTITUTION IS EXACT, NOT MERELY EQUIVALENT: requireUser() RETURNS
// req.user on success, so `const user = req.user` in a handler the hook has
// already admitted is the same value the call produced, not a second lookup
// that agrees today.
//
// GET /api/poi-glyphs IS NOT HERE, and that is the prefix rule rather than an
// oversight. It is the same audience behind the same guard, but it is not in the
// /api/maps subtree -- it is our own pictogram artwork, map-independent by
// construction -- and a prefix that overstates what a file governs is a claim a
// later reader acts on. It stays in server.js with its own requireUser() call.

import path from 'node:path';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { getCustomer, getMapBySlug, getOpenRequestForMap, getPublicMapBySlug, getVersion, insertMap, insertMessage, insertPublishRequest, insertVersion, listMaps, nextVersion, quotaUsage, setCurrentVersion, setMapBannerNote, setMapOutputs, setMapPublicListed, setVersionState, withdrawPublishRequest } from '../db/index.js';
import { mapPageUrl } from '../public/index.js';
import { chooseOutputs, editablePoiKeysFromDir, enumerateCandidatesFromDir, outputsForClient, outputsNeedingRender, packPoiTiers, preview, readOverrides, readRoutesMeta, renderVersion } from '../maps/engine.js';
import { sanitizeOverrides } from '../maps/safeSubset.js';
import { mergeGenWarnings } from '../render/genWarnings.js';
import { OUTPUTS, OUTPUT_FILES, mapDataDir, versionDir } from '../maps/store.js';
import { draftLabel, ensureDraftMarked } from '../render/draftStamp.js';
import { logAudit } from '../audit/index.js';
import { bumpSearchIndex } from '../search/index.js';
import { MAP_KINDS, operatorRead, parseOutputs, requireUser, slugify, str } from '../http/helpers.js';
import { loadOwnedMap, loadReadableMap, mapDetail, safeSubsetAllow, savedPoiTiers, visibleDownloadsForVersion, withMapLock } from '../maps/detail.js';

export default async function editorRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.config.operatorRead && operatorRead(req)) return;
    if (!requireUser(req, reply)) return reply;
  });

  // prefixTrailingSlash: 'no-slash' because Fastify's default for a route path of
  // '/' inside a prefixed plugin registers BOTH /api/maps and /api/maps/ — a route
  // the unsplit server never had, and one the route-table oracle catches.
  app.get('/', { prefixTrailingSlash: 'no-slash', config: { operatorRead: true } }, async (req, reply) => {
    // OPERATOR_TOKEN reads this at admin scope (OA-203). Declared as route config
    // so the plugin's guard admits it; the guard is the only reader of that flag.
    // With no token and no session the plugin's 401 is what it always was.
    const viaToken = operatorRead(req);
    const user = viaToken ? null : req.user;
    const isAdmin = viaToken || user.role === 'admin';
    if (!isAdmin && user.customer_id == null) return { ok: true, isAdmin: false, maps: [] };
    const scope = isAdmin ? {} : { customerId: user.customer_id };
    return {
      ok: true, isAdmin,
      maps: listMaps(scope).map((m) => ({
        id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
        status: m.status, currentVersion: m.cur_key || null,
        publishedVersion: m.pub_key || null, pendingReview: !!m.pending_reviews,
        pendingUpdate: !!m.pending_updates,
        // P6 — set only when the map really is on the public site (same query the
        // public pages use, so a suspension or an un-listing shows through here).
        publicUrl: m.pub_key && m.public_listed && getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
        customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
      })),
    };
  });

  // A customer requests a new map (area or place), within quota. It starts in
  // 'requested'; an admin approves it (P3) and the central pipeline builds the
  // data later — so no object store / render exists yet.
  app.post('/request', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    if (user.customer_id == null) return reply.code(400).send({ ok: false, error: 'Only a customer account can request maps.' });
    const cust = getCustomer(user.customer_id);
    if (!cust) return reply.code(400).send({ ok: false, error: 'Your organisation record is missing — please contact us.' });

    const b = req.body || {};
    const kind = MAP_KINDS.includes(b.kind) ? b.kind : '';
    const name = str(b.name, 120);
    const fields = [];
    if (!kind) fields.push('kind');
    if (!name) fields.push('name');
    if (fields.length) return reply.code(400).send({ ok: false, error: 'Please choose a type and give the map a name.', fields });

    const usage = quotaUsage(cust.id);
    const limit = kind === 'area' ? cust.quota_areas : cust.quota_places;
    if (usage[kind] >= limit) {
      const noun = kind === 'area' ? 'area map' : 'place map';
      return reply.code(400).send({ ok: false, error: `Your plan includes ${limit} ${noun}${limit === 1 ? '' : 's'} and you already have ${usage[kind]}. Contact us to raise your quota.` });
    }

    // Unique slug (append a counter if the base is taken).
    let slug = slugify(name) || kind;
    for (let n = 2; getMapBySlug(slug); n++) slug = `${slugify(name) || kind}-${n}`;

    const id = insertMap({
      customer_id: cust.id, slug, name, kind,
      subject: str(b.subject, 200), request_note: str(b.note, 2000),
      requested_by: user.id, data_dir: '', status: 'requested',
    });
    req.log.info({ mapId: id, kind, by: user.email }, 'map requested');
    const after = quotaUsage(cust.id);
    return {
      ok: true,
      map: { id, slug, name, kind, subject: str(b.subject, 200), status: 'requested' },
      usage: { usedAreas: after.area, usedPlaces: after.place, quotaAreas: cust.quota_areas, quotaPlaces: cust.quota_places },
    };
  });

  app.get('/:id', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadReadableMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    return { ok: true, map: mapDetail(map) };
  });

  app.post('/:id/preview', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    const meta = readRoutesMeta(id);
    const poiKeys = editablePoiKeysFromDir(mapDataDir(id), savedPoiTiers(id));
    const s = sanitizeOverrides((req.body || {}).overrides, safeSubsetAllow(map, meta, poiKeys));
    try {
      // OA-216 — a preview is the cheapest place to learn that a *Must show*
      // cannot be seated, because nothing has been saved yet. The generator has
      // always computed it and written it to stderr on a zero exit; this is the
      // first caller to read it.
      const runs = [];
      const svg = await withMapLock(id, () => preview(id, s.overrides, parseOutputs(map.outputs), runs));
      return { ok: true, overrides: s.overrides, rejected: s.rejected, svg, warnings: mergeGenWarnings(runs) };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: 'Preview render failed: ' + e.message });
    }
  });

  /**
   * The landmark chooser's list (OA-212): every POI this map COULD draw, with the
   * answer it currently carries, grouped so a category can be answered in one go.
   *
   * Read-only, and it runs no generator: enumerateCandidatesFromDir() asks the
   * selector directly. That matters twice over — it is fast enough to serve on
   * page load, and it is the only enumeration that still lists a POI somebody has
   * already classified `Do not show`.
   */
  app.get('/:id/landmarks', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    const tiers = savedPoiTiers(id);
    const saved = readOverrides(id);
    // A POI hidden through the editor's older render-time tick is shown here as
    // "Do not show" and rewritten as a tier on the next save (Peter, 2026-09-01).
    // Both are reported so the page can say which it is reading.
    const hidden = new Set(Object.keys((saved.internal && saved.internal.pois) || {})
      .filter((k) => saved.internal.pois[k] && saved.internal.pois[k].hide));
    // WHICH ROWS HAVE BEEN ANSWERED, which is not the same question as which rows
    // carry a tier other than `may` (OA-215). A deliberate "show if there is room"
    // is recorded as an entry whose tier IS `may`, so the only way to see it is to
    // ask which keys the two tier layers actually name — the map pack's own
    // routes.json, and the customer's overrides.
    const answeredKeys = new Set([
      ...Object.keys(packPoiTiers(mapDataDir(id))),
      ...Object.keys(tiers || {}),
    ]);
    const cand = enumerateCandidatesFromDir(mapDataDir(id), tiers).map((p) => ({
      key: p.key, cat: p.cat, name: p.name, ll: p.ll,
      tier: p.tier === 'may' && hidden.has(p.key) ? 'miss' : p.tier,
      as: p.as || null,
      printsName: !!p.printsName,
      fromHide: p.tier === 'may' && hidden.has(p.key),
      answered: answeredKeys.has(p.key) || hidden.has(p.key),
    }));
    return {
      ok: true,
      map: { id, name: map.name, slug: map.slug, kind: map.kind, status: map.status },
      landmarks: cand,
      counts: {
        total: cand.length,
        must: cand.filter((p) => p.tier === 'must').length,
        miss: cand.filter((p) => p.tier === 'miss').length,
        symbolOnly: cand.filter((p) => !p.printsName).length,
        fromHide: cand.filter((p) => p.fromHide).length,
        answered: cand.filter((p) => p.answered).length,
      },
    };
  });

  /**
   * The street network and the POI points behind the chooser's map.
   *
   * DELIBERATELY NOT THE SHEET. It is the town's roads in plain lat/lon, drawn by
   * the browser, so that ticking is instant and a judgement about whether
   * somewhere is a landmark is made looking at where it actually is. It is served
   * from the same roads_geo.json the sheet is built from, so the streets are the
   * real ones — but the sheet's own projection, rotation and focus fisheye are NOT
   * applied, and the page says so. A picture that looked like the sheet without
   * being it would invite the reader to judge crowding from the wrong drawing;
   * the "See the real sheet" button is what answers that question honestly.
   *
   * Slimmed on the way out: roads_geo.json is 1.3 MB for High Wycombe, most of it
   * node id arrays nothing here needs.
   */
  app.get('/:id/basemap', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const dir = mapDataDir(map.id);
    let roads = null;
    try { roads = JSON.parse(readFileSync(path.join(dir, 'roads_geo.json'), 'utf8')); } catch { roads = null; }
    if (!roads || !Array.isArray(roads.ways)) {
      return reply.code(404).send({ ok: false, error: 'This map has no street data to draw.' });
    }
    // Keep the classes that read as a street network at town scale. A service
    // road or a driveway is noise here and is most of the file.
    const KEEP = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
      'unclassified', 'residential', 'motorway_link', 'trunk_link', 'primary_link',
      'secondary_link', 'tertiary_link', 'living_street', 'pedestrian']);
    const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link']);
    const ways = [];
    for (const w of roads.ways) {
      const hw = w.tags && w.tags.highway;
      if (!hw || !KEEP.has(hw)) continue;
      if (!Array.isArray(w.geometry) || w.geometry.length < 2) continue;
      ways.push({
        g: w.geometry.map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]),
        m: MAJOR.has(hw) ? 1 : 0,
        n: (w.tags.name || w.tags.ref || '') || undefined,
      });
    }
    return { ok: true, bbox: roads.bbox || null, ways };
  });

  app.post('/:id/save', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    // Editing is frozen while a version awaits publication review — withdraw the
    // request first, so the version an approver reviews is always the head.
    if (getOpenRequestForMap(id)) {
      return reply.code(409).send({ ok: false, error: 'This map is awaiting publication review. Withdraw the request to make further changes.' });
    }
    const meta = readRoutesMeta(id);
    const poiKeys = editablePoiKeysFromDir(mapDataDir(id), savedPoiTiers(id));
    const b = req.body || {};
    const s = sanitizeOverrides(b.overrides, safeSubsetAllow(map, meta, poiKeys));
    const { major, minor } = nextVersion(id);
    const storageKey = `v${major}.${minor}`;
    try {
      const r = await withMapLock(id, () => renderVersion(id, s.overrides, storageKey, parseOutputs(map.outputs)));
      const versionId = insertVersion({ map_id: id, major, minor, note: str(b.note, 500), overrides: s.overrides, storage_key: storageKey });
      setCurrentVersion(id, versionId);
      req.log.info({ mapId: id, version: storageKey, by: user.email, genLog: r.log }, 'saved new map version');
      logAudit(req, 'version.save', { mapId: id, versionId, detail: { version: storageKey, note: str(b.note, 500) } });
      // OA-216 — what the generators said on the way to this SUCCESSFUL render.
      // `mustPlace` is not a veto: a place the customer marked *Must show* that
      // the placer could not seat is named on stderr and the run still exits 0,
      // so until 2026-09-01 the editor was told "the map has been redrawn with
      // your choices" over an answer that had partly not happened.
      return { ok: true, version: storageKey, rejected: s.rejected, files: r.files, warnings: r.warnings, downloads: visibleDownloadsForVersion(id, storageKey, parseOutputs(map.outputs)) };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: 'Render failed: ' + e.message });
    }
  });

  // --- publish gate: the editor submits the current head for review, or
  //     withdraws a pending request to resume editing. Approvers/admins decide
  //     (below, under /api/review). Editors never publish their own maps.
  app.post('/:id/publish-request', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const id = map.id;
    if (!map.current_version_id || !map.cur_key) {
      return reply.code(400).send({ ok: false, error: 'This map has no rendered version to publish yet.' });
    }
    if (getOpenRequestForMap(id)) {
      return reply.code(409).send({ ok: false, error: 'This map is already awaiting publication review.' });
    }
    if (map.published_version_id === map.current_version_id) {
      return reply.code(409).send({ ok: false, error: 'The current version is already the published one.' });
    }
    const note = str((req.body || {}).note, 1000);
    const requestId = insertPublishRequest({ map_id: id, version_id: map.current_version_id, requested_by: user.id, note });
    setVersionState(map.current_version_id, 'pending');
    req.log.info({ mapId: id, requestId, version: map.cur_key, by: user.email }, 'publication requested');
    logAudit(req, 'version.submit', { mapId: id, versionId: map.current_version_id, detail: { requestId, version: map.cur_key, note } });
    return { ok: true, request: { id: requestId, versionKey: map.cur_key, note } };
  });

  app.post('/:id/publish-request/withdraw', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const open = getOpenRequestForMap(map.id);
    if (!open) return reply.code(409).send({ ok: false, error: 'There is no pending request to withdraw.' });
    withdrawPublishRequest(open.id);
    // Return the version to draft unless it is the currently-published one.
    if (open.version_id !== map.published_version_id) setVersionState(open.version_id, 'draft');
    req.log.info({ mapId: map.id, requestId: open.id, by: user.email }, 'publication request withdrawn');
    logAudit(req, 'version.withdraw', { mapId: map.id, versionId: open.version_id, detail: { requestId: open.id } });
    return { ok: true };
  });

  // Choose which outputs a map produces (P2 output toggles).
  //
  // Expert styles (P7) can only be switched on for a map that carries the config
  // they need, and the tube-map diagram cannot be switched on by a customer at all
  // — it is request-only (see chooseOutputs). The server decides, not the UI.
  app.patch('/:id/outputs', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const current = parseOutputs(map.outputs);
    const available = outputsForClient(current, map.id, map.kind).filter((o) => o.available).map((o) => o.key);
    const { outputs: clean, refused } = chooseOutputs((req.body || {}).outputs, {
      current, available, isAdmin: user.role === 'admin',
    });
    if (refused.length) {
      req.log.warn({ mapId: map.id, refused, by: user.email }, 'refused a request-only output change');
      return reply.code(403).send({
        ok: false, refused,
        error: 'The tube-map diagram is hand-finished, so it is not a tick-box — ask us for it and we will quote and set it up.',
      });
    }
    if (!Object.values(clean).some(Boolean)) return reply.code(400).send({ ok: false, error: 'A map must produce at least one output.' });

    // GRANTING AN OUTPUT USED TO RENDER NOTHING (OA-007). Walked for real on the
    // St Ives Bus Station import, 2026-08-24: `PATCH /api/maps/14/outputs` set
    // `boarding_plan: true`, returned 200, and produced no file at all —
    // `renders/v1.0/` still held only the internal and external sheets. The sheet
    // appeared only after a second delivery of the same S5 was staged as a
    // proposed update and ACCEPTED, because accept is what renders. So the working
    // sequence was grant → re-deliver → accept → publish, and two of those four
    // steps existed purely to make a flag take effect.
    //
    // Most flips need none of that: a `buildAlways` output (the schematic) is
    // already in every version's folder, so enabling it is a pure visibility
    // change and must stay instant and free. The ones that need a render are
    // exactly the ones whose FILE IS MISSING from the current version — which is
    // the condition asked here, rather than "is this output expert" or "is it
    // request-only". Both of those are proxies; the file is the fact.
    const grantsNeedingRender = outputsNeedingRender(current, clean, mapDataDir(map.id), map.cur_key ? versionDir(map.id, map.cur_key) : null);
    if (grantsNeedingRender.length && getOpenRequestForMap(map.id)) {
      return reply.code(409).send({
        ok: false,
        error: 'This map is awaiting publication review, and adding that sheet needs a new version. Withdraw the request first.',
      });
    }

    setMapOutputs(map.id, clean);
    req.log.info({ mapId: map.id, outputs: clean }, 'updated map outputs');

    let added = null;
    if (grantsNeedingRender.length) {
      const overrides = readOverrides(map.id);
      const { major, minor } = nextVersion(map.id);
      const storageKey = `v${major}.${minor}`;
      const labels = grantsNeedingRender.map((k) => (map.kind === 'place' && OUTPUTS[k].placeLabel) || OUTPUTS[k].label);
      try {
        const r = await withMapLock(map.id, () => renderVersion(map.id, overrides, storageKey, clean));
        const versionId = insertVersion({
          map_id: map.id, major, minor,
          note: `Added ${labels.join(' and ')}`,
          overrides, storage_key: storageKey,
        });
        setCurrentVersion(map.id, versionId);
        added = { version: storageKey, outputs: grantsNeedingRender, files: r.files };
        req.log.info({ mapId: map.id, version: storageKey, outputs: grantsNeedingRender, by: user.email }, 'rendered a new version for a granted output');
        logAudit(req, 'version.save', { mapId: map.id, versionId, detail: { version: storageKey, granted: grantsNeedingRender } });
      } catch (e) {
        // The FLAG IS ALREADY SET and that is deliberate: the grant itself is what
        // was asked for and it succeeded. Report the render failure honestly and
        // let the next save pick the sheet up, rather than silently reverting a
        // decision an admin made.
        req.log.error(e);
        return reply.code(500).send({
          ok: false,
          outputs: outputsForClient(clean, map.id, map.kind),
          error: `The sheet was granted, but rendering it failed: ${e.message}. The next save will produce it.`,
        });
      }
    }
    return { ok: true, outputs: outputsForClient(clean, map.id, map.kind), added };
  });

  // "Ask us for the diagram" — the customer half of the request-only lock above.
  // It deliberately creates nothing but a MESSAGE (the same table the contact form
  // and public map feedback use, with the map attached), because granting the
  // output is expert work with a price attached, not a state a form can set.
  app.post('/:id/diagram-request', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const note = str((req.body || {}).note, 2000);
    const body = [
      `Asked for the tube-map diagram on "${map.name}" (map #${map.id}, ${map.kind}).`,
      note && `They said: ${note}`,
    ].filter(Boolean).join('\n\n');
    const id = insertMessage({ kind: 'diagram-request', name: user.name || null, email: user.email, body, map_id: map.id });
    req.log.info({ messageId: id, mapId: map.id, by: user.email }, 'tube-map diagram requested');
    logAudit(req, 'diagram.request', { mapId: map.id, detail: { messageId: id, note } });
    return { ok: true, id };
  });

  // Whether the map's PUBLISHED version appears on the public site (P6). This is
  // the customer's own choice and is independent of the publish gate: un-listing
  // takes the page down without touching the reviewed version or its pointer.
  app.patch('/:id/public', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const listed = !!(req.body || {}).listed;
    setMapPublicListed(map.id, listed);
    bumpSearchIndex(); // P9 — an unlisted map's places must stop being searchable
    req.log.info({ mapId: map.id, listed }, 'public listing updated');
    logAudit(req, listed ? 'public.list' : 'public.unlist', { mapId: map.id, detail: { name: map.name } });
    return { ok: true, publicListed: listed, publicUrl: getPublicMapBySlug(map.slug) ? mapPageUrl(map.slug) : null };
  });

  // P8: the "changes coming" banner shown above the public map image. Auto-
  // suggested by scripts/check-upcoming-refreshes.mjs from the GTFS upcoming-
  // changes scan; the owning customer or an admin may overwrite the wording here
  // (marking it 'manual' so the next scan won't clobber it), or clear it entirely.
  app.patch('/:id/banner-note', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const note = str((req.body || {}).note, 500);
    setMapBannerNote(map.id, note || null, 'manual');
    req.log.info({ mapId: map.id, by: user.email }, 'banner note updated');
    logAudit(req, 'banner.update', { mapId: map.id, detail: { note } });
    return { ok: true, bannerNote: note || null };
  });

  app.get('/:id/versions/:key/:file', async (req, reply) => {
    const user = req.user;                       // the plugin guard above proved it
    const { map, code, error } = loadReadableMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const { key, file } = req.params;
    if (!/^v\d+\.\d+$/.test(key) || !Object.prototype.hasOwnProperty.call(OUTPUT_FILES, file)) {
      return reply.code(400).send({ ok: false, error: 'Bad version or file.' });
    }
    let p = path.join(versionDir(map.id, key), file);
    if (!existsSync(p)) return reply.code(404).send({ ok: false, error: 'Not found.' });

    /* Mark a copy that is NOT the published one, so a sheet on someone's desk says
     * what it is. The render itself carries only "Map version 5.0" — true while the
     * version is a draft and still true once it is published, which is what lets
     * publishing stay a pure state flip and leaves the reviewed bytes alone (see
     * renderVersion in maps/engine.js). This route is the one that serves versions
     * OTHER than the published one, so it is where the state belongs.
     *
     * Derived and cached beside the source, never written over it — the same
     * contract as the public watermark, and it falls back to the original file on
     * any error rather than failing a download. A render made before the version
     * line existed has no line to rewrite and is served untouched.
     */
    const ver = getVersion(map.id, key);
    if (ver && ver.review_state !== 'published') {
      try {
        const marked = await ensureDraftMarked(p, draftLabel(ver.review_state, `${ver.major}.${ver.minor}`, ver.created_at));
        if (marked) p = marked;
      } catch (e) {
        req.log.error(e, 'draft marking failed; serving the original file');
      }
    }

    reply.header('Content-Type', OUTPUT_FILES[file]);
    if (req.query && 'download' in req.query) {
      reply.header('Content-Disposition', `attachment; filename="${map.slug}-${key}-${file}"`);
    }
    return reply.send(createReadStream(p));
  });
}
