// SQLite via Node's built-in node:sqlite (no native build step).
// The DB file lives under DATA_DIR (git-ignored) — never in the repo.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..'); // repo root — keeps data location cwd-independent
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'portal.sqlite');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(readFileSync(path.join(HERE, 'schema.sql'), 'utf8'));

// Lightweight migrations for DBs created before a column existed. (schema.sql is
// CREATE TABLE IF NOT EXISTS, so an existing table won't pick up new columns.)
function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
(function migrate() {
  const mapCols = tableColumns('map');
  if (!mapCols.includes('customer_id')) db.exec('ALTER TABLE map ADD COLUMN customer_id INTEGER');
  if (!mapCols.includes('outputs')) db.exec("ALTER TABLE map ADD COLUMN outputs TEXT NOT NULL DEFAULT '{}'");
  // P3: a requested map records what was asked for and who asked.
  if (!mapCols.includes('request_note')) db.exec('ALTER TABLE map ADD COLUMN request_note TEXT');
  if (!mapCols.includes('requested_by')) db.exec('ALTER TABLE map ADD COLUMN requested_by INTEGER');

  // P3: approval links an application to the customer it created.
  const appCols = tableColumns('application');
  if (!appCols.includes('reviewed_at')) db.exec('ALTER TABLE application ADD COLUMN reviewed_at TEXT');
  if (!appCols.includes('customer_id')) db.exec('ALTER TABLE application ADD COLUMN customer_id INTEGER');

  // P4: publish gate — the public-current pointer + per-version review state.
  // (publish_request / audit_log are new tables, so CREATE IF NOT EXISTS covers them.)
  if (!mapCols.includes('published_version_id')) db.exec('ALTER TABLE map ADD COLUMN published_version_id INTEGER');
  const verCols = tableColumns('map_version');
  if (!verCols.includes('review_state')) db.exec("ALTER TABLE map_version ADD COLUMN review_state TEXT NOT NULL DEFAULT 'draft'");

  // P5: proposed_update is a NEW table (schema.sql CREATE IF NOT EXISTS covers a
  // pre-P5 DB), so no ALTER is needed here — kept as a marker for the next reader.

  // P6: the public front — an organisation's public identity + a per-map opt-out
  // of being listed, and feedback that knows which map it came from.
  const custCols = tableColumns('customer');
  if (!custCols.includes('slug')) db.exec('ALTER TABLE customer ADD COLUMN slug TEXT');
  if (!custCols.includes('branding_json')) db.exec("ALTER TABLE customer ADD COLUMN branding_json TEXT NOT NULL DEFAULT '{}'");
  if (!mapCols.includes('public_listed')) db.exec('ALTER TABLE map ADD COLUMN public_listed INTEGER NOT NULL DEFAULT 1');
  const msgCols = tableColumns('message');
  if (!msgCols.includes('map_id')) db.exec('ALTER TABLE message ADD COLUMN map_id INTEGER');

  // Demo organisations (scripts/seed-demo.mjs) are indistinguishable from real
  // ones once they have branding and a published map, which is exactly how a
  // seeded instance ends up showing invented councils as customers. Flag them in
  // the data so every surface can say so. NOT pilot-gated: demo data stays demo
  // data after the pilot ends.
  if (!custCols.includes('is_demo')) db.exec('ALTER TABLE customer ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');

  // Opt-in per-customer toggle: may this customer hide an operator's routes
  // in the Map Tuning (safe-subset) editor? Off for everyone by default —
  // an admin turns it on per customer, same pattern as quota_areas/plan.
  if (!custCols.includes('hide_operators_enabled')) db.exec('ALTER TABLE customer ADD COLUMN hide_operators_enabled INTEGER NOT NULL DEFAULT 0');

  // Opt-out per-customer toggle: watermark this customer's JPG downloads for
  // anyone who isn't them (or an admin)? On for everyone by default — an admin
  // turns it off per customer, same pattern as hide_operators_enabled above.
  if (!custCols.includes('watermark_enabled')) db.exec('ALTER TABLE customer ADD COLUMN watermark_enabled INTEGER NOT NULL DEFAULT 1');

  // P8: "changes coming" banner shown above the public map image. auto-suggested
  // from the GTFS upcoming-changes scan; admin/customer may overwrite the wording.
  if (!mapCols.includes('banner_note')) db.exec('ALTER TABLE map ADD COLUMN banner_note TEXT');
  if (!mapCols.includes('banner_note_source')) db.exec("ALTER TABLE map ADD COLUMN banner_note_source TEXT NOT NULL DEFAULT 'auto'");
  if (!mapCols.includes('banner_note_set_at')) db.exec('ALTER TABLE map ADD COLUMN banner_note_set_at TEXT');

  // A version created by accepting a data refresh records WHAT the refresh changed.
  // Before this column the answer existed only in the audit log, so every screen that
  // asked "what does publishing this change?" compared the customer's overrides alone
  // and reported a fully-refreshed map as identical to the published one (findings A1).
  if (!verCols.includes('data_change_json')) {
    db.exec('ALTER TABLE map_version ADD COLUMN data_change_json TEXT');
    backfillDataChanges();
  }

  // Every customer needs a public slug for /o/<slug>; backfill the ones created
  // before P6 (and any created by a script that predates ensureCustomerSlug).
  for (const c of db.prepare("SELECT id, name FROM customer WHERE slug IS NULL OR slug = ''").all()) {
    ensureCustomerSlug(c.id, c.name);
  }
})();

