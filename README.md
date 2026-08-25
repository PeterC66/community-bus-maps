# BusMaps.uk — portal

<!-- docstamp v1.15 | 2026-08-23 | sha=022df1db -->
**v1.15** · updated 23 August 2026

A self-serve web portal that lets approved organisations — town/parish councils first, then shops, businesses, schools, function organisers, the National Trust and others — generate, tweak and keep up to date **printable bus maps** for the places they care about.

> **The project is BusMaps.uk; the repository is still `community-bus-maps`.** The repo name predates the brand and is deliberately not being changed — renaming it would break existing clones, the links in these docs, and every local path, for no benefit. The same goes for the `package.json` name and the `/healthz` service id. Anything a *user* sees says BusMaps.uk.

Two kinds of map, from one deterministic engine:

- **Area maps** — a whole town, a rural parish, or part of a larger town (e.g. *St Ives*, *March*).
- **Place maps** — centred on a single point: a shop, school, station, community centre or town centre (e.g. *High Wycombe Aldi*, *St Neots Town Centre*).

Each map can produce any of four outputs, and the customer chooses which they want:

| Output | What it is |
|---|---|
| **internal (geographic)** | a street-anchored map of the buses within the area/around the place |
| **internal (schematic)** | an octolinear, straightened version of the same *(expert style, opt-in per map)* |
| **internal (diagram)** | a tube-map-style diagram, hand-tuned via the pin editor *(expert style, opt-in per map, and **request-only**: hand-pinned work, so it is quoted separately and granted by us — see [OPERATIONS-HANDBOOK §4b](docs/H1-operations-handbook.md))* |
| **external** | a tube-map of where the buses go (to termini / reachable places) |

