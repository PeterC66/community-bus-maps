# Changelog

Notable changes to Community Bus Maps. Loosely follows Keep a Changelog; dates are ISO (YYYY-MM-DD).

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