/**
 * One-off: fill data_change_json for versions accepted before the column existed.
 * `proposed_update` already links each accepted refresh to the version it created
 * and holds the diff, so no history is lost — it was only ever unreadable.
 */
function backfillDataChanges() {
  const rows = db.prepare(
    `SELECT id, source_note, summary_json, accepted_version_id
       FROM proposed_update WHERE status = 'accepted' AND accepted_version_id IS NOT NULL`,
  ).all();
  const upd = db.prepare('UPDATE map_version SET data_change_json = ? WHERE id = ? AND data_change_json IS NULL');
  for (const r of rows) {
    let summary = {};
    try { summary = JSON.parse(r.summary_json || '{}') || {}; } catch { summary = {}; }
    upd.run(JSON.stringify({ proposedId: r.id, sourceNote: r.source_note || '', summary }), Number(r.accepted_version_id));
  }
}

/** url-safe, unique organisation slug derived from its name (P6 public pages). */
export function ensureCustomerSlug(id, name) {
  const row = db.prepare('SELECT slug, name FROM customer WHERE id = ?').get(Number(id));
  if (row && row.slug) return row.slug;
  const base = String(name || (row && row.name) || `org-${id}`)
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `org-${id}`;
  let slug = base;
  for (let n = 2; ; n++) {
    const taken = db.prepare('SELECT id FROM customer WHERE slug = ? AND id <> ?').get(slug, Number(id));
    if (!taken) break;
    slug = `${base}-${n}`;
  }
  db.prepare('UPDATE customer SET slug = ? WHERE id = ?').run(slug, Number(id));
  return slug;
}

export function insertApplication(a) {
  const info = db
    .prepare(
      `INSERT INTO application (org_name, org_type, contact_name, email, phone, website, wants, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.org_name,
      a.org_type,
      a.contact_name,
      a.email,
      a.phone || null,
      a.website || null,
      a.wants || null,
      a.message || null,
    );
  return Number(info.lastInsertRowid);
}

export function insertMessage(m) {
  const info = db
    .prepare(`INSERT INTO message (kind, name, email, body, map_id) VALUES (?, ?, ?, ?, ?)`)
    .run(m.kind || 'enquiry', m.name || null, m.email || null, m.body, m.map_id != null ? Number(m.map_id) : null);
  return Number(info.lastInsertRowid);
}

// --- applications (P3 admin review) ---
export function listApplications({ status } = {}) {
  const where = status ? 'WHERE status = ?' : '';
  const args = status ? [status] : [];
  return db.prepare(`SELECT * FROM application ${where} ORDER BY created_at DESC`).all(...args);
}
export function getApplication(id) {
  return db.prepare('SELECT * FROM application WHERE id = ?').get(Number(id));
}
export function setApplicationReviewed(id, status, customerId = null) {
  db.prepare("UPDATE application SET status = ?, reviewed_at = datetime('now'), customer_id = ? WHERE id = ?")
    .run(status, customerId != null ? Number(customerId) : null, Number(id));
}

// --- messages (P3 admin read-only view; P6 adds the map a message came from) ---
export function listMessages() {
  return db
    .prepare(
      `SELECT msg.*, m.name AS map_name, m.slug AS map_slug
         FROM message msg LEFT JOIN map m ON m.id = msg.map_id
        ORDER BY msg.created_at DESC`,
    )
    .all();
}

export function counts() {
  return {
    applications: db.prepare('SELECT COUNT(*) AS c FROM application').get().c,
    messages: db.prepare('SELECT COUNT(*) AS c FROM message').get().c,
    maps: db.prepare('SELECT COUNT(*) AS c FROM map').get().c,
    publishRequests: db.prepare('SELECT COUNT(*) AS c FROM publish_request').get().c,
    proposedUpdates: db.prepare('SELECT COUNT(*) AS c FROM proposed_update').get().c,
    auditEvents: db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c,
  };
}

// ---------------------------------------------------------------------------
// Maps + versions (P1 editor spine)
// ---------------------------------------------------------------------------

// Pass { customerId } to scope to one customer's maps; omit for all (admin view).
export function listMaps({ customerId } = {}) {
  const where = customerId != null ? 'WHERE m.customer_id = ?' : '';
  const args = customerId != null ? [Number(customerId)] : [];
  return db
    .prepare(
      `SELECT m.*, c.name AS customer_name,
              v.major AS cur_major, v.minor AS cur_minor, v.storage_key AS cur_key,
              pv.storage_key AS pub_key,
              (SELECT COUNT(*) FROM publish_request pr WHERE pr.map_id = m.id AND pr.status = 'pending') AS pending_reviews,
              (SELECT COUNT(*) FROM proposed_update pu WHERE pu.map_id = m.id AND pu.status = 'pending') AS pending_updates
         FROM map m
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN map_version v ON v.id = m.current_version_id
         LEFT JOIN map_version pv ON pv.id = m.published_version_id
         ${where}
        ORDER BY c.name, m.name`,
    )
    .all(...args);
}

export function getMap(id) {
  return db
    .prepare(
      `SELECT m.*, c.name AS customer_name,
              v.major AS cur_major, v.minor AS cur_minor,
              v.storage_key AS cur_key, v.overrides_json AS cur_overrides,
              v.review_state AS cur_state,
              pv.storage_key AS pub_key, pv.major AS pub_major, pv.minor AS pub_minor,
              pv.overrides_json AS pub_overrides
         FROM map m
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN map_version v ON v.id = m.current_version_id
         LEFT JOIN map_version pv ON pv.id = m.published_version_id
        WHERE m.id = ?`,
    )
    .get(Number(id));
}

export function getMapBySlug(slug) {
  return db.prepare('SELECT * FROM map WHERE slug = ?').get(slug);
}

export function insertMap(m) {
  const info = db
    .prepare(
      `INSERT INTO map (customer_id, slug, name, kind, subject, request_note, requested_by, data_dir, outputs, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.customer_id != null ? Number(m.customer_id) : null,
      m.slug, m.name, m.kind || 'area', m.subject || null,
      m.request_note || null, m.requested_by != null ? Number(m.requested_by) : null,
      m.data_dir || '', JSON.stringify(m.outputs || {}), m.status || 'draft',
    );
  return Number(info.lastInsertRowid);
}

export function setMapStatus(mapId, status) {
  db.prepare('UPDATE map SET status = ? WHERE id = ?').run(status, Number(mapId));
}

/** Maps in one of the given statuses across all customers (admin request queue). */
export function listMapsByStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  if (!list.length) return [];
  const holes = list.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT m.*, c.name AS customer_name, u.email AS requested_by_email
         FROM map m
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN user u ON u.id = m.requested_by
        WHERE m.status IN (${holes})
        ORDER BY m.created_at DESC`,
    )
    .all(...list);
}

/**
 * Approved map requests that have not been built yet — the central pipeline's
 * build queue. `import-map.mjs --request <id>` fulfils one of these IN PLACE, so
 * the placeholder row BECOMES the built map (no duplicate row, quota counted once).
 */
export function listAwaitingBuild() {
  return db
    .prepare(
      `SELECT m.*, c.name AS customer_name, u.email AS requested_by_email
         FROM map m
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN user u ON u.id = m.requested_by
        WHERE m.status = 'approved' AND m.current_version_id IS NULL
        ORDER BY m.created_at ASC`,
    )
    .all();
}

/**
 * Whitelisted identity update, used by the importer when it fulfils an approved
 * request and the built map needs a different slug/name/subject from the asked-for
 * one. Nothing else about the row (owner, kind, quota) is touchable here.
 */
export function updateMapIdentity(id, f) {
  const sets = [], args = [];
  if (f.slug) { sets.push('slug = ?'); args.push(String(f.slug)); }
  if (f.name) { sets.push('name = ?'); args.push(String(f.name)); }
  if (f.subject !== undefined) { sets.push('subject = ?'); args.push(f.subject == null ? null : String(f.subject)); }
  if (!sets.length) return false;
  args.push(Number(id));
  db.prepare(`UPDATE map SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return true;
}

