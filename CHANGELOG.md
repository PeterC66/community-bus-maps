# Changelog

Notable changes to Community Bus Maps. Loosely follows Keep a Changelog; dates are ISO (YYYY-MM-DD).

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
