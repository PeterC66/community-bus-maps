# Roadmap & architecture

This is the short, self-contained orientation for anyone (or any future session) picking the project
up. The full planning documents live in the companion **Buses** working repo
(`portal-optionB-revised-plan_2026-07-23.md`, `portal-optionB-architecture_2026-07-14.md`,
`portal-options_2026-07-14.md`).

## What this is

A self-serve portal that lets **approved organisations** (town/parish councils first, then shops,
businesses, schools, event organisers, the National Trust and others) generate and maintain
printable bus maps. Two map kinds — **area** (a town/parish/part-of-town) and **place** (a single
point) — from one deterministic engine, each producing any of four outputs (internal geographic,
internal schematic, internal diagram, external).

## The load-bearing split

- **Deterministic tier (this repo).** Given a map's already-prepared data + config + a customer's
  overrides, the engine produces SVG/JPG with **no AI and no external calls** — same input, same
  output. This is what customers self-serve against, and what `src/render/renderMap.js` wraps.
- **Central pipeline (kept expert-gated, run elsewhere).** Fetching bus/map data, onboarding a new
  area/place, and the monthly "what changed?" refresh involve judgement and live sources. They run
  centrally and produce *proposed updates* a customer accepts.

## Three approval gates

1. **Organisation** — a public application → an admin approves → a customer account is created. *(P3 ✅)*
2. **Map request** — an approved customer requests an area/place map (within quota) → admin approves. *(P3 ✅)*
3. **Publish** — a rendered map stays a *draft* until a platform approver signs it off (with recorded
   red-team evidence); publishing advances the map's public-current pointer. *(P4 ✅)*

## Build phases

