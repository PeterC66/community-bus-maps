# Changelog

Notable changes to Community Bus Maps. Loosely follows Keep a Changelog; dates are ISO (YYYY-MM-DD).

## [0.3.0-P3] — 2026-07-23

Phase **P3** — **onboarding + governance.** The public *apply* form from P0 now has the other half:
an admin reviews applications, approves one into a **customer + its first editor + a passwordless
invite**, and customers **request maps within a quota** that an admin approves or rejects. This closes
the first two of the three approval gates (organisation, map-request); the publish gate remains P4.

### Added
- **Admin console** (`/app/admin`, `public/app/admin.html` + `admin.js`) — admin-only (redirects
  non-admins; every `/api/admin/*` route re-checks the role). Four tabs with live count badges:
  - **Applications** — review the queue; **Approve** opens a dialog (editable area/place quota +
    editor name) that creates the `customer`, its first `editor` user, links the application to the
    customer, and issues a **passwordless invite** (printed to the server console; the link is also
    surfaced in the UI in dev so the whole loop is demoable without email). **Reject** marks it rejected.
  - **Map requests** — the pending-request queue; **Approve** accepts it (→ `approved`, queued for the
    central build) or **Reject** archives it (freeing the quota slot).
  - **Customers** — every customer with user count + live area/place usage, and **inline editing** of
    quotas, status, and the dormant `plan`.
  - **Messages** — read-only view of the P0 contact `message` table (previously write-only).
- **Customer map requests + quota** — the dashboard shows a **quota bar** (used / allowed per kind) and
  a **Request a map** dialog (area or place, name, subject, note). `POST /api/maps/request` enforces the
  quota **server-side** (a requested/approved/built map counts; archived does not) and creates the map in
  status `requested` with no object store yet. `GET /api/me` now returns quota usage.
- **Map lifecycle states surfaced** — non-editable maps (`requested` / `approved` / `building`) render
  as **status pills** on the dashboard instead of editor links, and opening one shows a friendly
  **"being prepared"** panel rather than empty controls. Editable maps (a rendered version exists) are
  unchanged.
- **Schema (additive + migrated)** — `application` gains `reviewed_at` + `customer_id` (the customer it
  became); `map` gains `request_note` + `requested_by`, and `data_dir` now defaults to `''` (a requested
  map has no store yet). A guarded migration adds all four columns to a pre-P3 DB, existing rows intact.
- **Demo seed** now also plants a **pending application** (Ramsey Town Council) and a **requested map**
  (St Ives Waitrose) so the approval and request queues are non-empty on first run. Idempotent.

### Verified (end-to-end, fresh server + demo seed, in-app browser)
- **Approve flow**: approving Ramsey with a custom **1 area / 2 place** quota created customer #3 + editor
  `clerk@ramsey-tc.example`, linked the application (`status=approved`, `customer_id=3`), surfaced the
  invite link, and dropped the pending count 1 → 0.
- **Map-request lifecycle**: the seeded St Ives Waitrose request approved → left the queue (`approved`).
- **Quota enforcement**: as the St Ives editor (area 1/1, place 1/4) an **area** request was **blocked**
  ("Your plan includes 1 area map and you already have 1"); a **place** request succeeded, incremented
  the bar to 2/4, and appeared as a *Requested* card.
- **Customers tab**: inline-editing St Ives's place quota 3 → 4 persisted.
- **Editor guard**: opening the approved-but-unbuilt map showed "Not built yet / being prepared", no
  controls.
- **Isolation intact (P2)**: the editor saw only its own maps; March (`/api/maps/2`) and every
  `/api/admin/*` route returned **403**. The admin saw all customers and both councils' maps.
- **Baselines still byte-identical**: St Ives + March re-imported and rendered v1.0 identical to the
  shipped figures (St Ives internal 471,569 B SVG / 1,172,380 B JPG). The built-map editor still loads
  (9 routes, 34 POIs, live preview, both output tabs).
