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
| **P2** | Multi-customer + magic-link auth + roles + tenant isolation; per-map output toggles; demo seed of existing towns as customers. *(Area maps at the time; the place engine landed later in 0.6.0. Approver-role powers land in P4.)* | ✅ **done (2026-07-23)** |
| **P3** | Public **Apply** → application → admin approve → customer + invite; per-map request lifecycle + quota (1 area + a few places); dormant `plan` fields (payments off); admin console. | ✅ **done (2026-07-23)** |
| **P4** | Publish gate: draft/published states, approver sign-off, red-team evidence, public-current pointer, audit. | ✅ **done (2026-07-23)** |
| **P5** | Monthly change acceptance: central refresh → `proposed_update`; change summary + old-vs-new preview; accept re-applies overrides as a new major draft version. | ✅ **done (2026-07-24)** |
| **Place engine** | Vendor the place-map engine (`engine/place/`) so **place** maps import/edit/render/publish/refresh like area maps; base-overrides framing layer; place reproduce gate. Orthogonal to P6/P7. | ✅ **done (2026-07-25)** |
| **P6** | Public front: a public page per **published** map (`/m/:slug`), the published-maps gallery (`/maps`), organisation pages (`/o/:slug`), per-customer branding, map feedback, privacy/licensing page, robots + sitemap. | ✅ **done (2026-07-25)** |
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
| Accept/decline the monthly change — *shipped in P5* | New-map onboarding / bootstrapping a subject |
| Choose which of the 4 outputs a map produces — *P2 (typed maps + output toggles); P1 renders internal + external* | Anything touching upstream (S1/S2) data |

## Known follow-ups (not blocking a phase)

- **Place maps.** ✅ **Done (0.6.0-place, 2026-07-25).** The place engine is vendored in `engine/place/`
  and copied into each place map's `data/` at import, so **both** kinds render, edit, publish and refresh
  in the portal. A place's expert framing (river-hide / frozen viewport) rides a `data/base-overrides.json`
  merged **under** the customer's safe-subset overrides. Proven byte-identical by `npm run verify:place`.
  See the `[0.6.0-place]` changelog entry and `engine/place/README.md`.
- **`/legal.html` needs a final read before launch (P6).** The privacy notice is accurate about what the
  code actually collects, but it is written as a working draft and says so on the page; confirm the wording
  (and add a "last reviewed" date) before the site goes public. The **bustimes.org terms check** and the
  OSM/ODbL attribution wording remain the launch go/no-go from the planning docs.
- **Branding on the printed sheet** is deliberately *not* in P6 (a logo/colours inside the SVG needs a new
  generator knob and re-opens the byte-identical gate for every map) — expert work, P7.
- **CSRF token** on state-changing POSTs (SameSite=Lax covers cross-site POST for now).
- **Email provider** for magic links (dev prints them to the server console).
- **Staged-data retention (P5).** Accepted refreshes archive the outgoing data under `maps/<id>/archive/`,
  and declined/superseded proposed updates keep their staged payload under `maps/<id>/proposed/<pid>/` —
  both retained deliberately (reversible + auditable), but nothing prunes them. A retention/cleanup job is
  a future ops task.

## Key facts for continuation

- **Run:** `npm run dev` → `http://127.0.0.1:5180` (shopfront) and `/app` (sign-in → editor). **Prove the
  renderer:** set `FIXTURE_DIR` (a staged town render folder) and `PLACE_FIXTURE_DIR` (a place fixture)
  from the Buses repo, then `npm run verify` — it runs **both** the area and place byte-identical gates.
- **Demo (P2–P5):** `BUSES_DIR="…/Buses" node scripts/seed-demo.mjs` → admin + a platform **approver**
  + two councils (each an area map) + a health centre (**Beaconsfield Simpson Centre**, a **place** map),
  each with an editor, plus a pending application, a requested map, **March published v1.0**, a **St Ives
  v1.1 submitted for sign-off**, and **monthly updates staged for March (area) and the Simpson Centre
  (place)**. Sign in with a seeded email; the one-time link is printed to the **server console**. **Stop
  the dev server first** (one SQLite writer).
- **Auth:** passwordless magic link → opaque httpOnly session cookie (`src/auth/`). Roles editor/approver/
  admin; **every `/api/maps*` route is tenant-scoped by `customer_id`** (admins excepted).
- **Admin console (P3):** `/app/admin` (admin-only) reviews applications (approve → customer + editor +
  invite), runs the map-request queue, and edits customer quotas/plan; `/api/admin/*` re-checks the role.
  Customers **request maps within quota** from their dashboard (`POST /api/maps/request`, enforced
  server-side). The invite in dev is the magic link, logged to the console and returned in the API
  response (gated on `EMAIL_PROVIDER` unset).
