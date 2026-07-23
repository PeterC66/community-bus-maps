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
