// SQLite via Node's built-in node:sqlite (no native build step).
// The DB file lives under DATA_DIR (git-ignored) — never in the repo.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..'); // repo root — keeps data location cwd-independent
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
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
  };
}
