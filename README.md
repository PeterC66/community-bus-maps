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

> **Status: early build (P0 + P1 + P2 + P3 + P4 + P5 + P6).** This repo contains the public **shopfront**
> (marketing, examples, "apply to become a customer"), the deterministic **render wrapper** with a
> **byte-identical reproduction test**, the **safe-subset editor** (P1), **multi-customer auth + tenant
> isolation** (P2), **onboarding + governance** (P3), the **publish gate** (P4), and **monthly change
> acceptance** (P5). An admin reviews applications and approves one into a customer + editor + invite;
> customers **request maps within a quota**, sign in passwordlessly, see only their own maps, recolour
> routes / toggle landmarks / choose outputs, and save numbered versions. Each version stays a private
> **draft** until a platform **approver** signs it off (with a required checklist + a deterministic change
> summary as evidence); publishing sets the **official public version** and everything is **audited**. Each
> month the central pipeline stages a **proposed data update** (`scripts/propose-update.mjs`); the customer
> reviews a change summary + old-vs-new preview and **accepts** (their edits re-applied onto the fresh data
> as a new major draft) or **declines**. Once a version is signed off it gets a **public page** anyone can
> visit — the sheets to view and download, the publishing organisation's branding, and a "something looks
> wrong" form — listed in a public **gallery** (P6). See [`docs/ROADMAP.md`](docs/ROADMAP.md) and
> [`CHANGELOG.md`](CHANGELOG.md).

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

### Set up the multi-customer demo (P2 + P3 + P4 + P5)

Seed an admin, a platform **approver**, two demo councils (each with an editor user) and their maps, plus
a **pending application**, a **requested map**, **two published maps with live public pages** (March v1.0
and the Simpson Centre place map), a version **submitted for sign-off** (St Ives v1.1), **pending monthly
updates**, public **branding** for each organisation and a piece of public **feedback**, so the P3/P4/P5/P6
queues and the public gallery aren't empty. **Stop the dev server first** — the seed and the server share the SQLite file, and it's one
writer at a time for now:

```bash
BUSES_DIR="/path/to/Buses" node scripts/seed-demo.mjs
```

Then `npm run dev` and open **http://127.0.0.1:5180/app**. You'll be sent to a **sign-in** page — enter
one of the seeded emails and the one-time link is **printed to the server console** (no email provider
in dev):

- `peter@pcooper.me.uk` — **admin**: sees every customer's maps, plus the **Admin** console and **Review**.
- `approver@community-bus-maps.example` — **approver**: a platform reviewer who signs off submissions at
  **/app/review** (can inspect any map's print files, but not edit them).
- `clerk@st-ives-tc.example` / `clerk@march-tc.example` — **editors**: see only their own council's maps.

As an **editor**, open a map to recolour routes, tick/untick landmarks, choose which **outputs** it
produces, and **Save new version** for print-ready SVG + JPG. Version **1.0 is the imported baseline**
(empty overrides ⇒ byte-identical to the shipped leaflet); each save bumps the minor and keeps every
earlier version. Use **Request a map** to ask for a new area/place map within your quota.

Each version stays a private **draft** until it is signed off. In the editor's **Publish** panel, hit
**Submit for publication** (editing then freezes) — then, as the **approver** or **admin**, open
**/app/review**, check the change summary, inspect the print-ready JPGs, complete the **sign-off
checklist** and **Publish**. Publishing sets the map's **official public version** (retiring the previous
one) and records the whole thing in the admin **Audit** tab. The editor who makes a change never
publishes it — that's a deliberate separation of duties.

As the **admin**, open **/app/admin** to review **applications** (approve → creates a customer + editor
+ invite link), work the **map-request** queue, and adjust **customer** quotas. Approving the seeded
*Ramsey Town Council* application prints an invite link to the console — sign in with it to see the new
customer's empty dashboard.

To import a single map yourself (attaching it to a customer, created if new) — `--kind area` for a town,
`--kind place` for a single point (a place `--src` is a `Places/<Place>/S5-render/...` folder):

```bash
node scripts/import-map.mjs --src "/path/to/March/S5-render/v2.0_..." --name "March" --slug march --kind area --customer "March Town Council" --customer-type council
node scripts/import-map.mjs --src "/path/to/Places/Beaconsfield Simpson Centre/S5-render/v1.0_..." --name "Simpson Centre" --slug simpson-centre --kind place --customer "Beaconsfield Health Centre"
```