/**
 * How many maps of each kind a customer currently holds against quota.
 * Archived maps (rejected/withdrawn requests) do NOT count.
 * @returns {{ area:number, place:number }}
 */
export function quotaUsage(customerId) {
  const rows = db
    .prepare(`SELECT kind, COUNT(*) AS c FROM map WHERE customer_id = ? AND status <> 'archived' GROUP BY kind`)
    .all(Number(customerId));
  const usage = { area: 0, place: 0 };
  for (const r of rows) if (r.kind in usage) usage[r.kind] = r.c;
  return usage;
}

export function setMapOutputs(mapId, outputs) {
  db.prepare('UPDATE map SET outputs = ? WHERE id = ?').run(JSON.stringify(outputs || {}), Number(mapId));
}

/**
 * P8: the "changes coming" banner shown above the public map image.
 * source is 'auto' (scripts/check-upcoming-refreshes.mjs, from the GTFS upcoming-
 * changes scan) or 'manual' (admin/customer edited the wording). An auto write
 * never overwrites an existing manual note — see setMapBannerNoteAuto.
 */
export function setMapBannerNote(mapId, note, source = 'manual') {
  db.prepare(
    "UPDATE map SET banner_note = ?, banner_note_source = ?, banner_note_set_at = datetime('now') WHERE id = ?",
  ).run(note ? String(note) : null, source === 'auto' ? 'auto' : 'manual', Number(mapId));
}

/** Auto-suggest from the GTFS scan: skip maps whose current note was manually edited. */
export function setMapBannerNoteAuto(mapId, note) {
  const row = db.prepare('SELECT banner_note_source FROM map WHERE id = ?').get(Number(mapId));
  if (row && row.banner_note_source === 'manual') return false;
  setMapBannerNote(mapId, note, 'auto');
  return true;
}

/** Cleared once a rebuild is presumed to reflect the change the banner warned about. */
export function clearMapBannerNote(mapId) {
  db.prepare(
    "UPDATE map SET banner_note = NULL, banner_note_source = 'auto', banner_note_set_at = NULL WHERE id = ?",
  ).run(Number(mapId));
}

export function countMapsByKind(customerId) {
  return db
    .prepare(`SELECT kind, COUNT(*) AS c FROM map WHERE customer_id = ? GROUP BY kind`)
    .all(Number(customerId))
    .reduce((acc, r) => ((acc[r.kind] = r.c), acc), {});
}

