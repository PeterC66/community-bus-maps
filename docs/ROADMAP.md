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

1. **Organisation** — a public application → an admin approves → a customer account is created.
2. **Map request** — an approved customer requests an area/place map (within quota) → admin approves.
3. **Publish** — a rendered map stays a *draft* until a human signs it off (with red-team evidence)
   before it can be printed.

## Build phases

| Phase | Delivers | Status |
|---|---|---|
| **P0** | Public repo + Apache-2.0 + hygiene; render wrapper proven **byte-identical**; public shopfront (marketing, examples, apply, FAQ, contact) + `/api/apply` + `/api/contact`. | ✅ **done (2026-07-23)** |
| **P1** | Re-home the editor behind the app as the **safe-subset** editor (recolour routes, toggle POIs) → save → version → render → download; object store; importer seeds a baseline. | ✅ **done (2026-07-23)** |
| **P2** | Multi-customer + magic-link auth + roles + tenant isolation; typed maps (area/place) + output toggles; importer loads existing towns/places as demo customers. | |
| **P3** | Public **Apply** → application → admin approve → customer + invite; per-map request lifecycle + quota (1 area + a few places); dormant `plan` fields (payments off). | |
| **P4** | Publish gate: draft/published states, approver sign-off, red-team evidence, public-current pointer, audit. | |
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

## Key facts for continuation

- **Run:** `npm run dev` → `http://127.0.0.1:5180` (shopfront) and `/app` (the editor). **Prove the
  renderer:** set `FIXTURE_DIR` to a staged town render folder from the Buses repo, then `npm run verify`.
- **Seed a map (P1):** `node scripts/import-map.mjs --src "<S5-render dir>" --name "St Ives" --slug st-ives`
  → renders **v1.0 = the byte-identical baseline**. **Stop the dev server first** (one SQLite writer).
- **Object store:** each map lives at `data/maps/<id>/` — `data/` (generators + inputs, with a
  `{"type":"commonjs"}` marker so the CJS generators run inside this `type:module` repo),
  `overrides.json` (canonical safe-subset edits), `renders/v<maj>.<min>/` (four artefacts + meta). All
  git-ignored.
- **Safe subset is server-enforced** in `src/maps/safeSubset.js`; POI keys are enumerated from the
  generator (`EDITOR_KEYS=1`), never reconstructed from `pois.json`.
- **Data hygiene:** map data, customer PII and secrets never enter this (public) repo — see the root
  `.gitignore`.
- **Deploy note:** pin a `sharp`/libvips build compatible with the desktop pipeline to keep byte-parity.
- See `CHANGELOG.md` for the **P0 and P1** lessons learned.
