// One map, as the signed-in app sees it: the detail record and the load-a-map
// helpers the editor, the review queue and the monthly-refresh routes share
// (OA-231, codebase review Tier 4.4). These were module-scope functions in
// src/server.js, used from three of its sections; moving them out BEFORE any
// section is cut into its own file is what lets each route file import them
// rather than close over a scope it no longer lives in. Moved verbatim.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { dataChangesSince, getCustomer, getMap, getOpenProposedForMap, getOpenRequestForMap, getProposedUpdate, getPublicMapBySlug, getVersionById, listProposedForMap, listPublishRequestsForMap, listPublishedHistory, listVersions } from '../db/index.js';
import { brandingForPublic } from '../branding/index.js';
import { mapPageUrl } from '../public/index.js';
import { effectiveOutputs, enumeratePois, outputsForClient, readOverrides, readRoutesMeta } from './engine.js';
import { BOARDING_CONFLICT } from './safeSubset.js';
import { OUTPUT_FILES, mapDataDir, versionDir } from './store.js';
import { changeSummary } from '../publish/index.js';
import { parseJson, parseOutputs } from '../http/helpers.js';

// Serialise generator runs per map (preview + save write into the map's data/).
const mapLocks = new Map();
function withMapLock(id, fn) {
  const prev = mapLocks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  mapLocks.set(id, next.finally(() => { if (mapLocks.get(id) === next) mapLocks.delete(id); }));
  return next;
}

// Load a map only if the user may EDIT it. Admins edit all; everyone else is
// scoped to their own customer. Returns { map } or { code, error }.
function loadOwnedMap(id, user) {
  const m = getMap(id);
  if (!m) return { code: 404, error: 'No such map.' };
  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {
    return { code: 403, error: 'You do not have access to this map.' };
  }
  return { map: m };
}

// Load a map the user may READ (view detail / download rendered files). Same as
// edit scope PLUS platform approvers, who must inspect any submitted map's
// print-ready files to review it — but cannot edit it.
function loadReadableMap(id, user) {
  const m = getMap(id);
  if (!m) return { code: 404, error: 'No such map.' };
  const owner = user.customer_id != null && m.customer_id === user.customer_id;
  if (user.role === 'admin' || user.role === 'approver' || owner) return { map: m };
  return { code: 403, error: 'You do not have access to this map.' };
}

// Whether this map's owning customer has opted into the hiddenOperators
// safe-subset key (off by default — most maps/customers never see it).
function operatorFilterAllow(customerId) {
  if (customerId == null) return false;
  const c = getCustomer(customerId);
  return !!(c && c.hide_operators_enabled);
}

/**
 * Does this map actually RENDER a "Where to board" sheet? (OA-011.)
 *
 * Read from effectiveOutputs() rather than from the stored config, because the
 * config can say `boarding_plan: true` on a payload that carries no stand
 * register — in which case nothing is rendered and there is nothing to conflict
 * with. Takes an explicit data dir so the staged half of a monthly refresh can
 * be asked the same question about ITS payload.
 */
function boardingPlanActive(map, dataDir = mapDataDir(map.id)) {
  return effectiveOutputs(parseOutputs(map.outputs), dataDir).some((o) => o.key === 'boarding_plan');
}

/**
 * A map's saved poiTiers overlay ({} if none). Passed to the candidate
 * enumerator so the tier it reports is the tier the sheet is drawn with, and
 * so a renamed POI is enumerated under BOTH its identities.
 */
function savedPoiTiers(id) {
  const ov = readOverrides(id);
  const t = ov && ov.internal && ov.internal.poiTiers;
  return t && typeof t === 'object' ? t : {};
}

/** The three things sanitizeOverrides() needs to know about a map's customer + payload. */
function safeSubsetAllow(map, meta, poiKeys, dataDir) {
  return {
    palette: meta.palette, poiKeys,
    operatorNames: meta.operatorNames,
    operatorFilterEnabled: operatorFilterAllow(map.customer_id),
    boardingPlanOn: boardingPlanActive(map, dataDir),
  };
}