/** Next version number: first is 1.0, later saves bump the minor (major bumps are for data refreshes, P5). */
export function nextVersion(mapId) {
  const row = db
    .prepare('SELECT major, minor FROM map_version WHERE map_id = ? ORDER BY major DESC, minor DESC LIMIT 1')
    .get(Number(mapId));
  if (!row) return { major: 1, minor: 0 };
  return { major: row.major, minor: row.minor + 1 };
}

/** Next MAJOR version (x.0) — used when a monthly data refresh is accepted (P5). */
export function nextMajorVersion(mapId) {
  const row = db.prepare('SELECT MAX(major) AS m FROM map_version WHERE map_id = ?').get(Number(mapId));
  return { major: (row && row.m ? row.m : 0) + 1, minor: 0 };
}

export function insertVersion(v) {
  const info = db
    .prepare(
      `INSERT INTO map_version (map_id, major, minor, note, overrides_json, storage_key, data_change_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(v.map_id),
      v.major,
      v.minor,
      v.note || null,
      JSON.stringify(v.overrides || {}),
      v.storage_key,
      v.data_change ? JSON.stringify(v.data_change) : null,
    );
  return Number(info.lastInsertRowid);
}

/**
 * The data refreshes carried by the versions a map has saved SINCE the one it
 * published — i.e. what a reviewer would be signing off beyond the customer's own
 * edits. Oldest first, so several months' accepted updates read as a sequence.
 * `sinceVersionId` null (nothing published yet) ⇒ every refresh this map has taken.
 * `untilVersionId` bounds the far end, so a review screen describes the version that
 * was SUBMITTED and not whatever the editor has saved since.
 * @returns {Array<{version:string, createdAt:string, note:string|null, sourceNote:string, summary:object}>}
 */
export function dataChangesSince(mapId, sinceVersionId = null, untilVersionId = null) {
  const rows = db.prepare(
    `SELECT id, storage_key, created_at, note, data_change_json
       FROM map_version
      WHERE map_id = ? AND data_change_json IS NOT NULL AND id > ? AND (? = 0 OR id <= ?)
      ORDER BY id ASC`,
  ).all(Number(mapId), Number(sinceVersionId || 0), Number(untilVersionId || 0), Number(untilVersionId || 0));
  return rows.map((r) => {
    let d = {};
    try { d = JSON.parse(r.data_change_json || '{}') || {}; } catch { d = {}; }
    return {
      version: r.storage_key, createdAt: r.created_at, note: r.note || null,
      sourceNote: d.sourceNote || '', summary: d.summary || {},
    };
  });
}

export function setCurrentVersion(mapId, versionId) {
  db.prepare('UPDATE map SET current_version_id = ? WHERE id = ?').run(Number(versionId), Number(mapId));
}

export function setMapDataDir(mapId, dir) {
  db.prepare('UPDATE map SET data_dir = ? WHERE id = ?').run(dir, Number(mapId));
}

// `overrides_json` rides along so the editor's version list can offer "copy
// these settings into a new draft" (findings H8) without a second query.
export function listVersions(mapId) {
  return db
    .prepare(
      `SELECT id, major, minor, note, storage_key, review_state, created_at, overrides_json
         FROM map_version WHERE map_id = ? ORDER BY major DESC, minor DESC`,
    )
    .all(Number(mapId));
}

export function getVersion(mapId, storageKey) {
  return db
    .prepare('SELECT * FROM map_version WHERE map_id = ? AND storage_key = ?')
    .get(Number(mapId), storageKey);
}

export function getVersionById(id) {
  return db.prepare('SELECT * FROM map_version WHERE id = ?').get(Number(id));
}

// ---------------------------------------------------------------------------
// Publish gate (P4): per-version review state, the public-current pointer,
// publish requests (review workflow), and the append-only audit log.
// ---------------------------------------------------------------------------

export function setVersionState(versionId, state) {
  db.prepare('UPDATE map_version SET review_state = ? WHERE id = ?').run(state, Number(versionId));
}

/** Point the map at its published version (the public-current pointer). */
export function setPublishedVersion(mapId, versionId) {
  db.prepare('UPDATE map SET published_version_id = ? WHERE id = ?')
    .run(versionId != null ? Number(versionId) : null, Number(mapId));
}

export function insertPublishRequest(r) {
  const info = db
    .prepare('INSERT INTO publish_request (map_id, version_id, requested_by, note) VALUES (?, ?, ?, ?)')
    .run(Number(r.map_id), Number(r.version_id), r.requested_by != null ? Number(r.requested_by) : null, r.note || null);
  return Number(info.lastInsertRowid);
}

/** The one open (pending) publish request for a map, if any. */
export function getOpenRequestForMap(mapId) {
  return db.prepare("SELECT * FROM publish_request WHERE map_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(Number(mapId));
}

/** A publish request joined to its map, version and people (for the review UI). */
export function getPublishRequest(id) {
  return db
    .prepare(
      `SELECT pr.*, m.name AS map_name, m.slug AS map_slug, m.kind AS map_kind, m.subject AS map_subject,
              m.customer_id, m.published_version_id, c.name AS customer_name,
              v.storage_key AS version_key, v.major AS version_major, v.minor AS version_minor,
              v.overrides_json AS version_overrides, v.note AS version_note,
              ru.email AS requested_by_email, au.email AS reviewed_by_email
         FROM publish_request pr
         JOIN map m ON m.id = pr.map_id
         JOIN map_version v ON v.id = pr.version_id
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN user ru ON ru.id = pr.requested_by
         LEFT JOIN user au ON au.id = pr.reviewed_by
        WHERE pr.id = ?`,
    )
    .get(Number(id));
}

/** All pending publish requests across customers (the approver's review queue). */
export function listPendingPublishRequests() {
  return db
    .prepare(
      `SELECT pr.id, pr.created_at, pr.note, pr.map_id, pr.version_id,
              m.name AS map_name, m.kind AS map_kind, m.subject AS map_subject,
              c.name AS customer_name, v.storage_key AS version_key,
              ru.email AS requested_by_email
         FROM publish_request pr
         JOIN map m ON m.id = pr.map_id
         JOIN map_version v ON v.id = pr.version_id
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN user ru ON ru.id = pr.requested_by
        WHERE pr.status = 'pending'
        ORDER BY pr.created_at ASC`,
    )
    .all();
}

export function decidePublishRequest(id, { status, reviewedBy, decisionNote, evidence }) {
  db.prepare(
    `UPDATE publish_request
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
            decision_note = ?, evidence_json = ?
      WHERE id = ?`,
  ).run(
    status,
    reviewedBy != null ? Number(reviewedBy) : null,
    decisionNote || null,
    JSON.stringify(evidence || {}),
    Number(id),
  );
}

export function withdrawPublishRequest(id) {
  db.prepare("UPDATE publish_request SET status = 'withdrawn', reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'").run(Number(id));
}

/** Publish-request history for one map (newest first). */
export function listPublishRequestsForMap(mapId) {
  return db
    .prepare(
      `SELECT pr.id, pr.created_at, pr.status, pr.note, pr.decision_note, pr.reviewed_at,
              v.storage_key AS version_key, ru.email AS requested_by_email, au.email AS reviewed_by_email
         FROM publish_request pr
         JOIN map_version v ON v.id = pr.version_id
         LEFT JOIN user ru ON ru.id = pr.requested_by
         LEFT JOIN user au ON au.id = pr.reviewed_by
        WHERE pr.map_id = ?
        ORDER BY pr.id DESC`,
    )
    .all(Number(mapId));
}

/**
 * Every version of a map that has EVER been published, newest publication first.
 * Publishing only ever happens through an approved publish_request, so that table
 * is the record of publication history — a version reverted away from keeps its
 * row here, which is exactly what "roll back to a known-good version" needs.
 * @returns rows of { version_id, storage_key, major, minor, published_at, approver, decision_note, is_current }
 */
export function listPublishedHistory(mapId) {
  return db
    .prepare(
      // One row per version: MAX(pr.id) picks its LATEST publication, and SQLite's
      // bare-column rule makes the other pr.* columns come from that same row.
      `SELECT v.id AS version_id, v.storage_key, v.major, v.minor, v.review_state,
              MAX(pr.id) AS request_id, pr.reviewed_at AS published_at, pr.decision_note,
              au.email AS approver_email,
              CASE WHEN m.published_version_id = v.id THEN 1 ELSE 0 END AS is_current
         FROM publish_request pr
         JOIN map_version v ON v.id = pr.version_id
         JOIN map m ON m.id = pr.map_id
         LEFT JOIN user au ON au.id = pr.reviewed_by
        WHERE pr.map_id = ? AND pr.status = 'approved'
        GROUP BY v.id
        ORDER BY request_id DESC`,
    )
    .all(Number(mapId));
}

/** Maps that currently have a published version (the rollback picker's list). */
export function listPublishedMaps() {
  return db
    .prepare(
      `SELECT m.id, m.name, m.slug, m.kind, m.subject, m.public_listed, m.customer_id,
              c.name AS customer_name, c.status AS customer_status,
              pv.storage_key AS pub_key, pv.id AS pub_version_id,
              (SELECT COUNT(DISTINCT pr.version_id) FROM publish_request pr
                WHERE pr.map_id = m.id AND pr.status = 'approved') AS published_versions
         FROM map m
         JOIN map_version pv ON pv.id = m.published_version_id
         LEFT JOIN customer c ON c.id = m.customer_id
        WHERE m.status <> 'archived'
        ORDER BY c.name, m.name`,
    )
    .all();
}

export function recordAudit({ actorId, actorEmail, action, mapId, versionId, detail }) {
  db.prepare(
    'INSERT INTO audit_log (actor_id, actor_email, action, map_id, version_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    actorId != null ? Number(actorId) : null,
    actorEmail || null,
    action,
    mapId != null ? Number(mapId) : null,
    versionId != null ? Number(versionId) : null,
    JSON.stringify(detail || {}),
  );
}

export function listAudit({ limit = 200 } = {}) {
  return db
    .prepare(
      `SELECT a.*, m.name AS map_name
         FROM audit_log a
         LEFT JOIN map m ON m.id = a.map_id
        ORDER BY a.id DESC
        LIMIT ?`,
    )
    .all(Math.max(1, Math.min(1000, Number(limit) | 0)));
}

// ---------------------------------------------------------------------------
// Proposed updates (P5): a staged monthly data refresh awaiting the customer's
// accept/decline. At most one is 'pending' per map (a newer refresh supersedes
// an older pending one).
// ---------------------------------------------------------------------------

export function insertProposedUpdate(p) {
  const info = db
    .prepare('INSERT INTO proposed_update (map_id, source_note) VALUES (?, ?)')
    .run(Number(p.map_id), p.source_note || null);
  return Number(info.lastInsertRowid);
}

export function getProposedUpdate(id) {
  return db.prepare('SELECT * FROM proposed_update WHERE id = ?').get(Number(id));
}

/** The one open (pending) proposed update for a map, if any. */
export function getOpenProposedForMap(mapId) {
  return db
    .prepare("SELECT * FROM proposed_update WHERE map_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
    .get(Number(mapId));
}

/** Mark every still-pending proposed update for a map as superseded (a newer refresh arrived). */
export function supersedePendingProposed(mapId) {
  db.prepare("UPDATE proposed_update SET status = 'superseded', reviewed_at = datetime('now') WHERE map_id = ? AND status = 'pending'")
    .run(Number(mapId));
}

export function setProposedDataDir(id, dir) {
  db.prepare('UPDATE proposed_update SET data_dir = ? WHERE id = ?').run(dir, Number(id));
}

export function setProposedSummary(id, summary) {
  db.prepare('UPDATE proposed_update SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary || {}), Number(id));
}

export function decideProposedUpdate(id, { status, reviewedBy, decisionNote, acceptedVersionId = null }) {
  db.prepare(
    `UPDATE proposed_update
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
            decision_note = ?, accepted_version_id = ?
      WHERE id = ?`,
  ).run(
    status,
    reviewedBy != null ? Number(reviewedBy) : null,
    decisionNote || null,
    acceptedVersionId != null ? Number(acceptedVersionId) : null,
    Number(id),
  );
}

/** Proposed-update history for one map (newest first). */
export function listProposedForMap(mapId) {
  return db
    .prepare(
      `SELECT pu.id, pu.created_at, pu.status, pu.source_note, pu.decision_note, pu.reviewed_at,
              u.email AS reviewed_by_email, v.storage_key AS accepted_version_key
         FROM proposed_update pu
         LEFT JOIN user u ON u.id = pu.reviewed_by
         LEFT JOIN map_version v ON v.id = pu.accepted_version_id
        WHERE pu.map_id = ?
        ORDER BY pu.id DESC`,
    )
    .all(Number(mapId));
}

/**
 * Maps whose editing head is ahead of what the public is served, with nothing
 * in flight to move it: no pending publish request, no pending update to accept.
 *
 * This is the state findings B5 calls invisible. Every other queue in the portal
 * is defined by somebody being blocked, and a draft nobody has sent blocks
 * nobody — so eight live maps sat in it for a day with the worklist reporting
 * "nothing waiting". It is a query over state the database already holds, not a
 * new flag: current_version_id ≠ published_version_id, no open request.
 *
 * `since` is the draft's own creation time, so the item can age like the rest.
 * Maps not yet built (no current version) are excluded — they are the build
 * queue's business, and archived maps are nobody's.
 */
export function listUnsubmittedDrafts() {
  return db
    .prepare(
      `SELECT m.id, m.name, m.slug, m.kind, m.status,
              c.name AS customer_name,
              v.storage_key AS draft_key, v.created_at AS draft_at, v.review_state AS draft_state,
              pv.storage_key AS published_key
         FROM map m
         JOIN map_version v ON v.id = m.current_version_id
         LEFT JOIN map_version pv ON pv.id = m.published_version_id
         LEFT JOIN customer c ON c.id = m.customer_id
        WHERE m.status <> 'archived'
          AND (m.published_version_id IS NULL OR m.published_version_id <> m.current_version_id)
          AND NOT EXISTS (SELECT 1 FROM publish_request pr WHERE pr.map_id = m.id AND pr.status = 'pending')
          AND NOT EXISTS (SELECT 1 FROM proposed_update pu WHERE pu.map_id = m.id AND pu.status = 'pending')
        ORDER BY v.created_at ASC`,
    )
    .all();
}

/** All pending proposed updates across customers (admin visibility of the refresh queue). */
export function listPendingProposedUpdates() {
  return db
    .prepare(
      `SELECT pu.id, pu.created_at, pu.source_note, pu.summary_json, pu.map_id,
              m.name AS map_name, m.kind AS map_kind, m.subject AS map_subject,
              c.name AS customer_name
         FROM proposed_update pu
         JOIN map m ON m.id = pu.map_id
         LEFT JOIN customer c ON c.id = m.customer_id
        WHERE pu.status = 'pending'
        ORDER BY pu.created_at ASC`,
    )
    .all();
}

// ---------------------------------------------------------------------------
// Customers, users, sessions, magic links (P2 auth + multi-tenancy)
// ---------------------------------------------------------------------------

export function insertCustomer(c) {
  const info = db
    .prepare(
      `INSERT INTO customer (name, type, status, plan, quota_areas, quota_places, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.name, c.type || 'other', c.status || 'active', c.plan || 'free',
      c.quota_areas != null ? c.quota_areas : 1,
      c.quota_places != null ? c.quota_places : 3,
      c.is_demo ? 1 : 0,
    );
  const id = Number(info.lastInsertRowid);
  ensureCustomerSlug(id, c.name); // P6: public organisation page /o/<slug>
  return id;
}
export function getCustomer(id) {
  return db.prepare('SELECT * FROM customer WHERE id = ?').get(Number(id));
}
/** Flag (or unflag) a customer as seeded demo data rather than a real one. */
export function setCustomerDemo(id, isDemo) {
  db.prepare('UPDATE customer SET is_demo = ? WHERE id = ?').run(isDemo ? 1 : 0, Number(id));
}
export function getCustomerByName(name) {
  return db.prepare('SELECT * FROM customer WHERE name = ?').get(name);
}
export function listCustomers() {
  return db.prepare('SELECT * FROM customer ORDER BY name').all();
}
/** Customers with user counts + non-archived map usage per kind (admin view). */
export function listCustomersAdmin() {
  return db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM user u WHERE u.customer_id = c.id)                          AS users,
              (SELECT COUNT(*) FROM map m WHERE m.customer_id = c.id AND m.kind='area'  AND m.status<>'archived') AS area_used,
              (SELECT COUNT(*) FROM map m WHERE m.customer_id = c.id AND m.kind='place' AND m.status<>'archived') AS place_used
         FROM customer c
        ORDER BY c.name`,
    )
    .all();
}
/** Whitelisted admin update of a customer's quota / status / plan. */
export function updateCustomerAdmin(id, f) {
  const sets = [], args = [];
  if (f.quota_areas != null) { sets.push('quota_areas = ?'); args.push(Math.max(0, Number(f.quota_areas) | 0)); }
  if (f.quota_places != null) { sets.push('quota_places = ?'); args.push(Math.max(0, Number(f.quota_places) | 0)); }
  if (f.status && ['active', 'suspended'].includes(f.status)) { sets.push('status = ?'); args.push(f.status); }
  if (f.plan) { sets.push('plan = ?'); args.push(String(f.plan).slice(0, 40)); }
  if (f.hide_operators_enabled != null) { sets.push('hide_operators_enabled = ?'); args.push(f.hide_operators_enabled ? 1 : 0); }
  if (f.watermark_enabled != null) { sets.push('watermark_enabled = ?'); args.push(f.watermark_enabled ? 1 : 0); }
  if (!sets.length) return false;
  args.push(Number(id));
  db.prepare(`UPDATE customer SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return true;
}