- **Migration**: a synthetic pre-P3 DB gained all four columns on boot with its rows preserved; the P3
  DB helpers (quota, lifecycle, application review, customer admin, summary) unit-tested green.

### Lessons learned
- **Quota is server-enforced, and counts the right rows.** The check lives in `POST /api/maps/request`
  (never the client), and `quotaUsage` counts every non-`archived` map of a kind — so a *pending request*
  already consumes a slot (no request spam) and **rejecting frees it** (reject → `archived`). Draft,
  approved and building all count; only archived is free.
- **A requested map has no object store.** It's a DB row with `data_dir=''` and no version, so anything
  that reads the store (`readRoutesMeta`, `enumeratePois`, downloads) must no-op gracefully — they do
  (empty fallbacks), but the dashboard/editor gate on **"has a current version"** to decide editable vs
  "being prepared" rather than trusting status alone.
- **The invite is just a magic link.** Approval reuses `requestMagicLink` against the freshly-created
  active user — no separate invite token type. In dev the link is both logged and returned in the API
  response (gated on `EMAIL_PROVIDER` being unset); with a provider set it is only emailed.
- **`user.email` is UNIQUE**, so approval must refuse when the contact email already has an account
  (409) rather than let the insert throw — the one real edge in the approve path.
- **`<dialog>` needs no framework.** Both the request and approve modals are native `<dialog>` +
  `showModal()`; submitting programmatically in a test uses `dispatchEvent(new Event('submit'))`
  (`requestSubmit()` was not available in the in-app browser).
- **The place map request is lifecycle-only.** Approving St Ives Waitrose (a place) proves the request
  gate, but places still can't be *built* in the portal until the place engine is vendored (the standing
  P2 follow-up) — the two are independent.

## [0.2.0-P2] — 2026-07-23

Phase **P2** — **multi-customer, authenticated, isolated.** The editor spine from P1 becomes a real
two-sided service: organisations sign in passwordlessly, see only their own maps, and choose which
outputs each map produces. This is the demo cut (P0+P1+P2): an org logs in, opens its map, recolours a
route, re-renders, downloads — with every other org's data invisible and inaccessible.

### Added
- **Data model** (`schema.sql` + `src/db/index.js`): `customer` (type, status, dormant plan + quotas,
  branding), `user` (belongs to a customer; role editor/approver/admin; admins have no customer),
  `session` (opaque server-side token), `magic_link` (single-use, 15-min). `map` gains `customer_id`
  (owner) and `outputs` (which of the four outputs it produces). A guarded **migration** adds the two
  `map` columns to a pre-P2 DB without touching existing rows (verified on a synthetic P1 DB).
- **Passwordless magic-link auth** (`src/auth/index.js`, no new deps): request a link → it's printed to
  the **server console** in dev (a real email provider is a launch task) → `/auth/verify` consumes it and
  sets an **httpOnly, SameSite=Lax session cookie** holding only an opaque random token. Login/logout,
  `GET /api/me`, and a periodic expired-session purge.
- **Tenant isolation** — every `/api/maps*` route requires a session and is scoped by `customer_id`:
  non-admins can only list/open/preview/save/download/toggle **their own** maps; admins see all. Enforced
  server-side on every access vector (detail, preview, save, download, output PATCH).
- **Output toggles** (`src/maps/store.js` `OUTPUTS`, `PATCH /api/maps/:id/outputs`): a map's four outputs
  are modelled (geographic, external, octolinear schematic, tube-map diagram); the portal renders the two
  the vendored engine supports today and marks schematic/diagram "coming with expert styles". Preview,
  render and downloads all follow the enabled set; a map must keep ≥1 output on.
- **UI**: a login page; the dashboard + editor are auth-gated (redirect to login, user + sign-out in the
  header, admins get an "all maps" view labelled by customer); the editor gains an **Outputs** panel and
  builds its preview tabs dynamically from the enabled outputs.