function downloadsForVersion(id, storageKey) {
  const dir = versionDir(id, storageKey);
  return Object.keys(OUTPUT_FILES)
    .filter((f) => existsSync(path.join(dir, f)))
    .map((f) => ({ file: f, url: `/api/maps/${id}/versions/${storageKey}/${f}` }));
}

// Customer-facing download list: same as downloadsForVersion() but additionally
// hides any `buildAlways` output (the schematic) the map hasn't switched on for
// itself yet. It is rendered into every version regardless (see effectiveOutputs
// in maps/engine.js), so the raw file list would otherwise leak it before the
// customer ticks the visibility box. Non-output files (disagreements.pdf) always
// pass through. Admin-only views (review, revert, the diagram pin editor) use
// the raw downloadsForVersion() — an admin should see everything that exists.
function visibleDownloadsForVersion(id, storageKey, outputsConfig) {
  const visibleBases = new Set(
    outputsForClient(outputsConfig, id).filter((o) => o.enabled).map((o) => o.base),
  );
  return downloadsForVersion(id, storageKey).filter((d) => {
    const m = d.file.match(/^(.*)\.(svg|jpg)$/);
    return !m || visibleBases.has(m[1]);
  });
}

// Load a map's PENDING proposed update, scoped to that map. Returns { pu } or { code, error }.
function loadPendingProposed(mapId, pid) {
  const pu = getProposedUpdate(pid);
  if (!pu || pu.map_id !== mapId) return { code: 404, error: 'No such update for this map.' };
  if (pu.status !== 'pending') return { code: 409, error: `This update was already ${pu.status}.` };
  return { pu };
}

// A short, human phrase for a data-refresh change summary (goes on the version note).
function refreshNote(s) {
  if (!s || s.unchanged) return '';
  const bits = [];
  if (s.routesAdded && s.routesAdded.length) bits.push(`routes +${s.routesAdded.join('/')}`);
  if (s.routesRemoved && s.routesRemoved.length) bits.push(`routes −${s.routesRemoved.join('/')}`);
  if (s.stopsChanged && s.stopsChanged.length) bits.push(`${s.stopsChanged.length} route stop change${s.stopsChanged.length > 1 ? 's' : ''}`);
  if (s.descChanged && s.descChanged.length) bits.push(`${s.descChanged.length} description change${s.descChanged.length > 1 ? 's' : ''}`);
  if (s.validity) bits.push(`validity → ${s.validity.to || '—'}`);
  return bits.join(' · ');
}