- **Map lifecycle:** `requested` → (admin) `approved` → *(central build)* → `draft`/`published`; a
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
- **Monthly change acceptance (P5):** the central pipeline restages a map's data with
  `scripts/propose-update.mjs --map <slug|id> --src <fresh render dir>` (stops the dev server first —
  single SQLite writer), which stages the payload under `maps/<id>/proposed/<pid>/data` and stores a
  **pure data diff** (`src/refresh/index.js`, the service facts only). The map's own customer sees a
  **"monthly update ready"** banner + change summary, an **old-vs-new** compare (`…/proposed/:pid/preview`
  renders both sides live), and **Accept**/**Decline** (`…/proposed/:pid/accept|decline`, `loadOwnedMap`).
  **Accept** renders the new **`vN.0`** from the staged data *first*, then swaps that data into the live
  slot (outgoing data → `maps/<id>/archive/`, never deleted), re-applies the customer's overrides against
  the new palette/POI keys (orphans dropped + reported), and records a **draft** head — the
  `published_version_id` **does not move**, so the refreshed version still goes through the P4 gate before
  it is public. Accept is blocked (409) while a publish request is pending. Admins see the queue read-only
  at **Refreshes** (`/api/admin/proposed-updates`).
- **Place maps (0.6.0):** the place engine is **vendored** in `engine/place/` (`gen_internal.js`,
  `gen_external_places.js`, and the `gen_internal_place.js` title/version wrapper) and copied into each
  place map's `data/` at import — the one exception to "generators travel per-map" (place render dirs
  carry no generators). Outputs resolve their generator by candidate list (`OUTPUTS[*].gens` +
  `resolveGen`), so one `internal`/`external` output serves **both** kinds. A place's expert framing
  (river-hide / frozen viewport) lives in `data/base-overrides.json` and is merged **under** the
  customer's overrides at render (`mergeOverrides` in `engine.js`); area maps have none, so they stay
  byte-identical. Prove it with `npm run verify:place` (`PLACE_FIXTURE_DIR`). The whole lifecycle —
  import → safe-subset edit → version → publish → monthly refresh/accept — works identically to area maps.
- **Public front (P6):** the unauthenticated site is a **read view** over the publish gate. `/maps` (gallery),
  `/m/<map-slug>` (one published map: sheets, downloads, version + date, the organisation's credit, a
  feedback form), `/o/<org-slug>` (an organisation's published maps), `/legal.html`, `robots.txt` and a live
  `sitemap.xml`. Its API is `/api/public/*` (see `src/public/index.js` for the shaping). **Three conditions
  make a map public and they are enforced in SQL** (`listPublicMaps` / `getPublicMapBySlug` in
  `src/db/index.js`): a `published_version_id` exists, the customer is `active`, and `map.public_listed` is
  on. So **publish ≠ public** — the publish gate decides what is *official*, the customer's listing switch
  (`PATCH /api/maps/:id/public`, the editor's *Public page* panel) decides what is *shown*, and un-listing
  takes the page **and its files** down without touching the signed-off version or its pointer. Anywhere the
  app needs to say "this is live", it **asks `getPublicMapBySlug()`** rather than re-deriving the rule.
  Gallery images are **derived** from the published print JPG on first request and cached as
  `<base>-web.jpg` (`webPreviewPath()`), so render output and the byte-identical gate are untouched.
  Feedback lands in the P0 `message` table with `map_id` set (admin **Messages** → *About* column).
- **Per-customer branding (P6):** public name, blurb, website, badge and a **fixed-list** accent colour,
  edited at `/app/branding`, gated by `sanitizeBranding()` in `src/branding/index.js` — a whitelist in the
  same spirit as the safe subset (drops markup, `javascript:` URLs, free-form hex and unknown keys, and
  reports them). It decorates the public **page**; it deliberately does **not** enter the printed sheet —
  that needs a generator knob and would re-open the render gate (expert work, P7). No email or phone is
  brandable, so a public page never exposes contact details. `customer.slug` is auto-derived and deduped.
  **`/legal.html` is a working draft** — it needs a final read (and a "last reviewed" date) before launch.
- **P6 checks:** `npm test` (= `scripts/test-p6.mjs`) covers the branding whitelist, the SQL gate on a
  synthetic DB (draft / un-listed / archived / suspended-org all unreachable), slug de-duplication, and
  the migration on both a fresh **and** a pre-P6 database.
- **Testing the API in this environment:** drive it through the **in-app browser**, not Bash `curl` —
  network calls to `localhost` from the shell are denied here. Use `javascript_tool` `fetch('/api/…')`
  from the page origin (the session cookie rides along) and read a magic-link from `preview_logs`. This is
  how P1–P4 were verified end-to-end. Mechanics that bite (all P4):
  - `javascript_tool` evaluates a **bare expression** — no top-level `await` and no `return`. Wrap async
    work in an **async IIFE as the final expression** (no `return` keyword), which the tool awaits:
    `(async () => { const r = await fetch('/api/…'); return await r.json(); })()`.
  - Override `window.confirm = () => true` before clicking actions that confirm; drive checklist/toggle
    wiring by dispatching `change`/`input` events (`requestSubmit()` is unavailable here).
  - **Screenshots need the Browser pane visible** — if it isn't, `read_page` / `get_page_text` /
    `javascript_tool` DOM reads are the reliable verification (and preferred anyway).
  - Run an **isolated scratch server** so you don't collide with another chat on 5180 or touch the real
    demo DB: a throwaway `.mjs` that sets `process.env.DATA_DIR` + `PORT` then `import()`s `src/server.js`
    (launch.json entries carry no env), launched via a temporary launch config; **seed that scratch
    `DATA_DIR` first** (server stopped — one SQLite writer).
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
- See `CHANGELOG.md` for the **P0–P5** lessons learned.