> **Status: PILOT — feature-complete against the plan (P0–P7, plus P8a), but not a live service.** There are **no customers**: no organisation has signed up, and every map on the public site is one we made ourselves to build and test the system. Every page carries a pilot banner and every rendered sheet a pilot band; seeded demo organisations are labelled **Sample**. One env var (`PILOT_MODE=0`) switches all of that off — see [`docs/PILOT.md`](docs/PILOT.md).
>
> `CLAUDE.md` is the short orientation a new session (or developer) should read first.
>
> Feature-wise: This repo contains the public **shopfront** (marketing, examples, "apply to become a customer"), the deterministic **render wrapper** with a **byte-identical reproduction test**, the **safe-subset editor** (P1), **multi-customer auth + tenant isolation** (P2), **onboarding + governance** (P3), the **publish gate** (P4), and **monthly change acceptance** (P5). An admin reviews applications and approves one into a customer + editor + invite; customers **request maps within a quota**, sign in passwordlessly, see only their own maps, recolour routes / toggle landmarks / choose outputs, and save numbered versions. Each version stays a private **draft** until a platform **approver** reviews it (with a required checklist + a deterministic change summary as evidence); publishing sets the **official public version** and everything is **audited**. Each month the central pipeline stages a **proposed data update** (`scripts/propose-update.mjs`); the customer reviews a change summary + old-vs-new preview and **accepts** (their edits re-applied onto the fresh data as a new major draft) or **declines**. Once a version is reviewed it gets a **public page** anyone can visit — the sheets to view and download, the publishing organisation's branding, and a "something looks wrong" form — listed in a public **gallery** (P6). **All five outputs render** — the octolinear schematic and the tube-map diagram arrived in P7, with an **admin-only pin editor** for the diagram's layout, and the **"where to board" plan** (a place's stops at walking scale, with a destination-keyed index naming the stand, printed from NaPTAN) in 2026-08 — and the service is operable: readiness probe, metrics, backups, a retention job, a container and a deploy runbook (P7). Both **lifecycle seams** are now closed (0.8.1): an approved map request is **built into its own row** by `import-map.mjs --request <id>` (so quota counts it once and no placeholder is left behind), and an approver can **revert a published map** to an earlier reviewed version in one click, with a recorded reason. **P8a** then made a published map worth reading *online* and not only on paper: the sheet is served as its own pan/zoomable vector artwork, every map is also published **as text** at `/m/<slug>/services` (its accessible equivalent), each page states when its information is correct as at and warns when that goes stale, and the `<head>` is completed server-side so links and search engines see a real page. See [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`CHANGELOG.md`](CHANGELOG.md).

## How it fits together

The system splits cleanly, which is what makes self-serve safe:

- **Deterministic tier (in this repo).** Given a map's already-prepared data + config + a customer's overrides, the engine produces the SVG/JPG with **no AI and no external calls**. Same input → same output. This is what customers self-serve against (recolour a route, relabel, toggle a POI, re-render, download).
- **Central pipeline (kept expert-gated, elsewhere).** Fetching bus + map data, onboarding a new area/place, and the monthly "what changed?" refresh involve judgement and live sources; they run centrally and produce *proposed updates* a customer accepts. Every map is **reviewed by a human before it can be printed.**

**New to git/Node, or just want the short version?** See [`docs/DUMMIES_GUIDE.md`](docs/DUMMIES_GUIDE.md) first — it covers the same ground as this section and Parts 6–8 below in plain commands, plus how to demo the app without touching your own webspace.

## Quick start (local dev)

```bash
npm install
cp .env.example .env      # then edit if you like
npm run dev               # serves the shopfront on http://127.0.0.1:5180
```

Prove the renderer reproduces a real leaflet byte-for-byte. Run from this repository's root, with the separate `buses-data` repo cloned next to it (or `BUSES_DIR` set in `.env` to wherever it is):

```bash
npm run verify
```

Nothing else to configure: the gates read a **committed fixture** — `Areas/_portal-fixture/<Town>` and `Places/_portal-fixture/<Place>` in `buses-data` — so a fresh clone proves the claim. Set `FIXTURE_DIR` / `PLACE_FIXTURE_DIR` only to point a gate at something else, normally the live render tree.

**With no fixture at all, `verify` FAILS.** It used to print "skipping" and exit 0, which meant a fresh clone, a CI run and a second developer all got a green result from a check that had not executed — the finding [`technical-audit_2026-08-19`](../../u3a%20St%20Ives/Using%20AI/Buses/Development%20Docs/technical-audit_2026-08-19.md) called the single most important structural item in the report (V2), on the grounds that the byte-identical guarantee is what the product is sold on and it could be verified by exactly one person on one machine. `npm run verify -- --allow-skip` is the escape hatch for a clone of the portal alone, and it says out loud that it proved nothing.

The same three gates run in CI on every push and pull request, and nightly — [`.github/workflows/verify.yml`](.github/workflows/verify.yml).

**Before you change any code, read [`docs/DEVELOPING.md`](docs/DEVELOPING.md)** — the determinism contract, the three approval gates, the vendored-engine hand-off, the generator env contract, and which gates to run.

### Set up the multi-customer demo (P2 + P3 + P4 + P5)

Seed an admin, a platform **approver**, three demo organisations (each with an editor user) holding **0, 1 and the rest** of the seeded maps — so the empty-dashboard, single-map and multi-map states are all demoable without extra setup — plus a **pending application**, a **requested map**, **two published maps with live public pages** (March v1.0 and the High Wycombe Aldi place map), a version **submitted for review** (St Ives v1.1), **pending monthly updates**, public **branding** for each organisation and a piece of public **feedback**, so the P3/P4/P5/P6 queues and the public gallery aren't empty. **Stop the dev server first** — the seed and the server share the SQLite file, and it's one writer at a time for now:

```bash
BUSES_DIR="/path/to/Buses" node scripts/seed-demo.mjs
```

Then `npm run dev` and open **http://127.0.0.1:5180/app**. You'll be sent to a **sign-in** page — enter one of the seeded emails and the one-time link is **printed to the server console** (no email provider in dev):

- `peter@pcooper.me.uk` — **admin**: sees every customer's maps, plus the **Admin** console and **Review**.
- `approver@busmaps.example` — **approver**: a platform reviewer who reviews submissions at **/app/review** (can inspect any map's print files, but not edit them).
- `clerk@broadmeadow-pc.example` — **editor**, Broadmeadow Parish Council (demo): **0 maps** — the empty-dashboard state.
- `clerk@fenmarsh-dc.example` — **editor**, Fenmarsh District Council (demo): **1 map** (March).
- `coordinator@oakfield-ctt.example` — **editor**, Oakfield Community Transport Trust (demo): **the rest** — St Ives (area), the High Wycombe Aldi place map, and the requested St Ives Waitrose map. Each editor sees only their own organisation's maps.

As an **editor**, open a map to recolour routes, tick/untick landmarks, choose which **outputs** it produces, and **Save new version** for print-ready SVG + JPG. Version **1.0 is the imported baseline** (empty overrides ⇒ byte-identical to the shipped leaflet); each save bumps the minor and keeps every earlier version. Use **Request a map** to ask for a new area/place map within your quota.

Each version stays a private **draft** until it is reviewed. In the editor's **Publish** panel, hit **Submit for publication** (editing then freezes) — then, as the **approver** or **admin**, open **/app/review**, check the change summary, inspect the print-ready JPGs, complete the **review checklist** and **Publish**. Publishing sets the map's **official public version** (retiring the previous one) and records the whole thing in the admin **Audit** tab. The editor who makes a change is not the one who publishes it — a deliberate separation of duties, enforced in code since 2026-08-20: an approver who submitted a version is refused when they try to approve it. **On this deployment that rule is currently overridden**, because there is one operator: `ALLOW_SELF_APPROVAL=1` is set, without it nothing could be published at all, and so the control has not yet operated on a single publication. Every publication made under the override is stamped `selfApproved` in the audit trail, so the log can tell the two eras apart — a control that is documented and not implemented is worse than one that is honestly bounded (`technical-audit_2026-08-19` S6, restated as N15 in `technical-audit_2026-08-25`). It begins to bite the day a second person holds `approver`, which is item 1 of the [pre-customer checklist](docs/H1-operations-handbook.md#3b-before-the-first-real-customer). Publishing also needs a sign-in from the last 30 minutes, so a long-lived cookie is not by itself enough to make a map public.

As the **admin**, open **/app/admin** to review **applications** (approve → creates a customer + editor + invite link), work the **map-request** queue, and adjust **customer** quotas. Approving the seeded *Ramsey Town Council* application prints an invite link to the console — sign in with it to see the new customer's empty dashboard.

To import a single map yourself (attaching it to a customer, created if new) — `--kind area` for a town, `--kind place` for a single point (a place `--src` is an `Areas/<Town>/Places/<Place>/S5-render/...` folder):

```bash
node scripts/import-map.mjs --src "/path/to/Buses/Areas/March/S5-render/v2.0_..." --name "March" --slug march --kind area --customer "Fenmarsh District Council (demo)" --customer-type council
node scripts/import-map.mjs --src "/path/to/Buses/Areas/High Wycombe/Places/High Wycombe Aldi/S5-render/v1.1_..." --name "High Wycombe Aldi" --slug highwycombe-aldi --kind place --customer "Aldi Stores Ltd"
```

To offer a customer a **monthly data refresh** (P5): regenerate that town's data centrally, then stage it as a *proposed update* (stop the dev server first — one SQLite writer). The customer sees a change summary + old-vs-new preview in their editor and accepts or declines it:

```bash
node scripts/propose-update.mjs --map march --src "/path/to/Buses/Areas/March/S5-render/v2.1_..." --note "August 2026 timetable"
```

Accepting re-applies the customer's colours/landmark choices onto the fresh data as a new **major** draft version (`vN.0`) — which still goes through the publish gate before it is public. The outgoing data is archived, never deleted; the byte-identical published files keep serving until the new version is reviewed.

Three boundaries are **enforced on the server**, not just hidden in the UI: the editor is locked to a **safe subset** (recolour + POI toggle; layout/geometry/diagram-pins stay expert-only); every map is **tenant-isolated** — a customer can never list, open, preview, download or re-configure another customer's map; and the **publish gate** — a version can only become the official public one via an approver's completed review checklist, and editors can never publish their own maps. **Both map kinds are supported** — area maps carry their generators per-map; place maps are rendered by the vendored place engine (`engine/place/`), copied into each place map's data at import. Everything above (edit, version, publish, monthly refresh) works identically for a place.

## The public front (P6)

Everything a reviewed map produces is public, and nothing else is:

| Page | What it shows |
|---|---|
| `/maps` | every published map (gallery) |
| `/m/<map-slug>` | one published map: output tabs, the sheet as **pan/zoomable vector artwork**, print JPG + SVG downloads, version + "correct as at" date, the publishing organisation, and a **report-a-problem** form |
| `/m/<map-slug>/services` | the same map **as text** — route, operator, days, stops served, where it goes *(P8a; the sheet's accessible equivalent)* |
| `/accessibility.html` | what we aim for, what is done, what is not — plus wording a customer can paste into their own statement *(P8a)* |
| `/o/<org-slug>` | one organisation's published maps + its branding |
| `/legal.html` | what personal data we hold and why, the BODS/OSM licences, how the sheets may be reused *(working draft — read it before launch)* |
| `/robots.txt`, `/sitemap.xml` | search engines; the sitemap is generated from what is actually public |

Three conditions make a map public, and they are enforced **in SQL**, not at the edge: it has a **published version**, its customer is **active**, and the customer has left it **listed**. So drafts, pending versions, archived maps, suspended organisations and all customer PII are unreachable by construction — and because publishing never re-renders, a public page serves the exact bytes an approver reviewed. Gallery images are screen-sized copies **derived from** the published print JPG on first request (cached beside it), so nothing about the render path changes.

**Publish ≠ public.** Review decides what is *official*; the customer's own **Public page** switch in the editor decides what is *shown*. Un-listing takes the page, its files and the gallery entry down at once, without touching the reviewed version or its pointer; re-listing restores them.

Customers set their public identity at **/app/branding** — public name, one-line blurb, website, badge (emoji or initials) and an accent colour from a fixed list. It is server-validated by a whitelist (`src/branding/index.js`) in the same spirit as the safe subset, and it decorates the public *page*: the printed sheet is untouched. No email or phone is brandable, so a public page never exposes contact details — feedback comes back through our own form (and lands in the admin **Messages** tab against that map).

```bash
npm test          # P6 checks: the branding whitelist, the public SQL gate, slugs, both migration paths
                  # P8a checks: the facts model (area + place), provenance/staleness, the inline-SVG transform
```

## The expert side (P7)

Two of the four outputs are **expert styles**: the octolinear **schematic** and the tube-map **diagram**. Their engines are portal-owned in [`engine/expert/`](engine/expert/README.md) (a town's render folder never carried them), they are **opt-in per map** — the map's `routes.json` has to carry `internalSchematic` / `internalDiagram` — and they are **off by default**, because a schematic is an editorial choice rather than a free extra. Both are covered by the byte-identical gate, so all **six** outputs (four area + two place) are proved on every release.

The diagram goes one step further: it is **request-only**. The other three outputs are generated — same data, same sheet, nobody's hand on it — but the diagram is solved and then *pinned by hand*, and those pins are ours to re-judge every time the network moves. So it costs drawing time in the updates, not only in the first build, and a customer cannot tick it on: the editor shows it locked with an **Ask us** button that raises a `diagram-request` message. The refusal is enforced in `chooseOutputs()` (`src/maps/engine.js`) — a non-admin PATCH asking for it gets a 403 — because hiding a checkbox is UX, not security.

The diagram's automatic layout can be hand-tuned by an **admin** at **`/app/maps/:id/diagram`**: drag a junction to pin it, drop to re-solve and see the real sheet, right-click to unpin. This is the mirror image of the customer safe subset — dragging changes *layout*, which customers may not do — so every `/api/expert/*` route is admin-only. Previews solve in a sandbox; **Save** writes the map's `diagram-layout.json` and renders a new version through the ordinary path, so expert work is a draft that still needs review, and it is audited. Pins carry across a monthly refresh (they re-resolve by stored lat/lon if a junction's key moves).

## Running it in production (P7)

```bash
curl -fsS localhost:5180/health?deep=1     # readiness: DB + object store + engine + rasteriser
npm run backup -- --keep 14                # consistent SQLite copy + per-map data/renders
npm run prune:staged -- --days 90           # reclaim settled refresh data (dry run by default; add --yes)
```

`/health?deep=1` returns **503** when a dependency is unhealthy (the container `HEALTHCHECK` uses it); `/metrics` serves Prometheus text when `METRICS_TOKEN` is set (404 otherwise); and **admin → Ops** shows dependency health, per-map disk usage and what a prune would reclaim. Deployment (container, systemd, reverse proxy, backup schedule and a **restore drill**) is in [`docs/DEPLOY.md`](docs/DEPLOY.md); the licensing launch gate is [`docs/LICENSING.md`](docs/LICENSING.md).

**One warning worth repeating:** the print JPG is the product, so an upgrade of `sharp`/libvips must re-pass `npm run verify` on the target platform before it ships — a different encoder can produce different bytes for the same SVG, which would break "the file we serve is the file that was approved".

## Data hygiene (important — the deployed portal is a public-facing service)

**No map data, customer data, or secrets ever go in git.**

- Map geometry/service data and per-customer data live under `./data` (git-ignored) or an object store — never committed.
- Configuration and secrets come from environment variables (`.env`, git-ignored). See `.env.example`.
- The only images committed are a few of the project's own rendered leaflets, downscaled for the web, under `public/examples/`, shown with attribution.

## Licence & attribution

Code is licensed under the **Business Source License 1.1** — see [LICENSE](LICENSE). Free for non-commercial, personal, internal, and evaluation use; commercial use that competes with BusMaps.uk requires a separate licence. Converts to Apache-2.0 on 2030-08-09.

Maps are derived from **OpenStreetMap** (© OpenStreetMap contributors, ODbL) and UK **bus open data** via **BODS** (Open Government Licence). See [NOTICE](NOTICE) for full attribution.

## Layout

```
engine/     the deterministic renderer (vendored reference: render.js, icons.js as a CommonJS island)
  place/    the vendored PLACE engine (copied into each place map's data at import)
  expert/   the portal-owned EXPERT styles: schematic + tube-map diagram pre-stages + wrappers
src/
  db/       node:sqlite schema + helpers (customers, users, sessions, maps, versions, publish requests, proposed updates, audit, messages)
  auth/     magic-link + server-side sessions + hand-rolled cookies (no deps)
  publish/  the publish gate: deterministic changeSummary() + the enforced review checklist (pure)
  refresh/  monthly change acceptance: pure diffRouteData() over the service facts (routes/stops/desc/validity)
  branding/ per-customer public identity — the server-enforced whitelist (pure)
  expert/   the diagram pin editor's engine: sandboxed solves, pin read/write (admin-only API)
  ops/      readiness probe, storage/activity snapshots, Prometheus metrics
  public/   the public read model: published maps/orgs → PII-free JSON + derived web-sized previews
  audit/    logAudit() — append-only governance trail (who/what/when/which map)
  render/   renderMap.js — run a map's generator, rasterise to a 300 dpi JPG (== desktop pipeline)
  maps/     store.js (object store + OUTPUTS) · safeSubset.js (the safe-subset gate) · engine.js (enumerate/preview/render/swap)
  server.js Fastify server: shopfront + auth + tenant-scoped editor API + review/publish + monthly updates + admin console
public/     the shopfront (incl. pricing + opportunity) + public map pages (maps/map/org/legal/terms) + app/ (login, dashboard, two-pane editor, public details, diagram pin editor, review console, admin console)
scripts/    seed-demo.mjs (multi-customer demo) · import-map.mjs (seed one map) · delete-map.mjs (retire a map — row, versions, object-store dir; dry run by default) · propose-update.mjs (stage a monthly refresh) · verify-reproduce{,-place}.mjs (byte-identical tests) · test-p6/p7.mjs (checks) · backup.mjs · prune-staged.mjs
data/       runtime data + SQLite + object store maps/<id>/… (git-ignored)
docs/       DUMMIES_GUIDE.md (start here if git/Node are new) · DEVELOPING.md (read before changing code) · ROADMAP.md (orientation) · DEPLOY.md (runbook + restore drill) · LICENSING.md (launch gate) · H1-operations-handbook.md + R1-R6-*.md (running the service)
Dockerfile, compose.yaml   single-process container + single-volume deployment
```