function mapDetail(m) {
  const id = m.id;
  const meta = readRoutesMeta(id);
  const saved = readOverrides(id);
  const savedColors = saved.routeColors || {};
  const savedPois = (saved.internal && saved.internal.pois) || {};
  const order = (meta.routeOrder && meta.routeOrder.length ? meta.routeOrder : Object.keys(meta.palette));
  const routes = order
    .filter((r) => meta.palette[r])
    .map((r) => ({
      id: r, defaultColor: meta.palette[r], color: savedColors[r] || meta.palette[r],
      customised: !!savedColors[r], textOn: meta.textOn[r] || '#111', desc: meta.internalDesc[r] || null,
    }));
  const pois = enumeratePois(id).map((p) => ({ ...p, hidden: !!(savedPois[p.key] && savedPois[p.key].hide) }));
  const hideOperatorsEnabled = operatorFilterAllow(m.customer_id);
  const savedHiddenOps = new Set(Array.isArray(saved.hiddenOperators) ? saved.hiddenOperators : []);
  const operators = hideOperatorsEnabled ? meta.operatorNames.map((name) => ({ name, hidden: savedHiddenOps.has(name) })) : [];
  // The one reason an ENABLED operator filter is still refused (OA-011). The
  // sentence is the safe subset's own, so the control and the rejection cannot
  // drift apart, and the editor shows it beside the disabled boxes rather than
  // letting the customer discover it at save time.
  const hideOperatorsBlocked = hideOperatorsEnabled && boardingPlanActive(m) ? BOARDING_CONFLICT : null;

  // Publish gate (P4): the pending request (if any) locks editing; the published
  // pointer + a diff of "what publishing the current head would change".
  const open = getOpenRequestForMap(id);
  const pendingVer = open ? getVersionById(open.version_id) : null;
  const pending = open ? {
    id: open.id, versionKey: pendingVer ? pendingVer.storage_key : null,
    note: open.note || '', createdAt: open.created_at,
  } : null;
  // The diff must count the DATA refreshes this head carries as well as the
  // customer's own overrides — see changeSummary()'s note and findings A1.
  const summary = m.cur_key
    ? changeSummary(saved, parseJson(m.pub_overrides), {
      palette: meta.palette,
      hasBaseline: !!m.pub_key,
      dataChanges: dataChangesSince(id, m.published_version_id, m.current_version_id),
    })
    : null;

  // Monthly change acceptance (P5): a staged data refresh awaiting accept/decline.
  const openProposed = getOpenProposedForMap(id);
  const proposedUpdate = openProposed ? {
    id: openProposed.id, sourceNote: openProposed.source_note || '',
    createdAt: openProposed.created_at, summary: parseJson(openProposed.summary_json),
  } : null;

  return {
    id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject, status: m.status,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    town: meta.town, currentVersion: m.cur_key || null, overrides: saved,
    routes, pois, hideOperatorsEnabled, hideOperatorsBlocked, operators, outputs: outputsForClient(parseOutputs(m.outputs), id, m.kind),
    // Every version, with the files that still exist and the overrides it was
    // rendered from — the editor lists them, so "earlier versions stay
    // available" is something the customer can see (findings H8).
    versions: listVersions(id).map((v) => ({
      id: v.id, storage_key: v.storage_key, note: v.note, review_state: v.review_state,
      created_at: v.created_at, overrides: parseJson(v.overrides_json),
      downloads: visibleDownloadsForVersion(id, v.storage_key, parseOutputs(m.outputs)),
    })),
    downloads: m.cur_key ? visibleDownloadsForVersion(id, m.cur_key, parseOutputs(m.outputs)) : [],
    // --- publish gate ---
    headState: m.cur_state || null,
    publishedVersion: m.pub_key || null,
    publishedDownloads: m.pub_key ? visibleDownloadsForVersion(id, m.pub_key, parseOutputs(m.outputs)) : [],
    pendingRequest: pending,
    editable: !pending, // locked while a publish request awaits review
    changeSummary: summary,
    publishHistory: listPublishRequestsForMap(id),
    // --- monthly change acceptance (P5) ---
    proposedUpdate,
    refreshHistory: listProposedForMap(id),
    // --- public page (P6) --- `publicUrl` is set only when the map really is
    // reachable by the public (asked of the same query the public site uses, so
    // the editor can never be told "you are live" when a suspension hides it).
    publicListed: !!m.public_listed,
    publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
    org: m.customer_id ? brandingForPublic(getCustomer(m.customer_id)) : null,
    // --- P8: "changes coming" banner ---
    bannerNote: m.banner_note || null,
    bannerNoteSource: m.banner_note_source || 'auto',
  };
}

/** Publication history for one map: which versions were published, when, by whom. */
function publishedHistoryFor(map) {
  return listPublishedHistory(map.id).map((h) => {
    const files = downloadsForVersion(map.id, h.storage_key);
    return {
      versionId: h.version_id, version: h.storage_key,
      publishedAt: h.published_at, approver: h.approver_email || null,
      decisionNote: h.decision_note || '',
      isCurrent: !!h.is_current,
      files,
      // No rendered files (pruned/lost) ⇒ nothing to serve ⇒ not revertable.
      revertable: !h.is_current && files.length > 0,
    };
  });
}

export {
  withMapLock, loadOwnedMap, loadReadableMap, operatorFilterAllow, boardingPlanActive, savedPoiTiers, safeSubsetAllow, downloadsForVersion, visibleDownloadsForVersion, loadPendingProposed, refreshNote, mapDetail, publishedHistoryFor,
};
