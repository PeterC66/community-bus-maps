# Community Bus Maps — portal

A self-serve web portal that lets approved organisations — town/parish councils first, then
shops, businesses, schools, function organisers, the National Trust and others — generate,
tweak and keep up to date **printable bus maps** for the places they care about.

Two kinds of map, from one deterministic engine:

- **Area maps** — a whole town, a rural parish, or part of a larger town (e.g. *St Ives*, *March*).
- **Place maps** — centred on a single point: a shop, school, station, community centre or town
  centre (e.g. *Beaconsfield Simpson Centre*, *St Neots Town Centre*).

Each map can produce any of four outputs, and the customer chooses which they want:

| Output | What it is |
|---|---|
| **internal (geographic)** | a street-anchored map of the buses within the area/around the place |
| **internal (schematic)** | an octolinear, straightened version of the same |
| **internal (diagram)** | a tube-map-style diagram |
| **external** | a tube-map of where the buses go (to termini / reachable places) |

> **Status: early build (P0 + P1).** This repo contains the public **shopfront** (marketing, examples,
> "apply to become a customer"), the deterministic **render wrapper** with a **byte-identical
> reproduction test**, and the **safe-subset editor** (P1): open a map, recolour a route or show/hide a
> landmark, preview the real render live, then save a numbered version and download print-ready files.
> Multi-customer auth, the approval gates and monthly-change acceptance follow in later phases — see
> [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`CHANGELOG.md`](CHANGELOG.md).

## How it fits together

The system splits cleanly, which is what makes self-serve safe:

- **Deterministic tier (in this repo).** Given a map's already-prepared data + config + a customer's
  overrides, the engine produces the SVG/JPG with **no AI and no external calls**. Same input →
  same output. This is what customers self-serve against (recolour a route, relabel, toggle a POI,
  re-render, download).
- **Central pipeline (kept expert-gated, elsewhere).** Fetching bus + map data, onboarding a new
  area/place, and the monthly "what changed?" refresh involve judgement and live sources; they run
  centrally and produce *proposed updates* a customer accepts. Every map is **signed off by a human
  before it can be printed.**

## Quick start (local dev)

```bash
npm install
cp .env.example .env      # then edit if you like
npm run dev               # serves the shopfront on http://127.0.0.1:5180
```

Prove the renderer reproduces a real leaflet byte-for-byte (needs the separate Buses data repo):

```bash
# point FIXTURE_DIR at one staged town render folder, then:
npm run verify
```

### Try the editor (P1)

Seed one map into the object store from a staged Buses run dir, then open the editor. **Stop the dev
server first** — the importer and server both write the SQLite file, and one writer at a time is the
rule for now:

```bash
node scripts/import-map.mjs --src "/path/to/St Ives/S5-render/v6.6_..." --name "St Ives" --slug st-ives --kind area --subject "St Ives, Cambridgeshire"
```

Then `npm run dev` and open **http://127.0.0.1:5180/app** → pick the map. You can recolour any route,
tick/untick landmarks, watch the live preview, and **Save new version** to render print-ready
SVG + JPG for both the "within the area" and "to nearby towns" maps. Version **1.0 is the imported
baseline** (empty overrides ⇒ byte-identical to the shipped leaflet); each save bumps the minor and
keeps every earlier version.

The editor is locked to a **safe subset** — recolour + POI toggle — enforced on the server, not just
hidden in the UI. Layout, geometry, straightening and diagram-pin edits stay expert-only.

## Data hygiene (important — this is a public repo)

**No map data, customer data, or secrets ever go in git.**

- Map geometry/service data and per-customer data live under `./data` (git-ignored) or an object
  store — never committed.
- Configuration and secrets come from environment variables (`.env`, git-ignored). See `.env.example`.
- The only images committed are a few of the project's own rendered leaflets, downscaled for the web,
  under `public/examples/`, shown with attribution.

## Licence & attribution

Code is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

Maps are derived from **OpenStreetMap** (© OpenStreetMap contributors, ODbL) and UK **bus open data**
via **BODS** (Open Government Licence). See [NOTICE](NOTICE) for full attribution.

## Layout

```
engine/     the deterministic renderer (vendored reference: render.js, icons.js as a CommonJS island)
src/
  db/       node:sqlite schema + helpers (applications, messages, maps, versions)
  render/   renderMap.js — run a map's generator, rasterise to a 300 dpi JPG (== desktop pipeline)
  maps/     store.js (object store) · safeSubset.js (the safe-subset gate) · engine.js (enumerate/preview/render)
  server.js Fastify server: shopfront API + the P1 editor API
public/     the shopfront (marketing, examples, apply) + app/ (the editor dashboard + two-pane editor)
scripts/    import-map.mjs (seed a map) · verify-reproduce.mjs (byte-identical test)
data/       runtime data + SQLite + object store maps/<id>/… (git-ignored)
```
