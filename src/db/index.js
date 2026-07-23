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

export function listMaps() {
  return db
    .prepare(
      `SELECT m.*, v.major AS cur_major, v.minor AS cur_minor, v.storage_key AS cur_key
         FROM map m LEFT JOIN map_version v ON v.id = m.current_version_id
        ORDER BY m.name`,
    )
    .all();
}

export function getMap(id) {
  return db
    .prepare(
      `SELECT m.*, v.major AS cur_major, v.minor AS cur_minor,
              v.storage_key AS cur_key, v.overrides_json AS cur_overrides
         FROM map m LEFT JOIN map_version v ON v.id = m.current_version_id
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
      `INSERT INTO map (slug, name, kind, subject, data_dir, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(m.slug, m.name, m.kind || 'area', m.subject || null, m.data_dir, m.status || 'draft');
  return Number(info.lastInsertRowid);
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
