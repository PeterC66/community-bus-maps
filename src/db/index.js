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

export function counts() {
  return {
    applications: db.prepare('SELECT COUNT(*) AS c FROM application').get().c,
    messages: db.prepare('SELECT COUNT(*) AS c FROM message').get().c,
    maps: db.prepare('SELECT COUNT(*) AS c FROM map').get().c,
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
              v.major AS cur_major, v.minor AS cur_minor, v.storage_key AS cur_key
         FROM map m
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN map_version v ON v.id = m.current_version_id
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
              v.storage_key AS cur_key, v.overrides_json AS cur_overrides
         FROM map m
         LEFT JOIN customer c ON c.id = m.customer_id
         LEFT JOIN map_version v ON v.id = m.current_version_id
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
      `INSERT INTO map (customer_id, slug, name, kind, subject, data_dir, outputs, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.customer_id != null ? Number(m.customer_id) : null,
      m.slug, m.name, m.kind || 'area', m.subject || null, m.data_dir,
      JSON.stringify(m.outputs || {}), m.status || 'draft',
    );
  return Number(info.lastInsertRowid);
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
      `SELECT id, major, minor, note, storage_key, created_at
         FROM map_version WHERE map_id = ? ORDER BY major DESC, minor DESC`,
    )
    .all(Number(mapId));
}

export function getVersion(mapId, storageKey) {
  return db
    .prepare('SELECT * FROM map_version WHERE map_id = ? AND storage_key = ?')
    .get(Number(mapId), storageKey);
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