/** Counts for the admin console header. */
export function adminSummary() {
  const one = (sql, ...a) => db.prepare(sql).get(...a).c;
  return {
    pendingApplications: one("SELECT COUNT(*) AS c FROM application WHERE status = 'pending'"),
    pendingMapRequests: one("SELECT COUNT(*) AS c FROM map WHERE status = 'requested'"),
    // Approved requests the central pipeline still has to build + import.
    awaitingBuild: one("SELECT COUNT(*) AS c FROM map WHERE status = 'approved' AND current_version_id IS NULL"),
    pendingPublishRequests: one("SELECT COUNT(*) AS c FROM publish_request WHERE status = 'pending'"),
    pendingProposedUpdates: one("SELECT COUNT(*) AS c FROM proposed_update WHERE status = 'pending'"),
    customers: one('SELECT COUNT(*) AS c FROM customer'),
    newMessages: one("SELECT COUNT(*) AS c FROM message WHERE status = 'new'"),
  };
}

export function insertUser(u) {
  const info = db
    .prepare(`INSERT INTO user (customer_id, email, name, role, status) VALUES (?, ?, ?, ?, ?)`)
    .run(
      u.customer_id != null ? Number(u.customer_id) : null,
      String(u.email).toLowerCase(), u.name || null, u.role || 'editor', u.status || 'active',
    );
  return Number(info.lastInsertRowid);
}
export function getUser(id) {
  return db.prepare('SELECT * FROM user WHERE id = ?').get(Number(id));
}
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM user WHERE email = ?').get(String(email).toLowerCase());
}
export function listUsers() {
  return db
    .prepare('SELECT u.*, c.name AS customer_name FROM user u LEFT JOIN customer c ON c.id = u.customer_id ORDER BY u.email')
    .all();
}
/** Admin console listing, optionally scoped to one customer. */
export function listUsersAdmin(customerId) {
  if (customerId != null) {
    return db
      .prepare('SELECT u.*, c.name AS customer_name FROM user u LEFT JOIN customer c ON c.id = u.customer_id WHERE u.customer_id = ? ORDER BY u.email')
      .all(Number(customerId));
  }
  return listUsers();
}
const USER_ROLES = ['editor', 'approver', 'admin'];
const USER_STATUSES = ['active', 'disabled'];
/** Whitelisted admin update of a user's name / role / status. */
export function updateUserAdmin(id, f) {
  const sets = [], args = [];
  if (f.name != null) { sets.push('name = ?'); args.push(String(f.name).slice(0, 120) || null); }
  if (f.role && USER_ROLES.includes(f.role)) { sets.push('role = ?'); args.push(f.role); }
  if (f.status && USER_STATUSES.includes(f.status)) { sets.push('status = ?'); args.push(f.status); }
  if (f.customerId !== undefined) { sets.push('customer_id = ?'); args.push(f.customerId); }
  if (!sets.length) return false;
  args.push(Number(id));
  db.prepare(`UPDATE user SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return true;
}

export function insertSession(token, userId, expiresAt) {
  db.prepare('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, Number(userId), expiresAt);
}
export function getSession(token) {
  // returns the joined user row when the session is live, else undefined
  return db
    .prepare(
      `SELECT s.token, s.expires_at,
              u.id AS user_id, u.email, u.name, u.role, u.status, u.customer_id
         FROM session s JOIN user u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token);
}
export function deleteSession(token) {
  db.prepare('DELETE FROM session WHERE token = ?').run(token);
}
export function purgeExpiredSessions() {
  db.prepare("DELETE FROM session WHERE expires_at <= datetime('now')").run();
}