| Phase | Delivers | Status |
|---|---|---|
| **P0** | Public repo + Apache-2.0 + hygiene; render wrapper proven **byte-identical**; public shopfront (marketing, examples, apply, FAQ, contact) + `/api/apply` + `/api/contact`. | ✅ **done (2026-07-23)** |
| **P1** | Re-home the editor behind the app as the **safe-subset** editor (recolour routes, toggle POIs) → save → version → render → download; object store; importer seeds a baseline. | ✅ **done (2026-07-23)** |
| **P2** | Multi-customer + magic-link auth + roles + tenant isolation; per-map output toggles; demo seed of existing towns as customers. *(Area maps only — the place engine is a follow-up; approver-role powers land in P4.)* | ✅ **done (2026-07-23)** |
| **P3** | Public **Apply** → application → admin approve → customer + invite; per-map request lifecycle + quota (1 area + a few places); dormant `plan` fields (payments off); admin console. | ✅ **done (2026-07-23)** |
| **P4** | Publish gate: draft/published states, approver sign-off, red-team evidence, public-current pointer, audit. | ✅ **done (2026-07-23)** |
| **P5** | Monthly change acceptance: central refresh → `proposed_update`; review queue; old-vs-new preview; accept re-applies overrides. | |
| **P6** | Full public marketing front (extends P0's shopfront) + per-customer branding. | *(partly brought forward in P0)* |
| **P7** | Expert diagram/pin editor (expert side) + ops hardening: backups, audit, licensing sign-off, monitoring, deploy. | |

First demo cut = **P0 + P1 + P2**: a real organisation logs in, opens a map, recolours a route,
re-renders, and downloads a print-ready sheet — end to end, no AI.

## The "safe subset"

Enforced **on the server** (`src/maps/safeSubset.js`), not just hidden in the UI — the gate rebuilds
overrides from scratch on every preview/save, so only whitelisted, validated edits reach the generator.

| Customer self-serves (deterministic) | Stays expert-only |
|---|---|
| **Recolour routes** (from the palette) — *shipped in P1* | Drag/move labels & stops |
| **Toggle POI icons** on/off — *shipped in P1* | Diagram pin editing, straightening, rotation |
| Preview, re-render, download (SVG + print JPG) — *shipped in P1* | Fisheye lenses, route curation, `skipRoutes` |
| Relabel routes/badges, edit the Services panel — *deferred: needs a new no-op override knob in the generators* | River/rail/road geometry |
| Accept/defer the monthly change — *P5* | New-map onboarding / bootstrapping a subject |
| Choose which of the 4 outputs a map produces — *P2 (typed maps + output toggles); P1 renders internal + external* | Anything touching upstream (S1/S2) data |

## Known follow-ups (not blocking a phase)

- **Place maps.** Only **area** maps render in the portal: their generators travel per-map and are
  vendored. Place maps (`make-place-bus-leaflet`) use a *different* engine kept in the skill, not per-map,
  so their render dirs carry no generators. Vendoring that engine into the object store (its own "P1 for
  places") is the follow-up; until then the importer refuses place maps and the demo is area-only.
- **CSRF token** on state-changing POSTs (SameSite=Lax covers cross-site POST for now).
- **Email provider** for magic links (dev prints them to the server console).

## Key facts for continuation

- **Run:** `npm run dev` → `http://127.0.0.1:5180` (shopfront) and `/app` (sign-in → editor). **Prove the
  renderer:** set `FIXTURE_DIR` to a staged town render folder from the Buses repo, then `npm run verify`.
- **Demo (P2/P3/P4):** `BUSES_DIR="…/Buses" node scripts/seed-demo.mjs` → admin + a platform **approver**
  + two councils each with an editor + their maps, plus a pending application, a requested map,
  **March published v1.0**, and a **St Ives v1.1 submitted for sign-off**. Sign in with a seeded email;
  the one-time link is printed to the **server console**. **Stop the dev server first** (one SQLite writer).
- **Auth:** passwordless magic link → opaque httpOnly session cookie (`src/auth/`). Roles editor/approver/
  admin; **every `/api/maps*` route is tenant-scoped by `customer_id`** (admins excepted).
- **Admin console (P3):** `/app/admin` (admin-only) reviews applications (approve → customer + editor +
  invite), runs the map-request queue, and edits customer quotas/plan; `/api/admin/*` re-checks the role.
  Customers **request maps within quota** from their dashboard (`POST /api/maps/request`, enforced
  server-side). The invite in dev is the magic link, logged to the console and returned in the API
  response (gated on `EMAIL_PROVIDER` unset).
- **Map lifecycle:** `requested` → (admin) `approved` → *(central build, P5)* → `draft`/`published`; a
  map with no rendered version shows as "being prepared" and is not editable. `reject` → `archived`
  (frees quota).
- **Publish gate (P4):** each map carries **two** version pointers — `current_version_id` (working head,
  moves on every save) and `published_version_id` (the **public-current** official version, moves only on
  sign-off). An editor **submits** the head at `/app/maps/:id`; editing then **freezes** (save → 409)
  until a platform **approver/admin** decides at **`/app/review`**. Publishing requires a **complete
  sign-off checklist** (server-enforced in `src/publish/index.js`), records **red-team evidence** (the
  deterministic `changeSummary` of submitted-vs-published + the checklist), advances the pointer, and
  retires the prior published version to `superseded`. Every action lands in the append-only **audit log**
  (admin **Audit** tab, `/api/admin/audit`). Approvers can **read/inspect any** map (`loadReadableMap`)
  but never edit (`loadOwnedMap`). Publishing **never re-renders**, so the P0 byte-identical guarantee is
  untouched.
- **Testing the API in this environment:** drive it through the **in-app browser**, not Bash `curl` —
  network calls to `localhost` from the shell are denied here. Use `javascript_tool` `fetch('/api/…')`
  from the page origin (the session cookie rides along) and read a magic-link from `preview_logs`. This is
  how P1 and P2 were verified end-to-end.
- **Seed one map (P1/P2):** `node scripts/import-map.mjs --src "<S5-render dir>" --name "St Ives" --slug st-ives --customer "St Ives Town Council"`
  → renders **v1.0 = the byte-identical baseline**.
- **Object store:** each map lives at `data/maps/<id>/` — `data/` (generators + inputs, with a
  `{"type":"commonjs"}` marker so the CJS generators run inside this `type:module` repo),
  `overrides.json` (canonical safe-subset edits), `renders/v<maj>.<min>/` (four artefacts + meta). All
  git-ignored.
- **Safe subset is server-enforced** in `src/maps/safeSubset.js`; POI keys are enumerated from the
  generator (`EDITOR_KEYS=1`), never reconstructed from `pois.json`.
- **Data hygiene:** map data, customer PII and secrets never enter this (public) repo — see the root
  `.gitignore`.
- **Deploy note:** pin a `sharp`/libvips build compatible with the desktop pipeline to keep byte-parity.
- See `CHANGELOG.md` for the **P0, P1, P2 and P3** lessons learned.
