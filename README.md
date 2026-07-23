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

> **Status: early build (P0 + P1 + P2 + P3).** This repo contains the public **shopfront** (marketing,
> examples, "apply to become a customer"), the deterministic **render wrapper** with a **byte-identical
> reproduction test**, the **safe-subset editor** (P1), **multi-customer auth + tenant isolation**
> (P2), and **onboarding + governance** (P3): an admin reviews applications and approves one into a
> customer + editor + invite, and customers **request maps within a quota**. Organisations sign in
> passwordlessly, see only their own maps, recolour routes / toggle landmarks / choose outputs, save
> numbered versions and download print-ready files. The publish gate and monthly-change acceptance
> follow in later phases — see [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`CHANGELOG.md`](CHANGELOG.md).

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

### Set up the multi-customer demo (P2 + P3)

Seed an admin, two demo councils (each with an editor user) and their maps, plus a **pending
application** and a **requested map** so the P3 queues aren't empty. **Stop the dev server first** — the
seed and the server share the SQLite file, and it's one writer at a time for now:

```bash
BUSES_DIR="/path/to/Buses" node scripts/seed-demo.mjs
```

Then `npm run dev` and open **http://127.0.0.1:5180/app**. You'll be sent to a **sign-in** page — enter
one of the seeded emails and the one-time link is **printed to the server console** (no email provider
in dev):

- `peter@pcooper.me.uk` — **admin**: sees every customer's maps, plus the **Admin** console.
- `clerk@st-ives-tc.example` / `clerk@march-tc.example` — **editors**: see only their own council's maps.

As an **editor**, open a map to recolour routes, tick/untick landmarks, choose which **outputs** it
produces, and **Save new version** for print-ready SVG + JPG. Version **1.0 is the imported baseline**
(empty overrides ⇒ byte-identical to the shipped leaflet); each save bumps the minor and keeps every
earlier version. Use **Request a map** to ask for a new area/place map within your quota.

As the **admin**, open **/app/admin** to review **applications** (approve → creates a customer + editor
+ invite link), work the **map-request** queue, and adjust **customer** quotas. Approving the seeded
*Ramsey Town Council* application prints an invite link to the console — sign in with it to see the new
customer's empty dashboard.

To import a single map yourself (attaching it to a customer, created if new):

```bash
node scripts/import-map.mjs --src "/path/to/March/S5-render/v2.0_..." --name "March" --slug march --kind area --customer "March Town Council" --customer-type council
```

Two boundaries are **enforced on the server**, not just hidden in the UI: the editor is locked to a
**safe subset** (recolour + POI toggle; layout/geometry/diagram-pins stay expert-only), and every map is
**tenant-isolated** — a customer can never list, open, preview, download or re-configure another
customer's map. Only **area** maps are supported so far; place maps use a separate engine (a follow-up).

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
  db/       node:sqlite schema + helpers (customers, users, sessions, maps, versions, messages)
  auth/     magic-link + server-side sessions + hand-rolled cookies (no deps)
  render/   renderMap.js — run a map's generator, rasterise to a 300 dpi JPG (== desktop pipeline)
  maps/     store.js (object store + OUTPUTS) · safeSubset.js (the safe-subset gate) · engine.js (enumerate/preview/render)
  server.js Fastify server: shopfront + auth + the tenant-scoped editor API
public/     the shopfront + app/ (login, dashboard, two-pane editor)
scripts/    seed-demo.mjs (multi-customer demo) · import-map.mjs (seed one map) · verify-reproduce.mjs (byte-identical test)
data/       runtime data + SQLite + object store maps/<id>/… (git-ignored)
```
