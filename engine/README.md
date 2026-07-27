# engine/ — the deterministic renderer (vendored reference)

<!-- docstamp v1.0 | 2026-07-27 | sha=134ffd56 -->
**v1.0** · updated 27 July 2026

These are the generic, publishable pieces of the map engine:

- **`render.js`** — rasterises an SVG (declaring `width="3508" height="2480"`) to a print-ready A4
  landscape JPG at 300 dpi, using `sharp`. `node render.js in.svg out.jpg`.
- **`icons.js`** — shared point-of-interest icon paths (`icon(cat, x, y, s)`), required by the
  per-map generators.

**The per-map generators (`gen_internal.js`, `gen_external.js`, …) are NOT vendored here.** They are
customised per area/place and travel *with each map's data* in the object store (not in this repo).
A generator is env/flag driven:

- `LEAFLET_DIR` — the folder holding the map's data (all inputs read from here, SVG written here).
- `SKILL_ASSETS` — folder to resolve `icons.js` from (falls back to a sibling `icons.js`).
- `OVERRIDES_FILE` — a customer's saved edits; **absent/empty ⇒ byte-identical baseline output.**

`src/render/renderMap.js` wraps this: it runs the generator, then rasterises with the same `sharp`
parameters as `render.js`, so the portal's output is identical to the desktop pipeline's. The
`npm run verify` script proves that byte-for-byte against an already-shipped leaflet.

**One thing is added outside the engine.** While the system is a pilot, `renderMap.js` stamps a
`PILOT — SAMPLE MAP` band onto the finished SVG *after* the generator has run
(`src/render/pilotStamp.js`). Nothing in `engine/` knows about it, and the verify scripts opt out with
`stamp: false`, so the determinism guarantee above is exactly as stated. See
[`../docs/PILOT.md`](../docs/PILOT.md).

**Exception — `place/`.** Place maps are the one case where generators *are* vendored (in
[`place/`](place/README.md)), because the place skill never copies them into a place's render
folder. The importer copies those into each place map's `data/`, so the per-map model still holds.