- **Demo seed** (`scripts/seed-demo.mjs` + `import-map.mjs --customer`): sets up an admin, two demo
  councils each with an editor user, and imports their maps — a reproducible multi-tenant demo. Idempotent.

### Verified (end-to-end, fresh server + demo seed)
- **Isolation**: signed in as the St Ives editor, `/api/maps` returns only St Ives; March's detail,
  **preview and download all return 403**. Admin (Peter) sees both councils' maps and can open March.
- **Auth**: anon `/api/maps` → 401; magic-link request → console link → verify → session cookie → app;
  wrong/expired token → back to login with an error.
- **Output toggles**: turning external off persists and re-scopes preview/downloads; turning everything
  off is rejected (400); schematic/diagram show as unavailable.
- **Baselines still byte-identical**: St Ives and March both import + render v1.0 through the object store
  (St Ives all four artefacts identical to the shipped v6.6).
- **Migration**: a synthetic pre-P2 `map` table gains `customer_id`/`outputs` on boot, existing row intact.

### Lessons learned
- **Place maps don't fit the object-store model yet.** Area maps carry their generators per-map
  (`gen_internal.js`/`gen_external.js`), which the portal vendors — that's why St Ives/March "just work".
  **Place maps** (`make-place-bus-leaflet`) keep their *different* engine in the skill, not per-map, so a
  place render dir carries **no generators**; importing one produced an unrenderable map. The importer now
  **fails fast** when no portal generator is present, and the demo is area-maps-only until the place engine
  is vendored (its own follow-up, analogous to P1 for places).
- **SQLite datetime format matters for session expiry.** `datetime('now')` is `YYYY-MM-DD HH:MM:SS`;
  storing an ISO string (`…T…Z`) breaks the `expires_at > datetime('now')` string comparison (the `T`
  sorts after a space). Store expiries via `toISOString().slice(0,19).replace('T',' ')`.
- **`node:sqlite` enforces foreign keys** (seen again): deleting `map` while `map.current_version_id`
  points at a `map_version` fails; the demo re-seed wipes the DB file instead of DELETEing in-place.
- **No new deps for auth.** Cookies are hand-rolled and the session token is an opaque server-side key, so
  there's nothing to sign — `node:crypto` + a `session` table is enough. SameSite=Lax covers cross-site
  POST; a dedicated CSRF token is a later hardening item.
- **One SQLite writer.** The seed/import scripts and the dev server share `portal.sqlite`; run seeds with
  the server stopped (P2 has no job queue yet — that's P5's territory).

## [0.1.0-P1] — 2026-07-23

Phase **P1** — the **editor spine**. The bus-leaflet editor is re-homed behind the app as a
**server-enforced safe-subset editor**: an approved organisation opens a map, recolours a route or
shows/hides a landmark, previews the real render live, then **saves a numbered version** and
**downloads print-ready files** — end to end, no localhost tool, no AI.

### Added
- **Object store** (`src/maps/store.js`) — per-map folders under `DATA_DIR` (git-ignored):
  `maps/<id>/data/` (the map's generators + JSON inputs), `overrides.json` (canonical saved edits),
  `renders/v<maj>.<min>/` (four artefacts + `meta.json`). No `localhost:5179`, nothing in git.
- **Safe-subset gate** (`src/maps/safeSubset.js`) — the security boundary. Rebuilds overrides from
  scratch, keeping **only** `routeColors[route]` (recolour) and `internal.pois[key].hide` (toggle),
  validated against the map's palette + known POI keys; **everything expert-only (stops, align,
  rotation, viewport, panel, features, external layout, POI moves/labels) is dropped** no matter what
  the client sends. No-ops (a colour equal to the default, a visible POI) drop too, so an untouched
  map serialises to `{}` and stays byte-identical to baseline.
