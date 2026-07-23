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
})();

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
    .prepare(`INSERT INTO message (kind, name, email, body) VALUES (?, ?, ?, ?)`)
    .run(m.kind || 'enquiry', m.name || null, m.email || null, m.body);
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

// --- messages (P3 admin read-only view) ---
export function listMessages() {
  return db.prepare('SELECT * FROM message ORDER BY created_at DESC').all();
}

export function counts() {
  return {
    applications: db.prepare('SELECT COUNT(*) AS c FROM application').get().c,
    messages: db.prepare('SELECT COUNT(*) AS c FROM message').get().c,
    maps: db.prepare('SELECT COUNT(*) AS c FROM map').get().c,
    publishRequests: db.prepare('SELECT COUNT(*) AS c FROM publish_request').get().c,
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
              (SELECT COUNT(*) FROM publish_request pr WHERE pr.map_id = m.id AND pr.status = 'pending') AS pending_reviews
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

export function insertVersion(v) {
  const info = db
    .prepare(
      `INSERT INTO map_version (map_id, major, minor, note, overrides_json, storage_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(v.map_id),
      v.major,
      v.minor,
      v.note || null,
      JSON.stringify(v.overrides || {}),
      v.storage_key,
    );
  return Number(info.lastInsertRowid);
}

export function setCurrentVersion(mapId, versionId) {
  db.prepare('UPDATE map SET current_version_id = ? WHERE id = ?').run(Number(versionId), Number(mapId));
}

export function setMapDataDir(mapId, dir) {
  db.prepare('UPDATE map SET data_dir = ? WHERE id = ?').run(dir, Number(mapId));
}

export function listVersions(mapId) {
  return db
    .prepare(
      `SELECT id, major, minor, note, storage_key, review_state, created_at
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
// publish requests (sign-off workflow), and the append-only audit log.
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
// Customers, users, sessions, magic links (P2 auth + multi-tenancy)
// ---------------------------------------------------------------------------

export function insertCustomer(c) {
  const info = db
    .prepare(
      `INSERT INTO customer (name, type, status, plan, quota_areas, quota_places)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.name, c.type || 'other', c.status || 'active', c.plan || 'free',
      c.quota_areas != null ? c.quota_areas : 1,
      c.quota_places != null ? c.quota_places : 3,
    );
  return Number(info.lastInsertRowid);
}
export function getCustomer(id) {
  return db.prepare('SELECT * FROM customer WHERE id = ?').get(Number(id));
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
    pendingPublishRequests: one("SELECT COUNT(*) AS c FROM publish_request WHERE status = 'pending'"),
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
