# engine/ — the deterministic renderer (vendored reference)

<!-- docstamp v1.2 | 2026-08-25 | sha=8e7188ed -->
**v1.2** · updated 25 August 2026

These are the generic, publishable pieces of the map engine:

- **`render.js`** — rasterises an SVG (declaring `width="3508" height="2480"`) to a print-ready A4 landscape JPG at 300 dpi, using `sharp`. `node render.js in.svg out.jpg`.
- **`icons.js`** — shared point-of-interest icon paths (`icon(cat, x, y, s)`), required by the per-map generators.

**An AREA map's generators travel *with each map's data* in the object store where the payload carries them** — they are customised per town, and a payload that brings its own still wins. Since 2026-08-21 the portal also vendors the two external templates in [`area/`](area/README.md) as the fallback for a payload that carries none, which is every payload the skill has staged since 2026-08-04. A generator is env/flag driven:

- `LEAFLET_DIR` — the folder holding the map's data (all inputs read from here, SVG written here).
- `SKILL_ASSETS` — folder to resolve `icons.js` from (falls back to a sibling `icons.js`).
- `OVERRIDES_FILE` — a customer's saved edits; **absent/empty ⇒ byte-identical baseline output.**

`src/render/renderMap.js` wraps this: it runs the generator, then rasterises with the same `sharp` parameters as `render.js`, so the portal's output is identical to the desktop pipeline's. The `npm run verify` script proves that byte-for-byte against an already-shipped leaflet.

**One thing is added outside the engine.** While the system is a pilot, `renderMap.js` stamps a `PILOT — SAMPLE MAP` band onto the finished SVG *after* the generator has run (`src/render/pilotStamp.js`). Nothing in `engine/` knows about it, and the verify scripts opt out with `stamp: false`, so the determinism guarantee above is exactly as stated. See [`../docs/PILOT.md`](../docs/PILOT.md).

## What is vendored here, and what checks it

Everything under `engine/` is either a **byte-for-byte copy** of a file whose source of truth is one of the two map skills, or a **portal-owned wrapper** with no counterpart there. [`vendored.json`](vendored.json) says which, file by file, with the source path and a hash of the vendored bytes; the sub-folder READMEs ([`area/`](area/README.md), [`expert/`](expert/README.md), [`place/`](place/README.md)) explain what each file is for.

`npm test` runs `scripts/test-vendored.mjs`, which fails when a vendored copy has been edited without being re-vendored, when a vendored file has gone missing, and — the part that matters most — when a `.js` file appears under `engine/` that the manifest does not name. That last rule is why the manifest exists at all: the older drift check lived in the skills repository, listed eleven files by hand, and went green for four days while `area/gen_external_radial.js` was stale, because nobody had added its row (`technical-audit_2026-08-25` N14).

**After a deliberate re-vendor**, copy the file and then run this from the repository root:

```bash
node scripts/check-vendored.mjs --update
```

That restamps the hash and the date in `vendored.json`; commit it *with* the file it describes, so the change arrives in a diff a reviewer can see rather than silently.

**What this check cannot tell you** is whether the skill has moved on without us — that needs both trees on one machine, and CI has only this one. `status.js` in the skills repository asks that question daily, reading the same `vendored.json` so the two cannot disagree about which files exist. Run `node scripts/check-vendored.mjs` (no flags) on the laptop to ask both questions at once.

**Exception — `place/`.** Place maps are the one case where generators *are* vendored (in [`place/`](place/README.md)), because the place skill never copies them into a place's render folder. The importer copies those into each place map's `data/`, so the per-map model still holds.