- **Engine wrapper** (`src/maps/engine.js`) — enumerate the editable routes + POIs (POIs read from a
  one-off `EDITOR_KEYS=1` render, so the toggle keys match exactly what the generator draws),
  `preview()` (SVGs only, nothing persisted), and `renderVersion()` (writes the version's SVG + print
  JPG, then commits the canonical `overrides.json`).
- **Map + version schema** (`map`, `map_version` in `schema.sql`; helpers in `src/db/index.js`) —
  versions are append-only (nothing deleted); shaped so P2's `customer_id` / auth / output-toggles
  grow in without a rewrite.
- **Editor API + UI** — `GET /api/maps`, `GET /api/maps/:id`, `POST …/preview`, `POST …/save`,
  `GET …/versions/:key/:file` (whitelisted `v<maj>.<min>` + known filenames; `?download` sets
  `Content-Disposition`). Served at `/app` (dashboard) and `/app/maps/:id` (the two-pane editor:
  colour pickers + grouped POI toggles on the left; live internal/external preview, save-note and
  print-ready downloads on the right; light/dark, responsive).
- **Importer** (`scripts/import-map.mjs`) — seeds one map from a staged Buses run dir and renders the
  baseline as **v1.0 with empty overrides** (i.e. byte-identical to the shipped leaflet). The minimal
  P1 seed; P2 generalises it to the multi-customer importer.
- `renderMap.generateSvg` gained an opt-in `editorKeys` flag (off by default → the P0 byte-identical
  baseline is untouched).

### Verified
- **Full round-trip on a fresh server**: recolour route 9 + hide Waitrose → live preview through the
  *real* generator (Waitrose gone from the SVG, route 9 redrawn) → **Save → v1.1** rendered (SVG +
  300 dpi JPG × internal/external) → downloads with correct headers. `overrides.json` held exactly the
  sanitised safe subset and nothing else.
- **Baseline stays byte-identical.** v1.0 rendered through the object-store path is **SHA-256-identical**
  to the shipped St Ives v6.6 (all four artefacts), while v1.1 correctly diverges — the P0 guarantee
  survives P1.
- **Safe-subset gate** unit-tested with a hostile payload (stops/align/rotation/panel/external/unknown
  routes/invalid hex/unknown POIs) → all stripped, only the two valid edits survived.
- Path-traversal / bad-version / unknown-file download requests → `400`.

### Lessons learned (read these before extending the build)
- **The object store is *inside* a `type: module` repo, so the CommonJS generators break there.**
  P0's byte-identical test escaped this by copying fixtures to the system temp dir. In the real object
  store, Node walks up to the repo's `package.json` (`type: module`) and runs `gen_*.js` as ESM →
  *"require is not defined in ES module scope"*. Fix: `ensureMapDirs` drops a
  `{ "type": "commonjs" }` marker into each map's `data/` folder (same CommonJS-island trick as
  `engine/`). Any new object-store location that holds a generator needs this marker.
- **Enumerate POI keys from the generator, never reconstruct them.** The override key is the generator's
  *icon* category, not the raw `pois.json` `cat` (e.g. `shop:Waitrose`, **not** `Supermarket:Waitrose`).
  Rendering once with `EDITOR_KEYS=1` and reading the `data-key` tags guarantees the toggle keys match
  what the render actually looks up — reconstructing from `pois.json` would silently mismatch.
- **`node:sqlite` enforces foreign keys.** Wiping `map` + `map_version` fails with
  *FOREIGN KEY constraint failed* unless you `UPDATE map SET current_version_id = NULL` first (the map
  points at its current version). A silent `2>/dev/null` hid this and left the DB and object store
  inconsistent — order matters, and a real "delete map" needs a cascade.
