-- Minimal P0 schema: the two things the public shopfront produces.
-- (Full customer/map/version/approval model arrives with the authenticated app.)

CREATE TABLE IF NOT EXISTS application (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  org_name      TEXT NOT NULL,
  org_type      TEXT NOT NULL,           -- council | shop | business | school | function-organiser | charity-nt | other
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  website       TEXT,
  wants         TEXT,                     -- free text: which area + which places they'd like
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'  -- pending | approved | rejected
);

CREATE TABLE IF NOT EXISTS message (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  kind          TEXT NOT NULL DEFAULT 'enquiry',  -- enquiry | question | feedback
  name          TEXT,
  email         TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new'       -- new | read | answered
);

-- ---------------------------------------------------------------------------
-- P2 — customers, users, passwordless sessions. Maps gain an owner (customer_id)
-- and an output set. Tenant isolation is enforced in code: every map/version/
-- render access is scoped by customer_id (admins excepted).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'other',   -- council|shop|business|school|function-organiser|charity-nt|other
  status        TEXT NOT NULL DEFAULT 'active',  -- active|suspended
  plan          TEXT NOT NULL DEFAULT 'free',    -- dormant (payments off until later)
  quota_areas   INTEGER NOT NULL DEFAULT 1,      -- how many area maps this customer may hold
  quota_places  INTEGER NOT NULL DEFAULT 3,      -- how many place maps
  branding_json TEXT NOT NULL DEFAULT '{}'       -- logo/colours (dormant until P6)
);

CREATE TABLE IF NOT EXISTS user (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  customer_id   INTEGER REFERENCES customer(id), -- NULL = platform admin (not tied to one customer)
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'editor',  -- editor|approver|admin
  status        TEXT NOT NULL DEFAULT 'active'   -- active|disabled
);

-- Server-side sessions: the cookie holds only an opaque random token.
CREATE TABLE IF NOT EXISTS session (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Single-use, short-lived passwordless sign-in tokens (the "magic link").
CREATE TABLE IF NOT EXISTS magic_link (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- ---------------------------------------------------------------------------
-- P1 — editor spine. One editable map, versioned, rendered on save.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS map (
  id                  INTEGER PRIMARY KEY,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  customer_id         INTEGER REFERENCES customer(id), -- owner (P2). NULL only for legacy/admin-held maps.
  slug                TEXT NOT NULL UNIQUE,          -- url-safe id, e.g. 'st-ives'
  name                TEXT NOT NULL,                 -- display name, e.g. 'St Ives'
  kind                TEXT NOT NULL DEFAULT 'area',  -- area | place
  subject             TEXT,                          -- town / parish / part-of-town / POI (free text)
  data_dir            TEXT NOT NULL,                 -- object-store folder for this map (under DATA_DIR, NOT in git)
  outputs             TEXT NOT NULL DEFAULT '{}',    -- JSON: which of the 4 outputs this map produces (P2 toggles)
  status              TEXT NOT NULL DEFAULT 'draft', -- requested|approved|building|draft|published|archived (P1: draft)
  current_version_id  INTEGER REFERENCES map_version(id)  -- latest rendered version (the one shown/downloaded)
);

CREATE TABLE IF NOT EXISTS map_version (
  id              INTEGER PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  map_id          INTEGER NOT NULL REFERENCES map(id),
  major           INTEGER NOT NULL,
  minor           INTEGER NOT NULL,
  note            TEXT,                     -- what changed (customer's save note)
  overrides_json  TEXT NOT NULL DEFAULT '{}', -- the safe-subset overrides snapshot for this version
  storage_key     TEXT NOT NULL,            -- render folder name under maps/<id>/renders/, e.g. 'v1.0'
  UNIQUE (map_id, major, minor)
);
