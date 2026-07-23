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
-- P1 — editor spine. One editable map, versioned, rendered on save.
-- (P2 adds customer_id / user auth / tenant isolation / output toggles;
--  these tables are deliberately shaped so that grows without a rewrite.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS map (
  id                  INTEGER PRIMARY KEY,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  slug                TEXT NOT NULL UNIQUE,          -- url-safe id, e.g. 'st-ives'
  name                TEXT NOT NULL,                 -- display name, e.g. 'St Ives'
  kind                TEXT NOT NULL DEFAULT 'area',  -- area | place
  subject             TEXT,                          -- town / parish / part-of-town / POI (free text)
  data_dir            TEXT NOT NULL,                 -- object-store folder for this map (under DATA_DIR, NOT in git)
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