export function insertMagicLink(token, email, expiresAt) {
  db.prepare('INSERT INTO magic_link (token, email, expires_at) VALUES (?, ?, ?)').run(token, String(email).toLowerCase(), expiresAt);
}
export function consumeMagicLink(token) {
  // atomically mark a valid, unused, unexpired token as used; return its row or undefined
  const row = db
    .prepare("SELECT * FROM magic_link WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .get(token);
  if (!row) return undefined;
  db.prepare("UPDATE magic_link SET used_at = datetime('now') WHERE token = ?").run(token);
  return row;
}

export function authCounts() {
  return {
    customers: db.prepare('SELECT COUNT(*) AS c FROM customer').get().c,
    users: db.prepare('SELECT COUNT(*) AS c FROM user').get().c,
  };
}

// ---------------------------------------------------------------------------
// The public front (P6). These are the ONLY queries the unauthenticated site
// runs, and each one hard-codes the three conditions that make a map public:
//   • it has a published_version_id (the P4 review happened),
//   • its customer is 'active' (a suspended organisation disappears), and
//   • the customer has not un-listed it (map.public_listed).
// Drafts, pending versions, requested maps and every scrap of customer PII are
// unreachable from here by construction, not by filtering at the edge.
// ---------------------------------------------------------------------------

const PUBLIC_WHERE = `m.published_version_id IS NOT NULL
       AND m.public_listed = 1
       AND m.status <> 'archived'
       AND c.status = 'active'`;

const PUBLIC_COLUMNS = `m.id, m.slug, m.name, m.kind, m.subject, m.outputs,
              m.banner_note,
              c.id AS customer_id, c.name AS customer_name, c.type AS customer_type,
              c.slug AS customer_slug, c.branding_json, c.is_demo, c.watermark_enabled,
              pv.storage_key AS pub_key, pv.created_at AS published_at,
              pv.major AS pub_major, pv.minor AS pub_minor`;

/** Every publicly-visible map (newest publication first). */
export function listPublicMaps() {
  return db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}
         FROM map m
         JOIN customer c ON c.id = m.customer_id
         JOIN map_version pv ON pv.id = m.published_version_id
        WHERE ${PUBLIC_WHERE}
        ORDER BY pv.created_at DESC, m.name`,
    )
    .all();
}

/** One publicly-visible map by its slug, or undefined (never a draft-only map). */
export function getPublicMapBySlug(slug) {
  return db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}
         FROM map m
         JOIN customer c ON c.id = m.customer_id
         JOIN map_version pv ON pv.id = m.published_version_id
        WHERE ${PUBLIC_WHERE} AND m.slug = ?`,
    )
    .get(String(slug));
}