- **One SQLite file, one writer.** The importer and the dev server both open `portal.sqlite`; running a
  CLI write while `npm run dev --watch` is up gives lock contention. For P1, run imports with the
  server stopped (P2's in-process job queue removes this). Also: `node --watch` hot-reloads on every
  save, which is why an already-running server can report new code — restart fresh before trusting a
  test.
- **Safe subset = server-enforced, not UI-hidden.** Hiding the drag controls is not enough; the gate
  runs on every preview and save so a hostile/buggy client can't smuggle a layout edit through.
- **Not yet in the safe subset (deferred within P1's remit):** *relabelling* routes/badges and editing
  the *Services-panel text* need a new **no-op-when-absent** override knob added to the generators (and
  re-gated on all towns) — real engine work, not wiring, so held back. Choosing **which outputs** a map
  produces is explicitly **P2** (typed maps + output toggles); P1 renders internal + external.

## [0.0.1-P0] — 2026-07-23

Phase **P0** of the Option-B build: public repo scaffold, the deterministic render wrapper
(proven byte-identical), and the public shopfront brought forward to show prospects early.

### Added
- Apache-2.0 `LICENSE` + `NOTICE` (OpenStreetMap/ODbL, BODS/OGL attribution).
- Strict `.gitignore` / `.gitattributes` — no map data, customer PII or secrets in git; config via env.
- Fastify server (`src/server.js`): `GET /health`, `POST /api/apply`, `POST /api/contact` into
  `node:sqlite`, with server-side validation, a spam honeypot, and a small per-IP rate limit.
- Public shopfront (`public/`): landing, examples gallery, apply, FAQ, contact — light/dark, responsive.
- `engine/` — vendored generic renderer (`render.js`, `icons.js`) as a CommonJS island.
- `src/render/renderMap.js` — runs a map's generator, then rasterises the SVG to a print-ready
  A4 300 dpi JPG with the same `sharp` parameters as the desktop pipeline.
- `scripts/verify-reproduce.mjs` — byte-identical reproduction test (`npm run verify`).
- `docs/ROADMAP.md` — the P0–P7 plan and the deterministic/central split.

### Verified
- **St Ives v6.6 reproduces BYTE-IDENTICAL** — SVG *and* 300 dpi JPG, internal *and* external
  (internal 471,569 B SVG / 1,172,380 B JPG; external 33,768 B / 987,563 B).
- Shopfront apply/contact tested end-to-end in-browser: rows persist, validation returns the right
  fields, the honeypot silently drops bots, no console errors.

### Lessons learned (read these before extending the build)
- **Module system.** The repo is `type: module`, but the vendored engine is CommonJS
  (`require` / `module.exports`). A scoped `engine/package.json` = `{ "type": "commonjs" }` makes
  `engine/` a CommonJS island; without it Node throws *"module is not defined in ES module scope"*.
- **SQLite choice.** Uses Node's built-in `node:sqlite` (Node 22+) rather than `better-sqlite3`, to
  avoid a native build on the bleeding-edge Node 24. The only native dependency is `sharp`.
- **Byte-identical contract.** Generators are env-driven: `LEAFLET_DIR` (data folder),
  `SKILL_ASSETS` (resolves `icons.js`), `OVERRIDES_FILE` (**absent/empty ⇒ byte-identical baseline**).
  So only generic `render.js` + `icons.js` are vendored; the per-map generators travel with the data.
- **Render parity depends on `sharp`/libvips.** libvips 8.17.3 reproduced the shipped JPGs exactly.
  Pin a compatible `sharp` in any deploy image to preserve byte-parity.
- **`icons.js` drift.** `engine/icons.js` is vendored from the `make-bus-leaflet` skill; if that skill's
  `icons.js` changes, re-vendor it or byte-identical reproduction can break.
- **cwd independence.** The data dir resolves from the module path, not `process.cwd()`, so the app runs
  the same wherever it's launched (the local preview launcher supplies no working directory).
- **GitHub auth.** A stale Git Credential Manager token can cause *"Password authentication is not
  supported"*; `git credential-manager erase` (for `host=github.com`) then re-auth fixes it.
