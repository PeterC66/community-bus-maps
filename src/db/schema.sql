-- Minimal P0 schema: the two things the public shopfront produces.
-- (Full customer/map/version/approval model arrives with the authenticated app.)

CREATE TABLE IF NOT EXISTS application (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  org_name      TEXT NOT NULL,
  org_type      TEXT NOT NULL,           -- one of ORG_TYPES in src/server.js: the five pain-point
                                          -- classes (authority-council | healthcare-campus |
                                          -- business-park | bid-tourism | operator-ct | other),
                                          -- plus the original values still held by older rows
                                          -- (council | shop | business | school |
                                          -- function-organiser | charity-nt)
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  website       TEXT,
  wants         TEXT,                     -- free text: which area + which places they'd like
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_at   TEXT,                     -- when an admin approved/rejected it (P3)
  customer_id   INTEGER                   -- the customer created on approval (P3); NULL until then
);

CREATE TABLE IF NOT EXISTS message (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  kind          TEXT NOT NULL DEFAULT 'enquiry',  -- enquiry | question | feedback (the three
                                                  -- the public contact form may set, MSG_KINDS
                                                  -- in src/server.js), plus two kinds only server
                                                  -- code ever writes: 'diagram-request' (a signed-in
                                                  -- customer asking for the hand-finished diagram)
                                                  -- and 'refresh-flag' (scripts/check-upcoming-
                                                  -- refreshes.mjs flagging a map whose town/place
                                                  -- has upcoming GTFS changes)
  name          TEXT,
  email         TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',      -- new | read | answered
  map_id        INTEGER                            -- P6: set when the message came from a public map page
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
  branding_json TEXT NOT NULL DEFAULT '{}',      -- P6: public-facing branding (public name, website, blurb, emoji, accent)
  slug          TEXT,                             -- P6: url-safe id for the public organisation page /o/<slug>
  is_demo       INTEGER NOT NULL DEFAULT 0,       -- seeded demo organisation, not a real customer (labelled everywhere)
  hide_operators_enabled INTEGER NOT NULL DEFAULT 0,  -- opt-in: may this customer hide an operator's routes in Map Tuning? default off
  watermark_enabled INTEGER NOT NULL DEFAULT 1     -- opt-out: stamp a "BusMaps.uk" watermark on JPG downloads by anyone who
                                                    -- is not this customer (or an admin)? default ON, admin may switch off per customer
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

-- Server-side sessions: the cookie holds an opaque random token, and this table
-- holds only its SHA-256.
--
-- WHY THE COLUMN IS STILL CALLED `token` (2026-08-25, technical-audit_2026-08-25
-- N3). Until that date it held the token itself, so this table was a live cookie
-- for every signed-in user — and scripts/backup.mjs copies the database
-- unencrypted to a laptop where the copies are kept. Storing the hash and
-- looking up by hash leaves the token in the cookie and the email only, and
-- makes a stolen backup inert.
--
-- The column was NOT renamed to `token_hash`, deliberately. docs/DEPLOY.md
-- promises a rollback to the previous release and rests it on the property that
-- "the older code's SELECT * tolerates an unknown column" — but a RENAME does
-- not leave an unknown column, it leaves a MISSING one, and the previous
-- release's `WHERE s.token = ?` would throw on every request to /api/, /app,
-- /auth/ and /metrics: a total outage at the exact moment you are rolling back.
-- Leaving the name alone degrades gently instead — old code compares a raw
-- cookie against a hash, matches nothing, and everyone signs in again. Every
-- SELECT in db/index.js aliases it to `token_hash`, so no JavaScript ever holds
-- a field called `token` that is not one.
--
-- IF YOU MEET `Error: no such column: token` ON BOOT, this is the reason. An
-- intermediate state of that 2026-08-25 work DID rename the column, and a local
-- dev database created while it existed keeps `session(token_hash)` for ever —
-- the rename is not undone by any migration, because the released code never
-- made it. hashStoredTokens() then dies inside migrate() and takes the whole
-- boot with it, with an error that names neither the table nor the fix. Found
-- and repaired on 2026-08-27:
--
--   ALTER TABLE session RENAME COLUMN token_hash TO token;
--
-- The stored values need nothing done to them; they are already sha256 hex. The
-- crash is deliberate and stays — a genuinely missing column must not be
-- shrugged off — so the cure is to say plainly what it means, here, where
-- somebody grepping the column name will land.
CREATE TABLE IF NOT EXISTS session (
  token       TEXT PRIMARY KEY,   -- sha256(session token), lowercase hex. See above.
  user_id     INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Single-use, short-lived passwordless sign-in tokens (the "magic link").
-- `token` holds sha256(link token) for the same reason and with the same naming
-- caveat as `session` above. Fifteen minutes is still a window, and a used row
-- stays in this table indefinitely.
CREATE TABLE IF NOT EXISTS magic_link (
  token       TEXT PRIMARY KEY,   -- sha256(magic-link token), lowercase hex. See above.
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
  request_note        TEXT,                          -- what the customer asked for when requesting the map (P3)
  data_dir            TEXT NOT NULL DEFAULT '',       -- object-store folder (under DATA_DIR, NOT in git); '' until built
  requested_by        INTEGER REFERENCES user(id),   -- the user who requested it (P3)
  outputs             TEXT NOT NULL DEFAULT '{}',    -- JSON: which of the 4 outputs this map produces (P2 toggles)
  status              TEXT NOT NULL DEFAULT 'draft', -- requested|approved|building|draft|published|archived (P1: draft)
  current_version_id  INTEGER REFERENCES map_version(id),  -- latest rendered version (the working head shown in the editor)
  published_version_id INTEGER REFERENCES map_version(id),  -- P4: the public-current pointer (the signed-off version); NULL until first publish
  public_listed       INTEGER NOT NULL DEFAULT 1,    -- P6: show the published version on the public site (customer's choice)
  banner_note         TEXT,                          -- P8: "changes coming" banner shown above the public map image; NULL = no banner
  banner_note_source  TEXT NOT NULL DEFAULT 'auto',   -- auto (from the GTFS upcoming-changes scan) | manual (admin/customer edited the wording)
  banner_note_set_at  TEXT                            -- when the current banner_note was set
);

CREATE TABLE IF NOT EXISTS map_version (
  id              INTEGER PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  map_id          INTEGER NOT NULL REFERENCES map(id),
  major           INTEGER NOT NULL,
  minor           INTEGER NOT NULL,
  note            TEXT,                     -- what changed (customer's save note)
  overrides_json  TEXT NOT NULL DEFAULT '{}', -- the safe-subset overrides snapshot for this version
  data_change_json TEXT,                    -- P5: set when this version came from an ACCEPTED data refresh —
                                            -- { proposedId, sourceNote, summary } (routes/stops/descriptions/validity).
                                            -- NULL for a version the customer saved themselves. Without it the only
                                            -- diff on offer is the overrides one, which reports a refreshed map as
                                            -- unchanged (findings A1).
  storage_key     TEXT NOT NULL,            -- render folder name under maps/<id>/renders/, e.g. 'v1.0'
  review_state    TEXT NOT NULL DEFAULT 'draft', -- P4: draft|pending|published|superseded|rejected
  UNIQUE (map_id, major, minor)
);

-- ---------------------------------------------------------------------------
-- P4 — the publish gate. A saved version is a *draft* until a platform approver
-- signs it off (with recorded red-team evidence); publishing advances the map's
-- public-current pointer. Editors submit; approvers/admins decide.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS publish_request (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  map_id        INTEGER NOT NULL REFERENCES map(id),
  version_id    INTEGER NOT NULL REFERENCES map_version(id),
  requested_by  INTEGER REFERENCES user(id),      -- the editor who asked to publish
  note          TEXT,                              -- editor's "what changed / why publish"
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | withdrawn
  reviewed_by   INTEGER REFERENCES user(id),       -- the approver who decided
  reviewed_at   TEXT,
  decision_note TEXT,                              -- approver's sign-off note / rejection reason
  evidence_json TEXT NOT NULL DEFAULT '{}'         -- red-team evidence: sign-off checklist + change summary snapshot
);

-- ---------------------------------------------------------------------------
-- P5 — monthly change acceptance. The central pipeline (run expertly, elsewhere)
-- restages a map's data each month and offers it as a *proposed update*. The
-- customer reviews an old-vs-new preview and Accepts (re-applies their overrides
-- onto the fresh data as a new MAJOR version) or Declines. Only the review +
-- accept live in the portal; the data fetch/judgement stays central.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proposed_update (
  id                  INTEGER PRIMARY KEY,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  map_id              INTEGER NOT NULL REFERENCES map(id),
  source_note         TEXT,                             -- what this refresh is (e.g. 'BODS August 2026 refresh')
  data_dir            TEXT NOT NULL DEFAULT '',         -- staged payload under maps/<id>/proposed/<pid>/data (git-ignored); '' until staged
  summary_json        TEXT NOT NULL DEFAULT '{}',       -- deterministic data diff vs the map's current data (routes/stops/desc/validity)
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | superseded
  reviewed_by         INTEGER REFERENCES user(id),      -- the customer user who accepted/declined
  reviewed_at         TEXT,
  decision_note       TEXT,
  accepted_version_id INTEGER REFERENCES map_version(id) -- the vN.0 created on accept; NULL until accepted
);

-- ---------------------------------------------------------------------------
-- P6 — the public front. Nothing new is stored for the marketing pages: the
-- public site is a READ view over what the publish gate (P4) already decided.
-- The three additive columns are customer.slug + customer.branding_json (the
-- organisation's public identity) and map.public_listed (its choice to appear on
-- the public site at all), plus message.map_id so "report a problem" on a public
-- map page lands in the existing message table with its map attached.
-- ---------------------------------------------------------------------------

-- Append-only audit of governance actions (publish sign-off, plus the P3
-- application / map-request / customer actions). Never updated or deleted.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id    INTEGER REFERENCES user(id),   -- who did it (NULL = system)
  actor_email TEXT,                            -- denormalised so the trail survives user changes
  action      TEXT NOT NULL,                   -- e.g. version.submit | version.publish | version.reject | application.approve
  map_id      INTEGER,                         -- subject map (nullable)
  version_id  INTEGER,                         -- subject version (nullable)
  detail_json TEXT NOT NULL DEFAULT '{}'       -- structured extras (customer, quota, change summary, …)
);