/** Organisations with at least one publicly-visible map. */
export function listPublicOrgs() {
  return db
    .prepare(
      `SELECT c.id, c.name, c.type, c.slug, c.branding_json, c.is_demo,
              COUNT(*) AS public_maps
         FROM map m
         JOIN customer c ON c.id = m.customer_id
         JOIN map_version pv ON pv.id = m.published_version_id
        WHERE ${PUBLIC_WHERE}
        GROUP BY c.id
        ORDER BY c.name`,
    )
    .all();
}

/** One organisation by its public slug (any status — the caller checks). */
export function getCustomerBySlug(slug) {
  return db.prepare('SELECT * FROM customer WHERE slug = ?').get(String(slug));
}

/** Store an organisation's public branding (already sanitised by src/branding). */
export function setCustomerBranding(id, branding) {
  db.prepare('UPDATE customer SET branding_json = ? WHERE id = ?')
    .run(JSON.stringify(branding || {}), Number(id));
}

/** The customer's choice of whether their published map appears on the public site. */
export function setMapPublicListed(mapId, listed) {
  db.prepare('UPDATE map SET public_listed = ? WHERE id = ?').run(listed ? 1 : 0, Number(mapId));
}

/** Counts for the public site (and /health). */
export function publicCounts() {
  const one = (sql) => db.prepare(sql).get().c;
  return {
    publicMaps: one(`SELECT COUNT(*) AS c FROM map m JOIN customer c ON c.id = m.customer_id
                       JOIN map_version pv ON pv.id = m.published_version_id WHERE ${PUBLIC_WHERE}`),
    publicOrgs: one(`SELECT COUNT(DISTINCT c.id) AS c FROM map m JOIN customer c ON c.id = m.customer_id
                       JOIN map_version pv ON pv.id = m.published_version_id WHERE ${PUBLIC_WHERE}`),
  };
}