To offer a customer a **monthly data refresh** (P5): regenerate that town's data centrally, then stage it
as a *proposed update* (stop the dev server first — one SQLite writer). The customer sees a change
summary + old-vs-new preview in their editor and accepts or declines it:

```bash
node scripts/propose-update.mjs --map march --src "/path/to/March/S5-render/v2.1_..." --note "August 2026 timetable"
```

Accepting re-applies the customer's colours/landmark choices onto the fresh data as a new **major** draft
version (`vN.0`) — which still goes through the publish gate before it is public. The outgoing data is
archived, never deleted; the byte-identical published files keep serving until the new version is signed off.

Three boundaries are **enforced on the server**, not just hidden in the UI: the editor is locked to a
**safe subset** (recolour + POI toggle; layout/geometry/diagram-pins stay expert-only); every map is
**tenant-isolated** — a customer can never list, open, preview, download or re-configure another
customer's map; and the **publish gate** — a version can only become the official public one via an
approver's completed sign-off checklist, and editors can never publish their own maps. **Both map kinds
are supported** — area maps carry their generators per-map; place maps are rendered by the vendored place
engine (`engine/place/`), copied into each place map's data at import. Everything above (edit, version,
publish, monthly refresh) works identically for a place.

## The public front (P6)

Everything a signed-off map produces is public, and nothing else is:

| Page | What it shows |
|---|---|
| `/maps` | every published map (gallery) |
| `/m/<map-slug>` | one published map: output tabs, the sheet, print JPG + SVG downloads, version + date, the publishing organisation, and a **report-a-problem** form |
| `/o/<org-slug>` | one organisation's published maps + its branding |
| `/legal.html` | what personal data we hold and why, the BODS/OSM licences, how the sheets may be reused *(working draft — read it before launch)* |
| `/robots.txt`, `/sitemap.xml` | search engines; the sitemap is generated from what is actually public |

Three conditions make a map public, and they are enforced **in SQL**, not at the edge: it has a
**published version**, its customer is **active**, and the customer has left it **listed**. So drafts,
pending versions, archived maps, suspended organisations and all customer PII are unreachable by
construction — and because publishing never re-renders, a public page serves the exact bytes an approver
signed off. Gallery images are screen-sized copies **derived from** the published print JPG on first
request (cached beside it), so nothing about the render path changes.

**Publish ≠ public.** Sign-off decides what is *official*; the customer's own **Public page** switch in the
editor decides what is *shown*. Un-listing takes the page, its files and the gallery entry down at once,
without touching the signed-off version or its pointer; re-listing restores them.

Customers set their public identity at **/app/branding** — public name, one-line blurb, website, badge
(emoji or initials) and an accent colour from a fixed list. It is server-validated by a whitelist
(`src/branding/index.js`) in the same spirit as the safe subset, and it decorates the public *page*: the
printed sheet is untouched. No email or phone is brandable, so a public page never exposes contact
details — feedback comes back through our own form (and lands in the admin **Messages** tab against that
map).

```bash
npm test          # P6 checks: the branding whitelist, the public SQL gate, slugs, both migration paths
```

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
  db/       node:sqlite schema + helpers (customers, users, sessions, maps, versions, publish requests, proposed updates, audit, messages)
  auth/     magic-link + server-side sessions + hand-rolled cookies (no deps)
  publish/  the publish gate: deterministic changeSummary() + the enforced sign-off checklist (pure)
  refresh/  monthly change acceptance: pure diffRouteData() over the service facts (routes/stops/desc/validity)
  branding/ per-customer public identity — the server-enforced whitelist (pure)
  public/   the public read model: published maps/orgs → PII-free JSON + derived web-sized previews
  audit/    logAudit() — append-only governance trail (who/what/when/which map)
  render/   renderMap.js — run a map's generator, rasterise to a 300 dpi JPG (== desktop pipeline)
  maps/     store.js (object store + OUTPUTS) · safeSubset.js (the safe-subset gate) · engine.js (enumerate/preview/render/swap)
  server.js Fastify server: shopfront + auth + tenant-scoped editor API + review/publish + monthly updates + admin console
public/     the shopfront + public map pages (maps/map/org/legal) + app/ (login, dashboard, two-pane editor, public details, review console, admin console)
scripts/    seed-demo.mjs (multi-customer demo) · import-map.mjs (seed one map) · propose-update.mjs (stage a monthly refresh) · verify-reproduce{,-place}.mjs (byte-identical tests) · test-p6.mjs (public-front checks)
data/       runtime data + SQLite + object store maps/<id>/… (git-ignored)
```
