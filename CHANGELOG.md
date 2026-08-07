# Changelog

<!-- docstamp v1.20 | 2026-08-07 | sha=c57dbe55 -->
**v1.20** · updated 7 August 2026

Notable changes to BusMaps.uk. Loosely follows Keep a Changelog; dates are ISO (YYYY-MM-DD).

## [Unreleased]

### Added — admin user CRUD (`/api/admin/users`) — 2026-08-07

Roles (`editor|approver|admin`) and per-customer tenancy already existed in the schema, but the only
way a `user` row was ever created was the one-off invite baked into application approval — there was
no way to add a second person to an existing customer, change anyone's role, or turn an account off.
Added `GET/POST /api/admin/users` (list, optionally `?customerId=`; invite via the existing
passwordless magic-link flow) and `PATCH /api/admin/users/:id` (name/role/status — `status: 'disabled'`
is how an account is switched off; there's no delete, since disabling is the reversible,
audit-preserving equivalent and keeps sessions/audit rows meaningful). Admin-only
(`requireAdmin`), and an admin can't disable their own account. `listUsersAdmin`/`updateUserAdmin`
added to `src/db/index.js` alongside the existing (previously unused) `listUsers`.

### Changed — demo organisations restructured to a 0/1/rest split — 2026-08-07

`scripts/seed-demo.mjs`'s `DEMO[]` previously paired one demo org per map (St Ives Town Council,
March Town Council, Tannery Road Traders — real-council names disclaimed with a Sample badge). Editor
logins for two of the three org emails were undocumented (README only listed two of three), and there
was no seeded org demonstrating the empty-dashboard state. Replaced with three fully fictional
`(demo)`-suffixed organisations grouped by **map-count** rather than locality: Broadmeadow Parish
Council (0 maps), Fenmarsh District Council (1 map — March), and Oakfield Community Transport Trust
(the rest — St Ives, High Wycombe Aldi, and the requested St Ives Waitrose). Updated
`docs/R1-create-map.md`, `docs/PILOT.md`, `docs/ROADMAP.md` and `README.md` to match, and reassigned
ownership on the local dev DB (`data/` is git-ignored — a fresh `seed-demo.mjs` run reproduces this
distribution from a clean checkout, including once pointed at a production `DATA_DIR`).

### Added — "Report an issue" link on every public page — 2026-08-07

Printed leaflets deliberately carry no contact detail on the sheet itself, so the portal needed to
be the obvious place to report a problem with one. Added a "Report an issue" link to the header nav
and footer of all 12 public pages, routing to the existing contact form at
`/contact.html?kind=issue` with a new `issue` message kind (alongside `enquiry`, `question`,
`feedback` in `MSG_KINDS`, `src/server.js`). The contact form now reads the `?kind=` query param to
preselect "Report an issue with a map" and swaps in a relevant placeholder. Not pilot-gated — this
is a permanent feature, so no entry was needed in `docs/PILOT.md`'s removal checklist.

### Docs — bustimes.org licensing question resolved — 2026-08-07

The site owner (Josh Goodwin, bustimes.org) confirmed by email that our use — central,
human-in-the-loop, a handful of pages per town per month — is acceptable and that no attribution
is required. This closes the item that `docs/LICENSING.md` §3 had flagged as an open launch-gate
question. Updated `docs/LICENSING.md`, `NOTICE`, `docs/ROADMAP.md`, `docs/DOCUMENTATION-PLAN.md`
and `docs/H1-operations-handbook.md` to record the outcome; no attribution text was added anywhere.

### Fixed — place engine: re-vendored `gen_external_places.js` (tick draw-order + legend collision) — 2026-08-07

`engine/place/gen_external_places.js` had drifted since the 2026-08-06 ellipse-fit hub-edge
upgrade — the vendored copy was still the pre-upgrade version. Re-vendored from the skill, which
also carries two bugfixes discovered while filling `minutesToDestination`/`stops[]` on all 5
shipped places: (1) intermediate-stop ticks were drawn *before* their spoke line, so the line
painted over them — every place's ticks were invisible; fixed by drawing the line first, ticks on
top (matches the town engine's order). (2) the auto legend-placement search only treated
destination/hub node boxes as a hard no-go, never tick-label text, so the panel could land
directly on top of tick labels (St Neots Town Centre's "Huntingdon / St Ives dir" spoke); fixed by
adding each tick label's bounding box to the same hard-constraint list. Re-ran `npm run verify` /
`test:p7` / `test` (all pass), regenerated the `High Wycombe Aldi` portal fixture reference through
the fixed engine, and re-synced `ci-reference/` for all 5 places via `sync_ci_reference.js`. See
`make-place-bus-leaflet` skill `references/gotchas.md` (2026-08-07 section) for the full write-up.

### Fixed — admin/review consoles: replaced `<table>` with CSS Grid rows — 2026-08-07

Every table in the admin console (all 8: applications, map requests, awaiting-build, customers,
messages, refreshes, audit, ops store) and the review console's publication-history table had their
header row visually detached from their body columns — headers bunched left, data spread to fill
the full width. Root cause: `table.grid` used `table-layout: fixed` with a `<colgroup>` (the
textbook-correct way to pin table columns), but in real Chrome — reproduced in Incognito with
extensions off, so not an extension — the fixed-column widths silently stopped being shared between
`<thead>` and `<tbody>` once a body row contained unbreakable content (a `<button>`, a pill/badge)
sitting under a `white-space:nowrap` header cell. `table-layout: auto` vs `fixed` on a live clone
produced byte-identical (wrong) measurements, `<colgroup>` percentages read back as `0px` via
`getComputedStyle`, and no single CSS property (removing nowrap, `min-width`/`max-width` on
`.wrap` cells, `border-collapse`, stripping badges) fixed it in isolation — only converting away
from `<table>` did. See `docs/DEVELOPING.md` "Table-like grids" for the write-up and the fix
pattern (`.grid-table` / `.gt-row` / `.gt-cell` in `app.css`, `gtOpen()` in `admin.js`) — reuse it,
don't reintroduce a real `<table>` for anything with buttons/badges in a data cell.

### Changed — reworded "sign-off" as "review", re-scoped what review claims — 2026-08-07

Public copy, the app UI, the checklist and the docs all said a person "signs off" every map, and
several places layered on extra rigor words ("cross-checked", "check it carefully", "transit-safety
promise", "red-team evidence") that overstated what happens in practice. What the approver actually
does today is a reasonableness check — does this look right — not an independent re-verification of
routes or timetables against source data. Two changes, everywhere the claim was made:

1. **Terminology**: "sign-off"/"signed off" → "review"/"reviewed" throughout (public pages, app UI,
   `src/publish/index.js`, `src/server.js`, docs, runbooks). `CHANGELOG.md`'s own history is
   untouched — it's a record of what was said at the time, not current copy.
2. **Scope**: the `CHECKLIST` items in `src/publish/index.js` (bumped to `CHECKLIST_VERSION = 2`)
   and every public/doc description of review now say plainly that it's a visual check, not
   verification against timetables. See `docs/PILOT.md`, `docs/LICENSING.md` §5,
   `docs/R3-review-and-publish.md`, and the FAQ/legal/terms pages.

If the review process becomes more rigorous later (e.g. routine timetable cross-checks), upgrade
the checklist and the copy together rather than letting the words run ahead of the practice again.

### Fixed — re-vendored place external-map engine, refreshed the fixture — 2026-08-06

`engine/place/gen_external_places.js` was re-vendored from the skill (`make-place-bus-leaflet`)
after a fix session brought the place external map up to the level of the recently-upgraded area
external map: crisp (not blobby) dashed limited-service spokes, an auto-sized boxed operators
panel that now searches for a placement clear of both destination nodes AND spoke lines (not just
a first-fit), a hub clear-zone sized to the place label so route badges are never hidden under it,
and the version stamp moved to the bottom-right corner. Full detail in the skill's
`references/gotchas.md` (2026-08-06 section). Consequence: the `High Wycombe Aldi` portal fixture
(`Buses/Places/_portal-fixture/`) was regenerated from its own `routes.json` +
`base-overrides.json` through the fixed engine — its shipped `external.svg`/`.jpg` legitimately
changed, this was not a gate-relaxation. `npm run verify`, `verify:place`, `test:p7` and `test`
all pass against the refreshed fixture. All 5 built places (Beaconsfield Simpson Centre/Waitrose,
St Neots Tesco Extra/Town Centre, High Wycombe Aldi) were rebuilt through `stage.js` in the
separate Buses repo and their external maps refreshed; this repo only carries the vendored
engine + fixture, not those places' own render output.

### Added — flag maps affected by upcoming GTFS changes — 2026-08-03

New `scripts/check-upcoming-refreshes.mjs` (`npm run check-upcoming`) cross-references the Buses
side's monthly `gtfs_upcoming.py` report against the portal's own maps and queues a `refresh-flag`
message — reusing the existing admin Messages inbox, no new UI — for every **built** map (demo or
real customer, treated identically; Path A from the "External maps feature planning" plan) whose
town/place shows upcoming changes. Area maps match by exact town name; place maps match by a
substring check on `map.subject` (places have no town field of their own). Idempotent: a map already
flagged for a given report date is not flagged again. It deliberately does **not** call
`propose-update.mjs` automatically — `gtfs_upcoming.py` only mines GTFS facts, it doesn't regenerate a
leaflet, so a human (+ Claude) still has to re-run the skill and produce a fresh render; the message
names the exact `propose-update.mjs` command to run once that exists.

### Added — customer download of the disagreements audit, as a PDF — 2026-08-03

Every published map can now carry a "Disagreements report" download: the bustimes.org-vs-operator
audit trail (`disagreements.docx`, generated by the `make-bus-leaflet` skill's `gen_disagreements.py`
in Stage S1) converted to PDF via LibreOffice headless (`soffice --headless --convert-to pdf`, invoked
directly — not the office skills' wrapper, which fails on Windows). Only the PDF ever reaches the
portal; the `.docx` stays the internal editable source of truth, so what a customer sees is finalised
and non-editable.

`disagreements.pdf` is a static per-map extra, not a render output — it has no toggle and no SVG/JPG
pair. `OUTPUT_FILES` (`src/maps/store.js`) carries it as one extra entry outside the `OUTPUTS`-driven
list, so the existing generic download/serve routes (`downloadsForVersion()`,
`/api/maps/:id/versions/:key/:file`, `/api/public/maps/:slug/:file`) pick it up for free. `import-map.mjs`
auto-detects it from the town's `_latest/disagreements.pdf` (kept current by the skill's
`refresh_latest.js`) when importing an AREA map — place maps don't have one yet, since
`make-place-bus-leaflet` has no disagreement audit stage. `renderVersion()` (`src/maps/engine.js`)
copies it into every rendered version's folder, and `carryExpertTuning()` carries it forward into a
staged monthly refresh that doesn't bring its own (same mechanism as `diagram-layout.json`). Surfaced
in the editor's downloads row (`DL_LABELS`) and on the public map page, in the "About this map" card.

### Added — opt-in per-customer operator filter — 2026-08-03

A third safe-subset key, `hiddenOperators`, alongside `routeColors` and POI hide/show: a customer can
untick an operator in Map Tuning to drop all of its routes from both the "within" and "from" maps —
route lines, badges, Services panel entries and its own legend row. Off for every customer by default
(`customer.hide_operators_enabled`, admin-toggleable from the Customers panel); the editor UI hides the
whole Operators panel unless the flag is on, and the server rejects the key outright for anyone it
isn't enabled for, even if the client somehow sends it.

The engine side of this shipped first in the `make-bus-leaflet`/`make-place-bus-leaflet` skills
(`gen_internal.js`, `gen_external_radial.js`, `gen_external_busway.js`, `gen_external_places.js`) —
absent/empty `hiddenOperators` is byte-identical, gated PASS on every town/place fixture — then
vendored here (`engine/place/gen_internal.js`, `engine/place/gen_external_places.js`) and re-verified
with `npm run verify`. New `scripts/test-safe-subset.mjs` (`npm run test:safe-subset`, folded into
`npm test`) covers the validation boundary directly.

## [0.9.0-pilot] — 2026-08-02

The release that made the pilot presentable: it says what it is called, what it costs, who is behind
it, and which of its outputs is not a tick-box. `package.json` and `src/server.js` have carried this
version number since the pilot-mode work; this is where it is written down.

### The BusMaps.uk repositioning — 2026-08-02, in one place

Everything dated 2026-08-02 below belongs to one piece of work, done over seven sessions against
[`Buses/Development Docs/busmapsuk-repositioning-plan_2026-08-02.md`](https://github.com/PeterC66/community-bus-maps),
which is the plan of record and carries the per-session detail and lessons. The short version of
**why**, since the individual entries only say what:

The system had outgrown the way it described itself. It was called *Community Bus Maps* in a hundred
places while the domain said something else; its shop window was a **place that had closed**; it made
no claim about the one capability that most distinguishes it commercially (knowing how hard a town
is *before* quoting); it had a page saying what it does and none saying what it would cost; and it
offered, as a tick-box next to three generated outputs, an output that is **finished by hand and
re-finished at every refresh**. Each of those is small. Together they meant a visitor could not
answer "what is this, what would it cost me, and who is behind it" without asking.

So, in order: the name became **BusMaps.uk** everywhere a person can see it (the repo, the package
name and the service id deliberately did not change — that is stated in the README so nobody
"fixes" it). The **Simpson Centre** was replaced by **High Wycombe Aldi** as both the shop-window
example and the byte-identical fixture — which immediately earned its keep by exposing that the
vendored place engine was 445 lines behind the skill, invisible for weeks because the old fixture was
frozen against the same old code. **High Wycombe** was added as an area example told as the
complexity-triage story, because RED → GREEN with the scores on either side is the most credible
thing the system can say about itself. **`/pricing.html`** describes the model with no figure on it,
and **`/opportunity.html`** says plainly that this is a one-person project looking for a CIC. The
**tube-map diagram** stopped being a tick-box: it is badged wherever it is offered, explained in the
FAQ, and request-only with the refusal enforced server-side.

Two habits came out of it and are worth keeping. **Every count on a public page was checked against
the disk rather than copied from the plan** — which is how "six place maps" became five, how "proven
on four towns" became seven, and how a claim that the restore drill had been *rehearsed* came out
altogether. And **the decks now generate from tracked source** ([`BusMapsUK/deck-src/`] in the Buses
repo): three of the six had already lost their generators to expired scratchpads and had to be
reconstructed by reading the shipped `.pptx` back.

Still open, unchanged by any of this: the bustimes.org terms question (`docs/LICENSING.md` §3), the
final read of `/legal.html`, CSRF, and an email provider.

### Added — an opportunity page, for the visitor who would rather run this than buy it
- **New [`public/opportunity.html`](public/opportunity.html)** — "Take this on": the co-founder pitch
  for handing the system to a **Community Interest Company**, with four things a serious candidate
  needs and rarely gets. *What the asset actually is*, stated concretely (seven towns and five places
  built; the complexity gate; three approval gates and the monthly cycle; an operations handbook and
  six runbooks; Apache-2.0 on GitHub; open data end to end). *Why a CIC* — the cross-subsidy from
  campuses and business parks to parishes and community transport is governance, not goodwill, and
  the asset lock keeps it that way. *Who would suit it*, including that this is a one-person project
  and **succession is the problem being solved**. And *what is not resolved*: bustimes.org's terms,
  and the fact that no decision has been taken between a CIC and a small commercial supplier.
- **Linked from the footer of every public page** ("Take this on") and from one strip at the foot of
  the home page. Not in the nav: it is not part of the shopfront journey.
- **Every count on the page was checked against the disk**, not taken from the plan — which is how
  "six place maps" became **five** (Beaconsfield Simpson Centre and Waitrose, High Wycombe Aldi,
  St Neots Tesco Extra and Town Centre). The claim that the restore drill had been *rehearsed* was
  removed for the same reason: `docs/DEPLOY.md` documents the procedure, and there is no record of it
  having been run. The page now says it is written down, which is what is true.
- **No figure, competitor estimate or effort-per-map number appears on it** — that material stays in
  the private ops folder and goes to a candidate in conversation. The page says so.
- **The pitch's "proprietary technology" was corrected to "openly licensed"** when it moved onto the
  site: the repository is public and Apache-2.0, so the original wording was simply wrong.
- `STATIC_PAGES` gained `/opportunity.html` **and `/terms.html`**, which had been in the footer but
  missing from the sitemap. The rule is now written down beside the list: the sitemap and the footer
  should name the same pages. What keeps the page unindexed during the pilot is `robots.txt`.

### Changed — the tube-map diagram is warned about, and request-only
- **The cost is now stated wherever the diagram is offered.** The home page's *Four outputs* card, the
  examples-page note and the `pricing.html` Extra list all carry a **hand-finished · extra** badge and
  say why: the machine solves the topology, then every line and interchange is *placed by hand* — and
  re-placed whenever the network moves. A new FAQ answer at
  [`/faq.html#diagram`](public/faq.html) makes the real point explicitly: because the hand placements
  are **pins we maintain**, the diagram costs drawing time in the *updates*, not only in the first
  build. That is why it is priced separately rather than folded into the map.
- **It is no longer a tick-box.** `OUTPUTS.internal_diagram` is marked `requestOnly` in
  [`src/maps/store.js`](src/maps/store.js). The editor shows it locked with an **Ask us** button;
  pressing it raises a `diagram-request` **message** (the existing table, with the map attached) that
  the admin console already displays — it switches nothing on. Granting it stays what it was: an admin
  ticking it, or the pin editor's save doing so itself.
- **The lock is server-side.** The decision moved out of the route into a pure
  `chooseOutputs()` in [`src/maps/engine.js`](src/maps/engine.js), which the PATCH handler now calls:
  a non-admin asking for `internal_diagram` gets **403** with the whole change refused, and a granted
  diagram can be neither switched off nor lost by a PATCH that omits the key. Nine new checks in
  `test-p7.mjs` assert the rules, and four more assert the route is actually using them — hiding a
  checkbox is UX, not security.
- Fixed alongside: `applyLock()` re-enabled *every* output checkbox when a map came out of review,
  including ones disabled for their own reason (an output this map cannot produce). Controls disabled
  on their own account now carry `data-fixed` and stay that way.
- `/faq.html#diagram` opens the answer it points at (`public/js/faq-anchor.js`) — answers are
  `<details>`, and a link into a collapsed one is not much of a link.

### Added — a pricing page, with no figures on it
- **New [`public/pricing.html`](public/pricing.html)**, in the nav between Examples and FAQ, in the
  footer of every page and in the sitemap. It leads with *free during the pilot* and then describes,
  entirely in the future conditional, **what** would be bought (print-ready sheets, the monthly
  maintenance cycle, the public page — saying plainly that the maintenance is the product and the
  one-off sheets are what everyone else sells), **how** a price would be arrived at (a build fee
  quoted after the survey, plus an annual fee per map), what would be included versus extra, how it
  compares, which budgets normally pay, and that we do not print.
- **No figure appears anywhere on it.** The commercial model — rates, competitor estimates,
  effort-per-map — stays in the private ops folder. What is published is the *structure* of the
  model, which is what a prospective buyer actually needs in order to decide whether to ask.
- The FAQ's "How much does it cost?" now points here, and a new FAQ entry answers *why the price
  would depend on your town*. The home page's closing note links here too.

### Added — High Wycombe as the area example, told as the triage story
- **A fourth card on [`public/examples.html`](public/examples.html)** using the area images prepared
  last session, plus a **"Complex towns"** section at `#complex`: what makes a town hard to draw, the
  fact that it is *scored before the expensive work starts*, and High Wycombe's own
  **RED → GREEN** before-and-after (31 lines / 320 stops / two-thirds of the typical route buried,
  down to 11 colour groups / 91 stops / nothing congested) with the remedy ladder in plain English.
- **A "Does it work on a big town?" strip on the home page** carrying the same story in short, so the
  system does not read as a one-town trick. Section shading alternates down that page, so the three
  sections below the new one flip to keep the rhythm.
- The claim that the shown map *is* the post-triage build was checked, not assumed: both example JPGs
  are downscales of the current `_latest` render (RMS grey difference ~4–5 against a LANCZOS
  downscale of the source, i.e. resampling and JPEG only).
- High Wycombe has no `internal-schematic` output, so its card shows internal + external like every
  other card and claims nothing more.

### Changed — the shopfront speaks to five pain classes, not six organisation types
- **"Who it's for" on the home page** was organised by *type of organisation*; it is now organised by
  *pain*, around the five UK-wide classes: transport authorities and councils; healthcare, campuses
  and schools; business and science parks; town centres, BIDs, tourism and attractions; bus operators
  and community transport. A sixth tile keeps the door open for everyone else.
- **[`public/apply.html`](public/apply.html) lets an applicant self-identify by class.** `ORG_TYPES`
  in [`src/server.js`](src/server.js) gained the five class slugs; **the original seven values are
  still accepted** so that stored applications and seeded demo rows keep validating, since
  `customer.type` is copied straight from this field on approval. No schema change — only the column
  comment. Verified against a scratch database: each new value and the legacy `council` accepted, an
  unknown value rejected with 400.

### Changed — Simpson Centre replaced by High Wycombe Aldi as the place example
- **The Simpson Centre has closed**, so it was a poor shop window as well as a stale one. The place
  example everywhere is now **Aldi, Tannery Road, High Wycombe** — the *busy* case (11 services
  calling, 14 reachable places), which demonstrates more than the quiet one did.
- Swapped: [`public/examples.html`](public/examples.html) and its images, the seeded demo map and
  organisation in [`scripts/seed-demo.mjs`](scripts/seed-demo.mjs), `PLACE_FIXTURE_DIR`, and the
  references in [`README.md`](README.md), [`docs/H1-operations-handbook.md`](docs/H1-operations-handbook.md)
  and [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **The demo customer is invented, and deliberately not the retailer.** A map's *subject* may be a
  real place — that is just geography — but naming a real commercial brand as the customer would
  read as a signed-up client of a service that has none. The seeded org is
  *Tannery Road Traders (sample)*, `is_demo`, with the usual Sample badge and disclaimer.

### Fixed — the place gate was checking the wrong SVG
- **[`scripts/verify-reproduce-place.mjs`](scripts/verify-reproduce-place.mjs) rasterised the
  *reference* SVG rather than the regenerated one**, so the JPG line reported "pixel-identical" on a
  run where the SVG genuinely DIFFERED — the one run where you need it to be believable. It now
  rasterises what it just generated.

### Changed — fixture and source paths follow the Buses folder restructure
- **The separate Buses data repo now nests towns under `Areas/`** and places under their area
  (`Areas/<Town>/Places/<Place>/`), with `Places/_standalone/` for places whose town has no area map.
  `Places/_portal-fixture/` is unchanged. Updated here: `.env.example` and `.env` (`FIXTURE_DIR`),
  `scripts/seed-demo.mjs` (`renderParent` for all three seeded maps) and the `import-map` /
  `propose-update` examples in [`README.md`](README.md).
- **Both byte-identical gates were re-run against the new layout and still PASS** with unchanged byte
  counts — area 471,569 / 33,768 / 253,112 / 252,096 B, place 60,014 / 10,068 B — and `npm test` is green.
- **`FIXTURE_DIR` points two versions behind the newest render** (St Ives `S5-render/v6.6`, newest
  `v6.8`). That is deliberate and it is now *pinned* in the Buses repo's `retention-pins.json`, because
  the obvious "keep the newest couple of builds" tidy-up would otherwise delete the fixture and break
  `npm run verify:place`/`:area` silently. **If you ever re-point `FIXTURE_DIR` or
  `PLACE_FIXTURE_DIR`, update that pin file in the same change.**
- The Buses repo now tracks build *inputs* (`S1`–`S3`, manifests, READMEs, `*.docx` reports) and
  ignores build *outputs* (`S4`/`S5`/`S6`/`_latest`). `Places/_portal-fixture/` is tracked, so
  `npm run verify:place` is reproducible from a clean checkout of that repo.

### Docs — R1 says how to build a demo/example map
- **[`docs/R1-create-map.md`](docs/R1-create-map.md): new "Demo and example maps" section.**
  The obvious reading of R1 — "our own maps have no customer, so omit `--customer`" — produces an
  **unowned** map, which is admin-only for good: every public query joins `customer`, so it can never
  reach `/maps`, `/m/<slug>` or `/o/<org-slug>`, and with no editor account the edit → sign-off loop
  can't be demonstrated either. The section says to seed a demo organisation (`is_demo`, "Sample"
  everywhere) instead, preferring `DEMO[]` in `scripts/seed-demo.mjs` because `data/` is git-ignored
  and a map only in a local `DATA_DIR` does not survive a fresh checkout. Also restates the naming +
  disclaimer rule for orgs named after real bodies, and that Sample labelling is not pilot-gated.
  The `--customer` row in the flag table now points at it.

### Fixed — three faults found driving the editor for real
- **A newly enabled sheet said "Save to render" instead of rendering.** Switching on an expert
  style put it in the tab strip, but the saved version has no file for a sheet that did not exist
  when it was rendered, and the editor only previewed on an edit — so the first thing you saw was
  a dead panel that a toggle off-and-on cleared. The editor now previews the missing sheets on
  load (and says "Rendering…" while it does), which is the same render it would have done anyway.
- **A recoloured route could hide its own number.** A route's label ink comes from `textOn` in
  the imported data and does not follow a recolour: St Ives route 9 changed to black kept `#111`
  text and the 9 disappeared, in the editor's swatch list and on every sheet. New
  `src/render/badgeContrast.js` re-inks a badge whose number has vanished, applied to the
  finished SVG in `renderMap.js` — the same trick as the pilot band, and for the same reason
  (generators are vendored per map, so `engine/` cannot reach a map that already exists). It is
  **not** pilot-gated. The threshold is deliberately 2:1, well under WCAG's 3:1 for large text:
  several shipped route colours sit just under 3:1 (white on `#EE7733`, on three towns' maps),
  and quietly restyling somebody's palette is not this function's job. `scripts/fix-badge-contrast.mjs`
  repairs sheets already in the object store, published ones included.
- **The diagram pin editor's handles were nowhere near their junctions.** Handles were drawn at
  the solver's page-mm, but the sheet under them is in a different frame — `gen_internal` re-fits
  the solver's workspace, and the pilot band shrinks the document again (the two differ by ~2×
  plus an offset, so you could not tell which handle was which). Rather than re-deriving
  transforms that belong to the generators, `src/expert/index.js` now **measures** the composite:
  the sheet is solved with `EDITOR_KEYS` so its stop ticks are tagged, and a robust least-squares
  fit against the workspace's own coordinates recovers the affine, which the editor uses for
  handles and inverts for drags. Median handle error on St Ives: 5.4 mm → 1.4 mm (handle radius
  is 1.6 mm). `diagram_internal.js` gained one field (`wll` per junction) to make the fit
  possible; `solved-nodes.json` is not part of any rendered output and both gates stay green.

### Added — pilot mode: say plainly that this is not a live service
- The portal read as an established service with customers. It has none: every organisation in
  the database is seeded demo data and every map on the public site is one of ours. Anyone
  looking at it — a prospective customer, a colleague — would have concluded otherwise.
- **One switch.** New `src/config.js` exports `PILOT`, read from `PILOT_MODE` and **on unless
  explicitly `0`**, so forgetting the env var fails towards the honest state. `PILOT_MODE=0`
  removes the banner, the title prefix, the sheet band and the robots block in one go.
- **Web chrome.** There is no template engine (17 hand-written HTML files with a copy-pasted
  header), so the banner is injected by one server-generated `/js/site-banner.js` — one
  `<script>` tag per page, one place for the copy. It also prefixes the tab title, via a
  `MutationObserver` so the public map/org pages can't overwrite it after their fetch.
- **Every rendered sheet** gets a red band across the top (`src/render/pilotStamp.js`). It
  RESERVES space rather than overlaying: the sheets have no reliable whitespace, so the artwork
  is shrunk ~4% and slid down. Applied in `renderMap.js` *after* the generator runs, which
  covers all four outputs and every map's vendored generator copies from one function — and
  leaves the byte-identical gate untouched (the two `verify-reproduce` scripts pass
  `stamp: false`, since they test determinism, not presentation).
- `scripts/restamp-renders.mjs` adds or strips the band on sheets already in the object store,
  including published ones. The transform is lossless (stamp → strip is byte-identical) and
  idempotent.
- **Sample labelling, NOT pilot-gated.** New `customer.is_demo` flags the organisations
  `seed-demo.mjs` invents — set on create and backfilled on re-run — surfaced as a red
  **Sample** badge plus an "this organisation is invented" note on `/maps`, `/m/`, `/o/` and the
  home strip. Demo data stays demo data after the pilot ends.
- **Truthful copy, also not gated.** "Maps our customers have published", "those are live, kept
  up to date", "we will get back to you", "our team", "always looks right" were false and are
  rewritten to be true in either state. New `#pilot` FAQ entry is the banner's link target.
- `docs/PILOT.md` is the removal checklist; `grep -rn "PILOT:"` finds every gated block.
- Gates: `npm test` (P6/P7/lifecycle) and `npm run verify` (area + place) both green, before and
  after; verified end to end on a scratch data store including the `PILOT_MODE=0` revert.

### Added — `docs/DUMMIES_GUIDE.md`, a plain-commands front door
- New `docs/DUMMIES_GUIDE.md` for someone who knows cmd/PowerShell, FTP and GitHub but not git
  or Node: the four git commands actually needed day to day, starting the local dev server,
  seeding demo data, and a cheat sheet — with pointers into the deeper docs rather than
  repeating them.
- Records that the current 20i hosting package is standard shared hosting (FTP + phpMyAdmin)
  and, per 20i's own docs, **cannot run Node.js** — that needs their separate "Node.js
  Optimised Cloud Server" product. Documents Render.com's free tier as a no-cost demo path
  instead, including its two real limits (15-minute spin-down, non-persistent disk on the free
  instance type).
- Linked from `README.md` (above quick start, and in the layout doc index).

### Added — `docs/DEVELOPING.md`, the developer counterpart to the operator docs
- The documentation set covered how to **run** the service but not how to **change** it. New
  `docs/DEVELOPING.md` states the two things a change must not break — **determinism** (no network,
  no clock, no randomness, absent-config ⇒ byte-identical) and the **three approval gates** (org
  approval, map request + quota, publish sign-off) — plus the generator env contract
  (`LEAFLET_DIR` / `SKILL_ASSETS` / `OVERRIDES_FILE` / `EDITOR_KEYS`), the **`LEAFLET_DIR` trap**
  that makes an expert style silently render as the plain geographic map, a where-things-live index,
  and the gates to run.
- Documents the **vendored-engine hand-off** explicitly: `engine/`, `engine/place/` and
  `engine/expert/` hold byte-for-byte copies of an upstream authoring toolchain, with **no automated
  drift check** — so a change there is unfinished until it is re-copied and every gate re-run.
- Records that **`npm run verify` exits 0 with "skipping" when `FIXTURE_DIR` is unset**, so a green
  run in a fresh clone proves nothing about the renderer. Also noted in `README.md`.
- Linked from `README.md` (quick start + layout) and the Operations Handbook's document map.

## [0.8.1] — 2026-07-25

Closes the **two code rough edges** the P7 docs recorded as known-but-unfixed. Both were seams
where an operator had to work around the software by hand: a customer's approved map request and
the map the pipeline built were two different rows, and taking a wrong published map back to a
known-good version meant a full re-run through the gate. Neither adds a new concept — both make
an existing lifecycle finish.

### Added — the importer fulfils an approved request in place
- **`import-map.mjs --request <mapId>`** builds an approved request **into that row**: the
  placeholder *becomes* the built map. Owner, kind, name, slug and subject come from the request
  (each still overridable), the row moves `approved` → `draft`, and the fulfilment is audited as
  `maprequest.fulfil`. One row, **quota counted once**, nothing to archive afterwards.
- It refuses, before touching anything, an un-approved request (approval stays the gate), a map
  already built (new data is the monthly refresh, not an import), a `--kind` that differs from what
  was requested (quota is per kind), and a `--customer` that would **re-own** someone else's map.
  A plain import whose slug collides with a queued request now prints the `--request <id>` to use
  instead of letting a duplicate row be created.
- **`--list-requests`** prints the build queue. The admin console shows the same queue —
  **Map requests → "Approved — awaiting a build"** — each row carrying its exact build command
  (with a Copy button) and an **Archive** action for a request that will never be built (which
  frees the quota slot; previously only a still-`requested` row could be archived).
- New: `listAwaitingBuild()`, `updateMapIdentity()` (a whitelist — owner/kind/status are not
  touchable through it), and `adminSummary().awaitingBuild`, so the tab badge counts **both**
  halves of the lifecycle: decide it, then build it.

### Added — one-click revert to the previous published version
- **`/app/review` → "Published maps"** lists every map with a published version; opening one shows
  its **publication history** — each version ever signed off, newest first, with its approver,
  their note and its print files — and **Revert to this**.
- `POST /api/review/maps/:id/revert` (approver/admin, **reason required**, audited as
  `version.revert`) moves only the **public-current pointer**. Nothing is re-rendered and the
  customer's working head is untouched, so a correction can carry on being prepared.
- The candidates are **only** versions with an approved `publish_request` whose rendered files are
  still on disk, so a revert can never serve bytes that did not pass the gate; a pruned version says
  so and sends you to publish a correction. The version reverted *away from* stays in the history
  (roll forward, or revert again). A revert refuses while a publish request is open, so an approver
  is never reviewing against a pointer moving under them.
- Target selection is `chooseRevertTarget()` in `src/publish/` — pure, so the rules are unit-tested
  away from HTTP. New queries: `listPublishedHistory()`, `listPublishedMaps()`.

### Added — tests
- **`scripts/test-lifecycle.mjs`** (`npm run test:lifecycle`, and in `npm test`): 50 checks over both
  seams — the build queue, in-place adoption, every importer refusal (driven through the real CLI
  against a throwaway `DATA_DIR`), the identity whitelist, publication history (including that a
  *rejected* submission never enters it), every `chooseRevertTarget()` rule, and the pointer move
  leaving the editor's head alone.

### Verified
- **End-to-end on a copy of the demo store**: an approved area request was fulfilled by
  `--request 4` → the same row became a **draft** with 4 rendered files, owner and request note
  intact, out of the build queue, quota **unchanged at 2** (it was already counted), audited.
- **A published map reverted through the UI**: pointer `v1.1` → `v1.0`, editor's head still `v1.1`,
  `/api/public/maps/st-ives` immediately served `v1.0`, `v1.1` offered as the roll-forward target,
  reason recorded in the audit trail. Empty reason and a map with nothing to revert to were refused.

### Docs
- **R1** (create a map) replaces its "known rough edge" with the `--request` flow + refusal table;
  **R6** (incident response) replaces its rough-edge note with the revert procedure and what it does
  *not* do (it does not re-list an unlisted map); **R2** and the documentation plan follow suit.

### Changed
- Version → `0.8.1`.

## [0.8.0-P7] — 2026-07-25

Phase **P7** — **expert styles + ops hardening.** Two halves, and they are the last two
pieces of the original plan: the **other two outputs** (the octolinear schematic and the
tube-map diagram) now render in the portal with the same byte-identical guarantee as the
geographic pair, with the **diagram pin editor re-homed** as an admin-only tool; and the
service becomes operable — readiness, metrics, backups, a retention job, a container +
deploy runbook, and the licensing sign-off gate.

### Added — expert styles (the third and fourth outputs)
- **`engine/expert/`** — the schematic + diagram engines, vendored (see its README). Unlike the
  area generators (which travel per-map) and the place engine (copied *into* each place map),
  these are **portal-owned**: a town's render folder never carried them and they are identical
  for every map. `OUTPUTS` marks them `engine: 'expert'`, so `resolveGen()` returns an absolute
  path out of that folder and `generateSvg()` accepts it.
- **Two thin wrappers** (`gen_internal_schematic.js`, `gen_internal_diagram.js`) around the
  verbatim pre-stages. Both pre-stages are *geometry* stages: they rewrite the map's geometry
  into a workspace and then run **the map's own `gen_internal.js`** there, so badges, labels,
  the Services panel and POI icons are reused rather than reimplemented. The wrappers name the
  artefact, fail loudly when the map has no config, and — the one that would have bitten
  silently — **delete `LEAFLET_DIR` for the child** (the portal always sets it; the pre-stage
  runs its child with `cwd` = the workspace, and `gen_internal` prefers `LEAFLET_DIR`, so an
  inherited value reproduces the ordinary geographic map instead of the style).
- **Opt-in availability** — an expert output is offered only when the map's `routes.json`
  carries the pre-stage's config key (`internalSchematic` / `internalDiagram`), via a new
  `requiresConfig` + `hasRoutesKey()`. A map without it shows the output as *unavailable*
  rather than failing at render time, and the server refuses to enable it.
- **Off by default** (`defaultOutputs()`, `effectiveOutputs()`): a schematic or diagram is an
  editorial choice, so a map opts in deliberately — and a map imported before P7 does not
  suddenly start producing two more sheets on every save.
- **The byte-identical gate covers them** — `scripts/verify-reproduce.mjs` picks both styles up
  when the fixture opts in. St Ives v6.6: schematic **253,112 B SVG / 1,054,471 B JPG**, diagram
  **252,096 B / 1,077,051 B**, both byte-identical on the first run, so all **six** outputs
  (4 area + 2 place) are now gated.

### Added — the expert pin editor
- **`/app/maps/:id/diagram`** (`public/app/diagram.{html,js}`, adapted from the skill's
  `assets/diagram_edit.js`) + **`src/expert/index.js`** and admin-only `/api/expert/maps/:id/diagram`
  (state / `preview` / `save`). Drag a junction to **pin** it, drop to re-solve and see the real
  sheet, right-click to unpin. This is deliberately the mirror of the customer safe subset —
  dragging changes *layout*, which is exactly what customers may not do, so every route is
  `requireAdmin`.
- **Previews never touch the live map**: solving runs in a per-map sandbox (rebuilt when the live
  data changes). **Save** writes `diagram-layout.json` into the live data and then goes through
  the ordinary versioned render — so the tuning arrives as a *draft* that still needs the P4
  sign-off, is audited (`diagram.save`), and switches the diagram output on if it was off.
  Editing is refused while a publish request is pending, and a failed render restores the
  previous layout.
- **Pins survive a monthly refresh** — `carryExpertTuning()` copies the layout onto the staged
  payload **before** the refreshed version renders (and `swapInProposedData()` carries it forward
  as a backstop), so the P5 old-vs-new preview and the accepted `vN.0` both show the tuned
  layout. The engine re-resolves a pin by its stored lat/lon when a node key moves.
- **Pins are whitelisted** (`sanitizePins`) like every other stored instruction: finite,
  bounded page-mm coordinates on plausible keys, capped in number, everything else dropped.

### Added — ops hardening
- **`src/ops/index.js`** — a **readiness** probe that exercises what actually breaks (SQLite
  answers, `DATA_DIR` is writable, the vendored engine files are present, sharp can encode) plus
  storage/activity snapshots. `/health?deep=1` runs it and returns **503** when degraded (the
  container `HEALTHCHECK` and any load balancer should use it); `/health` alone stays a cheap ping.
- **`/metrics`** — Prometheus text (readiness per dependency, store bytes, reclaimable bytes,
  versions, pending queues, sessions), gated by `METRICS_TOKEN` or an admin session and **404**
  otherwise, so an unauthenticated scrape can't map the estate.
- **Admin → Ops tab** (`/api/admin/ops`) — dependency health, per-map disk usage (data / renders /
  staged / archived), what a prune would reclaim, and the activity counts.
- **`scripts/backup.mjs`** (`npm run backup`) — SQLite via **`VACUUM INTO`** (a consistent copy of
  a live, WAL-mode database; `cp` can capture a torn file plus a stale `-wal`), plus each map's
  `data/`, `overrides.json` and `renders/`, with a manifest and `--keep` retention. Deliberately
  skips `proposed/` and `archive/` — the bulk, and re-stageable.
- **`scripts/prune-staged.mjs`** (`npm run prune:staged`) — closes the P5 retention follow-up:
  removes staged payloads of **settled** refreshes and the data an accepted refresh replaced, older
  than `--days`, with `--dry-run`. Never touches a pending update, live data, or any rendered version.
- **`Dockerfile` + `compose.yaml` + `docs/DEPLOY.md`** — single process, single volume, reverse proxy
  in front; systemd unit, smoke test, backup schedule, **restore drill**, housekeeping, and the
  upgrade sequence (`npm test` → `npm run verify` → deploy).
- **`docs/LICENSING.md`** — the launch go/no-go: every source and its obligation, where the credits
  actually appear (on the *sheet*, which survives being detached from the site), the open
  **bustimes.org terms** question with three ways to close it, and a sign-off table.
- **`scripts/test-p7.mjs`** (`npm test` now runs P6 + P7) — the availability/enablement rules, the
  pin round-trip, that `server.js` still sanitises pins, and the ops probes on an empty store.

### Changed
- `generateSvg()` accepts an absolute generator path; `svgNameFor()` matches on the basename.
- Editor: an admin sees a **Diagram layout** link on maps that have a diagram; the outputs panel
  now says *“— expert style”* / *“— not set up for this map”* instead of “coming with expert
  styles”; downloads label the four new artefacts.
- Public pages label the new outputs for readers (“Simplified street map”, “Network diagram”).
- Version → `0.8.0-P7`.

### Verified
- **All six byte-identical gates PASS** (`npm run verify`): area internal/external, both expert
  styles, and the place pair. `npm test` green (P6 + P7).
- End-to-end on an isolated scratch server against a copy of the real demo store: the expert
  endpoint solved St Ives' diagram (25 junctions, ~1 s), a pin moved its junction to where it was
  dragged, a **hostile pin payload** was reduced to nothing usable, save was **409'd while a
  publish request was pending** and succeeded after withdrawal (v1.2, diagram output auto-enabled,
  audited), the pins persisted and reloaded, a **customer** save then rendered all four sheets with
  their recolour reaching the schematic and diagram, and a **monthly refresh** staged *without* a
  layout still produced a pinned `v3.0` (and a pinned old-vs-new preview). A drag → save through
  the real UI produced `v3.1` with 8 artefacts. Isolation: an editor gets **403** on all three
  expert routes, `/metrics` **404**, `/api/admin/ops` **403**; a place map without the config gets
  a clear **400**. Ops: readiness all-ok, the Ops tab reported 49.8 MB with 11.2 MB reclaimable, a
  backup ran **while the server was up** (38.7 MB, manifest written), and the prune freed 10.1 MB
  while leaving the pending update, live data and every render intact. Zero console errors.

### Notes / lessons
- **`LEAFLET_DIR` is inherited, and that is a trap.** A pre-stage that re-runs the main generator
  in a workspace only works if the child resolves *its own* folder. The portal is stricter than the
  desktop pipeline (it always sets `LEAFLET_DIR`), so vendoring the pre-stage verbatim required a
  wrapper that unsets it — otherwise both new outputs would have rendered as perfect copies of the
  geographic map, which no test that only checks "an SVG appeared" would catch.
- **Opt-in beats capability.** "Can the portal render it?" and "should this map have it?" are
  different questions. Keying availability on the map's own config, and enablement on an explicit
  `true`, means a pre-P7 map's save behaviour is unchanged and a customer can't switch on a sheet
  the data can't produce.
- **Carry expert tuning onto the staged data, not just onto the live folder.** The refreshed version
  renders *from* the staged payload before the swap (P5's render-before-swap), so a file copied only
  at swap time arrives one render too late — the symptom was a refreshed diagram that had quietly
  lost its pins.
- **Two editors, one gate.** The expert tool writes through the same version/publish path as the
  customer editor rather than around it. Layout work is therefore reviewable, revertible and audited
  — and "who may change what" stays a role check, not a separate pipeline.
- **`VACUUM INTO`, not `cp`.** The only safe way to back up a live WAL database in one step, and it
  is worth saying out loud in the runbook because `cp portal.sqlite` looks like it works.
- **Keep the honest asymmetry in what is kept.** Backups exclude staged/archived data (re-stageable,
  superseded) while the prune removes it — but neither ever touches a rendered version, because the
  published bytes are the promise the whole system makes.

## [0.7.0-P6] — 2026-07-25

Phase **P6** — **the public front.** P0 shipped a shopfront that *described* the service; P6 makes the
service's output public. A map that has been through the publish gate now gets a **page anyone can
visit**: the signed-off sheets to view and download, the publishing organisation's own branding, and a
"something looks wrong" form that comes back to us with the map attached. Plus a **published-maps
gallery**, an **organisation page**, a **privacy/licensing page**, `robots.txt` and a live `sitemap.xml`.

The public site is a **read view over what P4 already decided** — it stores nothing of its own and can
only reach a map that (a) has a `published_version_id`, (b) belongs to an **active** customer and (c) the
customer has left **listed**. Those three conditions live in the SQL (`src/db/index.js`), so drafts,
pending versions, archived maps, suspended organisations and all customer PII are unreachable by
construction rather than by filtering at the edge. Publishing never re-renders (P4), so a public page
serves the exact bytes an approver signed off.

### Added
- **Public map pages** — `/m/<slug>` (`public/map.html` + `js/public-map.js`): output tabs, the sheet
  inline, downloads (print JPG + SVG), version + publication date, the organisation's credit line, and the
  feedback form. `/maps` (`maps.html` + `js/public-maps.js`) is the gallery; the home page grew a live
  **"Already published"** strip (`js/published-strip.js`) that stays hidden while nothing is public.
  Unknown or no-longer-public slugs return a **real 404** page (`notFoundPage()` in `server.js`), never an
  empty shell — and never a hint that a draft exists.
- **Public API** (unauthenticated, read-only): `GET /api/public/maps`, `…/maps/:slug`,
  `…/maps/:slug/:file` (the file list is the `OUTPUT_FILES` whitelist and **the version key comes from
  the DB, never the URL** — nothing to probe, nothing to traverse), `…/maps/:slug/preview/:base`,
  `GET /api/public/orgs`, `…/orgs/:slug`, and `POST /api/public/feedback`.
- **Screen copies of the print sheets** (`src/public/index.js` `webPreviewPath()`) — an A4 300 dpi JPG is
  ~1 MB, far too heavy for a gallery, so a 1400 px copy is **derived from the signed-off print file on
  first request** and cached beside it (`<base>-web.jpg`, ~135 KB). Nothing changes at render time, the
  print bytes are untouched, and versions published before P6 get previews too.
- **Per-customer branding** (`src/branding/index.js`, `/app/branding` + `PATCH /api/customer/branding`) —
  public name, one-line blurb, website, badge (emoji or initials) and an accent colour from a **fixed
  list**. `sanitizeBranding()` is the gate, in the same spirit as `safeSubset.js`: it rebuilds the stored
  object from a whitelist, drops markup/`javascript:` URLs/free-form hex/unknown keys and **reports what
  it dropped**. Angle brackets are stripped from name + blurb as well as escaped at render. `customer.slug`
  (auto-derived, deduped) gives each organisation `/o/<slug>`.
- **Per-map public listing** (`map.public_listed`, `PATCH /api/maps/:id/public`, the editor's **Public
  page** panel) — the customer's own switch, independent of the publish gate: un-listing takes the page,
  its files and the gallery entry down **without** touching the signed-off version or its pointer, and
  re-listing restores them.
- **Map feedback** (`message.map_id`) — the public form writes into P0's existing `message` table with the
  map attached; the admin **Messages** tab gained an **About** column linking to that map's public page.
- **`/legal.html`** — what we hold and why (application, messages, account, essential cookie, rate-limit
  logs, governance audit), what we don't do (no tracking, no profiling, no payment data, no personal data
  on public pages), retention + how to ask for a copy or deletion, the BODS/OSM licences, how the sheets
  may be reused, and the Apache-2.0 code. **Marked a working draft** — it needs a final read before the
  service opens publicly.
- **`robots.txt`** (allows the public pages, disallows `/app`, `/api/`, `/auth/`) and a live
  **`sitemap.xml`** built from the static pages + every publicly-visible map and organisation
  (`PUBLIC_BASE_URL` overrides the host when running behind a proxy).
- **`scripts/test-p6.mjs`** (`npm test` / `npm run test:p6`) — the branding whitelist against a hostile
  payload, the SQL gate on a synthetic DB (draft / un-listed / archived / suspended-org maps all
  unreachable), slug derivation + de-duplication, and **both** migration paths: a fresh DB and a
  **pre-P6 DB** opened in a child process (columns added, existing customers back-filled with slugs,
  existing maps default to listed).

### Changed
- Public pages carry a **Published maps** nav link and a **Privacy & licensing** footer link; the FAQ
  answers "Does our map get a public web page?"; `examples.html` now points at the live gallery first.
- `/api/me` and `/api/maps` carry the organisation's public identity and each map's `publicUrl`; the
  dashboard shows a **Public page** pill; `/api/admin/customers` carries the branding + public page link;
  `/api/admin/summary` and `/health` count public maps and organisations.
- Public output labels are **kind-aware** (`publicLabel()` — "Buses serving this place" vs "Buses within
  the area"); the editor keeps `OUTPUTS`' own labels, which are written for the person editing.
- `.org-badge` accents are **lifted in dark mode** — the fixed palette is chosen for light backgrounds, so
  a deep green or red badge would otherwise sit too close to the dark surface.
- Version → `0.7.0-P6`.

### Verified
- Both byte-identical render gates still **PASS** (`npm run verify`: area 471,569/1,172,380/33,768/987,563
  and the place fixture 60,014/10,068) — P6 touches no render path.
- End-to-end on an isolated scratch server + a **copy of the real pre-P6 demo DB**: the migration
  back-filled slugs, `seed-demo` published both an area (March) and a **place** (Simpson Centre) map, and
  the gallery, map pages, organisation page, feedback, sitemap and robots all behaved. Branding saved
  through the UI and reached the public page; a hostile PATCH was reduced to its one legal field with the
  rest reported as rejected. Un-listing 404'd the page **and** its files and dropped it from the gallery
  and sitemap; re-listing restored them. A draft-only map (St Ives) is 404 on its page **and** its files.
  Tenant isolation holds on the new endpoints (March's map → 403 for another customer's editor); anonymous
  → 401 on branding/listing while the public API stays open; a platform account → 400 on branding.
  Mobile + dark checked (no horizontal scroll); zero console errors; `npm test` green.

### Notes / lessons
- **Publish ≠ public.** Two independent switches: the platform's sign-off (P4) decides whether a version
  is *official*; the customer's listing decides whether it is *shown*. Keeping them apart means a takedown
  is one tick and never rewrites a signed-off record, and it stops the publish gate doubling as a CMS.
- **Ask the public query, don't infer.** The editor's "you are live" link is computed with
  `getPublicMapBySlug()` — the very query the public site runs — rather than by re-deriving
  "published && listed" in the app layer. That way a suspension or a future condition shows through
  everywhere at once and the UI can't claim a page exists when it doesn't.
- **Derive the web-sized image, never re-render it.** Making a screen copy at *render* time would have
  added artefacts to every version (and a reason to re-run renders); deriving it lazily from the published
  print JPG keeps the byte-identical guarantee and retro-fits every earlier version.
- **A whitelist beats an escape.** Branding is user content on a public page, so it is validated on the
  way in (fixed accents, parsed URLs, markup rejected) *and* escaped on the way out. Two independent
  failures would be needed to put markup on a page.
- **The 404 must be a real 404.** A pretty-URL SPA shell that always returns 200 hides taken-down maps
  from search engines and tells a prober that a slug exists; checking the slug in the route handler (and
  making `/o/:slug` apply the *same* condition as its API, not just "customer exists") keeps the page and
  its data from ever disagreeing.
- **No contact details in branding, on purpose.** An organisation's public page carries no email or phone;
  feedback comes through our own form. Nothing personal becomes scrapeable by adding a public front.

## [0.6.0-place] — 2026-07-25

**Place maps now render in the portal** (previously area-only). This closes the standing "place-map
engine not vendored" follow-up: **place** maps (`make-place-bus-leaflet`) can now be imported, edited
with the safe subset, versioned, published and monthly-refreshed exactly like **area** maps — the same
deterministic, byte-identical guarantees. It is orthogonal to the P6/P7 roadmap (marketing / expert
editor), so it is tagged `place` rather than a phase number.

Why it was needed: area maps carry their generators *per-map* (staged from the town render dir), but the
place skill keeps one engine in the skill and never copies it into a place's render folder — so a staged
place payload has the `*.json` inputs but no generators, and the importer/refresh refused it.

### Added
- **Vendored place engine** (`engine/place/`) — the one place in the repo where generators *are* vendored,
  because place render dirs carry none. Three files, copied into each place map's `data/` at import:
  `gen_internal.js` (the **same** town generator area maps use — road-following via `internalRoads` +
  `roads_geo.json`/`routes_paths.json`, all baked into the payload → no network), `gen_external_places.js`
  (the aggregated-destination external radial; already honours top-level `routeColors`), and a new thin
  wrapper **`gen_internal_place.js`** that runs `gen_internal.js` then supplies the two things it can't
  express for a place — the **title** ("Buses serving <place>") and the **version stamp** (strips the
  place convention's leading `v` so `version:"v1.0"` renders `Map v1.0`, not `vv1.0`). No network, no
  `overrides.json` mutation. See `engine/place/README.md`.
- **Base-overrides layer** (`src/maps/store.js` `base-overrides.json` / `src/maps/engine.js`
  `readBaseOverrides` + `mergeOverrides`) — a place's *expert framing* (river-hide, a frozen viewport)
  ships as a small `overrides.json`; that is **not** a customer edit, so the importer stores it as the
  map's `data/base-overrides.json` and the render path merges it **under** the customer's safe-subset
  overrides (customer wins). Area maps have no base ⇒ the merge is a proven no-op (St Ives/March stay
  byte-identical).
- **`scripts/verify-reproduce-place.mjs`** + `npm run verify:place` (and `verify` now runs area **and**
  place) — proves the vendored place engine reproduces a skill-rendered place leaflet **byte-for-byte**
  (SVG identical, JPG pixel-identical), including the merged base framing. Point `PLACE_FIXTURE_DIR` at a
  place fixture (self-consistent payload + reference renders). Verified on **Beaconsfield Simpson Centre**
  (road-following + river-hide framing): internal 60,014 B / external 10,068 B, both byte-identical.
- **A built place map in the demo** (`scripts/seed-demo.mjs`) — Beaconsfield Simpson Centre, owned by a
  new demo org, with a **place monthly-refresh** staged alongside March's, so the accept flow is demoable
  for a place too.

### Changed
- **Generator resolution by candidate list** (`src/maps/store.js` `OUTPUTS[*].gens`,
  `src/maps/engine.js` `resolveGen`) — an output now lists generator candidates and uses the first
  **present** in a map's data folder. So one `internal`/`external` output serves both kinds: an area map
  resolves `gen_internal.js`/`gen_external.js`, a place map resolves `gen_internal_place.js`/
  `gen_external_places.js`. The UI/toggle model is unchanged (still four outputs).
- **`scripts/import-map.mjs`** — `--kind place` no longer fails fast. It validates a place payload
  (`routes.json` + `place.json`), vendors the place engine into `data/`, and splits any framing into
  `base-overrides.json` (accepts either `overrides.json` from a fresh skill payload or a pre-split
  `base-overrides.json`).
- **`scripts/propose-update.mjs`** — accepts place maps (detected by the map's `kind`): stages the
  vendored place engine + framing, same as the importer. The P5 accept/decline/preview server routes
  needed **no** changes — they were already data-driven (they read palette/POIs from the staged dir and
  `renderVersion` reads `base-overrides.json` from it), so re-applying a customer's overrides onto a
  refreshed place, preserving its framing, and keeping the published pointer put all work unchanged.
- **`src/refresh/index.js`** — the stop-count diff falls back to `routes_intown_atco.json` (a place's
  drawn/walkshed stops, same flat-array shape) when `routes_atco.json` is absent, so per-route stop
  changes show for places too. (A place's `routes_full_atco.json` is intentionally not used — its values
  are `{directions,canonical,all}` objects, not flat arrays.)

### Notes / lessons
- **Worked-example place payloads had drifted** — some shipped SVGs were rendered from an earlier
  `routes.json` and the config was hand-edited afterwards (Waitrose: a since-removed `mapNotes`, a longer
  `placeTitle`, a nudged rail label). So the gate proves **portal-engine ≡ skill-engine on the same
  payload** (rendering a fresh, self-consistent reference), which is what P0 always did — not
  "byte-identical to a possibly-stale historical file".
- **Expert framing must reach the generator via `OVERRIDES_FILE`, not `data/overrides.json`.** The portal
  always passes `OVERRIDES_FILE`, and `gen_internal` then ignores `data/overrides.json` — so the place
  skill's build-time trick of writing river-hide into `data/overrides.json` would be silently dropped.
  Hence the base-overrides layer, merged into the temp overrides file the portal writes.
- **The internal "Map vX.X" stamp is the DATA version** (from `routes.json`), not the portal edit-version
  — identical behaviour to area maps (a v1.1 recolour still stamps the data version). Not a bug.

## [0.5.0-P5] — 2026-07-24

Phase **P5** — **monthly change acceptance.** *The recurring product.* The central pipeline (run
expertly, elsewhere) restages a map's data each month and offers it as a **proposed update**. The
customer reviews a plain-language **change summary** and an **old-vs-new preview**, then **Accepts**
(their colours + landmark choices are **re-applied** onto the fresh data as a new **major** version — a
draft that still goes through the P4 publish gate) or **Declines** (the map keeps its current data). Only
the review + accept live in the portal; the data fetch/judgement stays central.

### Added
- **`proposed_update` table** (`schema.sql`) — a staged monthly refresh awaiting accept/decline
  (`data_dir` = git-ignored staged payload, `summary_json` = the data diff, status
  `pending`→`accepted`/`declined`/`superseded`, `accepted_version_id` = the version accept created). It is
  a *new* table, so `CREATE IF NOT EXISTS` covers a pre-P5 DB — no ALTER needed (migration idempotency
  unit-tested by dropping + reopening).
- **The data diff** (`src/refresh/index.js`) — `diffRouteData()` is **pure** (over parsed objects) and
  reports the *service facts* that changed: routes **added/withdrawn** (palette), a route's destination
  **reworded** (`internalDesc`/`serviceDesc`), **stops added/removed per route** (`routes_atco.json`,
  counts), **operators** added/removed, and **timetable validity** moved on (`validFrom`/`version`).
  Geometry is deliberately not diffed — it is not a fact the customer signs off, and it changes every
  refresh. `dataChangeSummary()` is the file-reading wrapper.
- **`scripts/propose-update.mjs`** — the **central-pipeline entry point** (mirrors `import-map.mjs`):
  `--map <slug|id> --src <fresh render dir> [--note]`. Validates the portal generators, **supersedes** any
  still-pending refresh for that map, stages the payload under `maps/<id>/proposed/<pid>/data`, computes
  the diff, and stores it. It never touches the live map and never renders (the diff is JSON-only).
- **Server routes** (`src/server.js`, tenant-scoped by `loadOwnedMap`): `POST …/proposed/:pid/preview`
  (renders **both** the live data and the staged data with the customer's overrides re-applied — orphaned
  ones dropped — for a true side-by-side), `POST …/proposed/:pid/accept`, and `POST …/proposed/:pid/decline`.
  `mapDetail` surfaces the pending update + `refreshHistory`; the maps list carries `pendingUpdate`;
  admins get a read-only `GET /api/admin/proposed-updates` queue + summary count.
- **Accept, done safely** (`renderVersion` gained an optional `srcDataDir`; `swapInProposedData()` in
  `engine.js`): accept **renders the new `vN.0` from the staged data first**, and only if that succeeds
  swaps the staged data into the live slot (archiving the outgoing data under `maps/<id>/archive/`, never
  deleting) and records the new **draft** head. A render failure leaves the live map completely untouched.
  The **published pointer does not move** — the refreshed version is a draft that must be signed off (P4)
  before it goes public, so the public map keeps serving the old, already-approved files until then.
- **Overrides re-applied, orphans dropped**: accept re-sanitises the customer's saved overrides against
  the **new** data's palette + POI keys (`sanitizeOverrides`), so a recolour/POI-hide survives the refresh
  **if that route/landmark still exists**, and is silently dropped (and reported) if the refresh removed
  it.
- **Editor UI** (`editor.html`/`editor.js` + `app.css`): a prominent **"A monthly update is ready"**
  banner with the change summary and **Preview changes** / **Accept update** / **Decline**; a full-width
  **old-vs-new compare dialog** (current vs after, per output, live SVGs). Accept/decline flash a one-shot
  message across the reload. The dashboard shows an **"Update ready"** pill; the admin console gains a
  read-only **Refreshes** tab + badge, and the audit trail labels `refresh.accept` / `refresh.decline`.
- **Demo seed** now stages a demo refresh for **March** (a lightly-mutated copy of its own data — new
  validity, one reworded description, one dropped stop) so the accept/decline flow is demoable out of the
  box on a published map.

### Verified (end-to-end, isolated scratch server + demo seed, in-app browser)
- **Panel + preview**: the update panel shows the correct summary (1 description reworded, `33A` −1 stop,
  validity June→August 2026); the old-vs-new preview renders **both** internal + external live, and the
  "after" SVGs differ from "before" (the refresh is genuinely visible).
- **Accept**: March **v1.0 → v2.0** (major bump), head `draft`, **`published_version_id` stayed `v1.0`**,
  proposed update consumed, refresh history recorded, flash shown. On disk: **v1.0 stayed byte-identical**
  (255,878 / 910,694 / 16,088 / 563,548 B — P0 guarantee survives), v2.0 rendered from the **new** data,
  and the outgoing data landed in `archive/proposed-1-prev/` (validFrom June, vs live August).
- **Re-apply**: after recolouring route `33A` (v2.1), accepting a second refresh produced **v3.0** whose
  `overrides.json` **still carried `routeColors["33A"]`** — the customisation survived the data refresh.
- **Guards**: re-accepting a decided update → **409**; accepting **while a publish sign-off is pending**
  (St Ives) → **409** with a clear "withdraw first" message; **decline** is allowed regardless and left
  St Ives's data **unchanged** (validFrom still June, no `archive/` created).
- **Isolation**: the March editor got **403** on all three of St Ives's `…/proposed/…` endpoints.
- **Admin + audit**: the **Refreshes** tab + badge render the pending queue; the audit trail shows both
  accepts (with change summaries) and the decline, correctly attributed to each customer's editor.
- **Migration idempotency** and the **pure `diffRouteData`** unit tests both green; **zero console errors**.

### Lessons learned
- **Diff the facts, not the pixels.** Every refresh changes geometry (stop coordinates, road/river paths),
  so diffing the rendered output or the raw inputs wholesale would flag "everything changed" every month
  and train customers to rubber-stamp. Diffing only the *service facts* a customer actually signs off
  (routes, destinations, stop membership, operators, validity) makes the summary meaningful — and it stays
  **pure/deterministic**, so it is trustworthy evidence.
- **Render before you swap.** Accept renders `vN.0` from the *staged* data first and only swaps on success
  (`renderVersion(..., srcDataDir)` + `swapInProposedData`). Swapping first would, on a render failure,
  leave the live data ahead of the current version — a corrupt half-state. Rendering first makes accept
  effectively atomic.
- **A data refresh is a new draft, not a new publication.** Accepting must **not** move the public-current
  pointer: the refreshed version is unproven until a human signs it off. The two-pointer model from P4 (head
  vs published) is exactly what lets the public map keep serving the last approved files while the customer
  prepares the new one. Accept's version note carries the change summary so the P4 approver — whose
  overrides-diff would otherwise read "unchanged" — sees that the *data* moved.
- **Re-applying overrides is just re-sanitising against the new universe.** Because the safe subset is
  small and validated against the live palette/POI keys, "re-apply the customer's edits onto next month's
  data" is precisely `sanitizeOverrides(saved, { palette:new, poiKeys:new })` — survivors kept, orphans
  dropped and reported. No special migration logic; the P1 boundary does the work again.
- **Archive, never delete.** The outgoing data moves to `archive/` on accept. It costs a little disk but
  means an accepted refresh is reversible and auditable; declined staged data is likewise retained. (A
  cleanup/retention job is a future ops task, noted as a follow-up.)
- **Swapping a map's data must invalidate the memoised POI list.** `enumeratePois(id)` is cached by map id
  for the process lifetime (enumerating runs a generator). After a data swap the drawn-POI universe can
  change, so `swapInProposedData()` calls `invalidatePoiCache(id)` — otherwise the editor would offer the
  *old* map's landmark toggles against the new data. The importer dodged this by running in a separate
  process; in-process accept does not, so the cache must be dropped explicitly.
- **One writer.** Staging a refresh (`propose-update.mjs`) writes the shared SQLite, so the dev server must
  be stopped first — same single-writer rule as the importer/seed (verification stopped the scratch server
  to stage, then restarted).

## [0.4.0-P4] — 2026-07-23

Phase **P4** — **the publish gate.** A rendered map version is now a private **draft** until a platform
**approver** signs it off with recorded **red-team evidence**; publishing advances the map's
**public-current pointer** and writes an **append-only audit trail**. This closes the third and final
approval gate (organisation → map-request → **publish**). The editor who makes the change never
publishes it — separation of duties.

### Added
- **Version review states + the public-current pointer** (`schema.sql`, migrated): `map_version` gains
  `review_state` (`draft`→`pending`→`published`→`superseded`/`rejected`); `map` gains
  `published_version_id` — the one **official** version, distinct from `current_version_id` (the working
  head). A guarded migration adds both to a pre-P4 DB (unit-tested on a synthetic P3-shape DB).
- **Publish requests + red-team evidence** (`publish_request` table, `src/publish/index.js`): an editor
  **submits the current head** for sign-off. Two pieces of evidence back the decision — a **deterministic
  `changeSummary()`** (because the safe subset only permits route recolours + POI show/hide, the diff of
  the submitted version vs the currently-published one is *complete*: the approver sees exactly what
  changed and can be sure nothing else did) and a fixed **sign-off checklist** (`CHECKLIST`, five transit-
  safety confirmations). `validateChecklist()` enforces completeness **on the server** — a map cannot be
  published without every item confirmed. The evidence (checklist answers + change-summary snapshot +
  notes + who/when) is stored on the request.
- **Review console** (`/app/review`, `public/app/review.html` + `review.js`; approver/admin only — the
  page redirects others and `requireApprover` re-checks the role on every `/api/review/*` route): a queue
  of pending submissions; open one to see the change summary, **inspect the print-ready JPGs inline**,
  complete the checklist, and **Publish** (advances the pointer, retires the previous published version to
  `superseded`, sets the map `published`) or **Send back** (requires a reason; returns the version to
  `rejected` so the editor can revise + resubmit).
- **Editor publish panel** (`editor.html` + `editor.js`): shows the draft/published state, a live
  "what publishing will change" summary, **Submit for publication**, and **Withdraw**. Editing is
  **frozen while a request is pending** (server returns 409 on save; the controls disable) so the version
  an approver reviews is always the head. Published (official) files are surfaced distinctly from the
  working draft.
- **Append-only audit log** (`audit_log` table, `src/audit/index.js`): every governance action —
  `version.submit` / `publish` / `reject` / `withdraw` / `save`, plus the retrofitted P3 actions
  (`application.approve`/`reject`, `maprequest.approve`/`reject`, `customer.update`) — records who, what,
  when, and against which map/version. New admin **Audit** tab (`/api/admin/audit`, admin-only) renders it
  newest-first with friendly labels.
- **Roles activated**: the P2 `approver` role now has powers — a platform reviewer who can read/inspect
  and publish **any** map's submitted version but cannot edit it (`loadReadableMap` vs `loadOwnedMap`).
  A **Review** nav link appears for approvers + admins.
- **Demo seed** now also creates a platform **approver** (`approver@busmaps.example`),
  **publishes March v1.0** as a first official version, and renders a real **St Ives v1.1** (route 9
  recolour) **submitted for sign-off** — so the review queue, a published map and the audit trail are all
  non-empty on first run.

### Verified (end-to-end, fresh scratch server + demo seed, in-app browser)
- **Sign-off gate**: approving with an **incomplete checklist → 400** (server lists the missing items);
  the UI **Publish** button stays disabled until all 5 boxes are ticked (disabled at 4/5, enabled at 5/5).
  Rejecting with **no reason → 400**.
- **Publish + supersede**: approving St Ives **v1.1** set `published_version_id`, map `published`, and the
  official pointer; then editing → save **v1.2** → submit → approving **v1.2** left versions as
  **`v1.2:published, v1.1:superseded, v1.0:draft`** and advanced the pointer. Publishing never re-renders:
  the **v1.0 baseline stayed byte-identical** (471,569 / 1,172,380 / 33,768 / 987,563 B).
- **Editing lock**: while a request is pending the editor is locked (controls disabled, state
  "Locked for review") and a direct `POST /save` returns **409**; **Withdraw** returns it to draft and
  re-enables editing.
- **Separation of duties / isolation**: the **approver** got **403** on save/preview/publish-request
  (can't edit) and on `/api/admin/*` (not admin), but **200** on read-detail + version-file download (to
  inspect). The **editor** got **403** on another customer's map (isolation intact from P2).
- **Audit**: all nine actions recorded with correct actor attribution (editor submit/withdraw; approver +
  admin publishes) and rendered in the admin **Audit** tab. No console errors on any app page.
- **Pure-logic unit tests** (`changeSummary` + `validateChecklist`) and the **migration** test both green.

### Lessons learned
- **The change summary is only "complete" because the safe subset is small.** P4 leans on P1's boundary:
  since a customer can *only* recolour routes and hide/show POIs, a diff of two versions' overrides is an
  exhaustive account of what changed — there is no hidden geometry edit to miss. That is what lets a human
  sign off with confidence, and why the evidence can be generated deterministically rather than re-derived.
- **Two pointers, not one.** `current_version_id` (working head, moves on every save) and
  `published_version_id` (the official/public version, moves only on sign-off) must be separate. Reusing
  one would either publish drafts automatically or freeze editing after the first publish.
- **Freeze editing while pending, don't chase a moving head.** Allowing saves during review would let the
  head advance past the version under review (stale sign-off). Blocking `save` with a 409 while a request
  is open keeps "the head" and "the submitted version" identical, so the state machine stays a simple
  draft ↔ pending ↔ published loop. Withdraw is the escape hatch.
- **Separate read-scope from edit-scope.** Approvers must fetch *any* submitted map's rendered files to
  eyeball them, but must never edit — so `loadReadableMap` (admin/owner/**approver**) guards GET detail +
  downloads while `loadOwnedMap` (admin/owner) still guards preview/save/submit. One shared loader would
  have leaked edit access to reviewers.
- **`confirm()`/`requestSubmit()` are unavailable in the in-app browser** (seen again from P3): tests
  override `window.confirm = () => true` and click handlers directly; the checklist→enable wiring is
  driven by dispatching `change` events, as in prior phases.
- **Audit writes must never break the action.** `logAudit` swallows its own errors (logging a warning) so
  a bad audit insert can't fail a publish — the audit is a record of the action, not a precondition for it.

## [0.3.0-P3] — 2026-07-23

Phase **P3** — **onboarding + governance.** The public *apply* form from P0 now has the other half:
an admin reviews applications, approves one into a **customer + its first editor + a passwordless
invite**, and customers **request maps within a quota** that an admin approves or rejects. This closes
the first two of the three approval gates (organisation, map-request); the publish gate remains P4.

### Added
- **Admin console** (`/app/admin`, `public/app/admin.html` + `admin.js`) — admin-only (redirects
  non-admins; every `/api/admin/*` route re-checks the role). Four tabs with live count badges:
  - **Applications** — review the queue; **Approve** opens a dialog (editable area/place quota +
    editor name) that creates the `customer`, its first `editor` user, links the application to the
    customer, and issues a **passwordless invite** (printed to the server console; the link is also
    surfaced in the UI in dev so the whole loop is demoable without email). **Reject** marks it rejected.
  - **Map requests** — the pending-request queue; **Approve** accepts it (→ `approved`, queued for the
    central build) or **Reject** archives it (freeing the quota slot).
  - **Customers** — every customer with user count + live area/place usage, and **inline editing** of
    quotas, status, and the dormant `plan`.
  - **Messages** — read-only view of the P0 contact `message` table (previously write-only).
- **Customer map requests + quota** — the dashboard shows a **quota bar** (used / allowed per kind) and
  a **Request a map** dialog (area or place, name, subject, note). `POST /api/maps/request` enforces the
  quota **server-side** (a requested/approved/built map counts; archived does not) and creates the map in
  status `requested` with no object store yet. `GET /api/me` now returns quota usage.
- **Map lifecycle states surfaced** — non-editable maps (`requested` / `approved` / `building`) render
  as **status pills** on the dashboard instead of editor links, and opening one shows a friendly
  **"being prepared"** panel rather than empty controls. Editable maps (a rendered version exists) are
  unchanged.
- **Schema (additive + migrated)** — `application` gains `reviewed_at` + `customer_id` (the customer it
  became); `map` gains `request_note` + `requested_by`, and `data_dir` now defaults to `''` (a requested
  map has no store yet). A guarded migration adds all four columns to a pre-P3 DB, existing rows intact.
- **Demo seed** now also plants a **pending application** (Ramsey Town Council) and a **requested map**
  (St Ives Waitrose) so the approval and request queues are non-empty on first run. Idempotent.

### Verified (end-to-end, fresh server + demo seed, in-app browser)
- **Approve flow**: approving Ramsey with a custom **1 area / 2 place** quota created customer #3 + editor
  `clerk@ramsey-tc.example`, linked the application (`status=approved`, `customer_id=3`), surfaced the
  invite link, and dropped the pending count 1 → 0.
- **Map-request lifecycle**: the seeded St Ives Waitrose request approved → left the queue (`approved`).
- **Quota enforcement**: as the St Ives editor (area 1/1, place 1/4) an **area** request was **blocked**
  ("Your plan includes 1 area map and you already have 1"); a **place** request succeeded, incremented
  the bar to 2/4, and appeared as a *Requested* card.
- **Customers tab**: inline-editing St Ives's place quota 3 → 4 persisted.
- **Editor guard**: opening the approved-but-unbuilt map showed "Not built yet / being prepared", no
  controls.
- **Isolation intact (P2)**: the editor saw only its own maps; March (`/api/maps/2`) and every
  `/api/admin/*` route returned **403**. The admin saw all customers and both councils' maps.
- **Baselines still byte-identical**: St Ives + March re-imported and rendered v1.0 identical to the
  shipped figures (St Ives internal 471,569 B SVG / 1,172,380 B JPG). The built-map editor still loads
  (9 routes, 34 POIs, live preview, both output tabs).
- **Migration**: a synthetic pre-P3 DB gained all four columns on boot with its rows preserved; the P3
  DB helpers (quota, lifecycle, application review, customer admin, summary) unit-tested green.

### Lessons learned
- **Quota is server-enforced, and counts the right rows.** The check lives in `POST /api/maps/request`
  (never the client), and `quotaUsage` counts every non-`archived` map of a kind — so a *pending request*
  already consumes a slot (no request spam) and **rejecting frees it** (reject → `archived`). Draft,
  approved and building all count; only archived is free.
- **A requested map has no object store.** It's a DB row with `data_dir=''` and no version, so anything
  that reads the store (`readRoutesMeta`, `enumeratePois`, downloads) must no-op gracefully — they do
  (empty fallbacks), but the dashboard/editor gate on **"has a current version"** to decide editable vs
  "being prepared" rather than trusting status alone.
- **The invite is just a magic link.** Approval reuses `requestMagicLink` against the freshly-created
  active user — no separate invite token type. In dev the link is both logged and returned in the API
  response (gated on `EMAIL_PROVIDER` being unset); with a provider set it is only emailed.
- **`user.email` is UNIQUE**, so approval must refuse when the contact email already has an account
  (409) rather than let the insert throw — the one real edge in the approve path.
- **`<dialog>` needs no framework.** Both the request and approve modals are native `<dialog>` +
  `showModal()`; submitting programmatically in a test uses `dispatchEvent(new Event('submit'))`
  (`requestSubmit()` was not available in the in-app browser).
- **The place map request is lifecycle-only.** Approving St Ives Waitrose (a place) proves the request
  gate, but places still can't be *built* in the portal until the place engine is vendored (the standing
  P2 follow-up) — the two are independent.

## [0.2.0-P2] — 2026-07-23

Phase **P2** — **multi-customer, authenticated, isolated.** The editor spine from P1 becomes a real
two-sided service: organisations sign in passwordlessly, see only their own maps, and choose which
outputs each map produces. This is the demo cut (P0+P1+P2): an org logs in, opens its map, recolours a
route, re-renders, downloads — with every other org's data invisible and inaccessible.

### Added
- **Data model** (`schema.sql` + `src/db/index.js`): `customer` (type, status, dormant plan + quotas,
  branding), `user` (belongs to a customer; role editor/approver/admin; admins have no customer),
  `session` (opaque server-side token), `magic_link` (single-use, 15-min). `map` gains `customer_id`
  (owner) and `outputs` (which of the four outputs it produces). A guarded **migration** adds the two
  `map` columns to a pre-P2 DB without touching existing rows (verified on a synthetic P1 DB).
- **Passwordless magic-link auth** (`src/auth/index.js`, no new deps): request a link → it's printed to
  the **server console** in dev (a real email provider is a launch task) → `/auth/verify` consumes it and
  sets an **httpOnly, SameSite=Lax session cookie** holding only an opaque random token. Login/logout,
  `GET /api/me`, and a periodic expired-session purge.
- **Tenant isolation** — every `/api/maps*` route requires a session and is scoped by `customer_id`:
  non-admins can only list/open/preview/save/download/toggle **their own** maps; admins see all. Enforced
  server-side on every access vector (detail, preview, save, download, output PATCH).
- **Output toggles** (`src/maps/store.js` `OUTPUTS`, `PATCH /api/maps/:id/outputs`): a map's four outputs
  are modelled (geographic, external, octolinear schematic, tube-map diagram); the portal renders the two
  the vendored engine supports today and marks schematic/diagram "coming with expert styles". Preview,
  render and downloads all follow the enabled set; a map must keep ≥1 output on.
- **UI**: a login page; the dashboard + editor are auth-gated (redirect to login, user + sign-out in the
  header, admins get an "all maps" view labelled by customer); the editor gains an **Outputs** panel and
  builds its preview tabs dynamically from the enabled outputs.
- **Demo seed** (`scripts/seed-demo.mjs` + `import-map.mjs --customer`): sets up an admin, two demo
  councils each with an editor user, and imports their maps — a reproducible multi-tenant demo. Idempotent.

### Verified (end-to-end, fresh server + demo seed)
- **Isolation**: signed in as the St Ives editor, `/api/maps` returns only St Ives; March's detail,
  **preview and download all return 403**. Admin (Peter) sees both councils' maps and can open March.
- **Auth**: anon `/api/maps` → 401; magic-link request → console link → verify → session cookie → app;
  wrong/expired token → back to login with an error.
- **Output toggles**: turning external off persists and re-scopes preview/downloads; turning everything
  off is rejected (400); schematic/diagram show as unavailable.
- **Baselines still byte-identical**: St Ives and March both import + render v1.0 through the object store
  (St Ives all four artefacts identical to the shipped v6.6).
- **Migration**: a synthetic pre-P2 `map` table gains `customer_id`/`outputs` on boot, existing row intact.

### Lessons learned
- **Place maps don't fit the object-store model yet.** Area maps carry their generators per-map
  (`gen_internal.js`/`gen_external.js`), which the portal vendors — that's why St Ives/March "just work".
  **Place maps** (`make-place-bus-leaflet`) keep their *different* engine in the skill, not per-map, so a
  place render dir carries **no generators**; importing one produced an unrenderable map. The importer now
  **fails fast** when no portal generator is present, and the demo is area-maps-only until the place engine
  is vendored (its own follow-up, analogous to P1 for places).
- **SQLite datetime format matters for session expiry.** `datetime('now')` is `YYYY-MM-DD HH:MM:SS`;
  storing an ISO string (`…T…Z`) breaks the `expires_at > datetime('now')` string comparison (the `T`
  sorts after a space). Store expiries via `toISOString().slice(0,19).replace('T',' ')`.
- **`node:sqlite` enforces foreign keys** (seen again): deleting `map` while `map.current_version_id`
  points at a `map_version` fails; the demo re-seed wipes the DB file instead of DELETEing in-place.
- **No new deps for auth.** Cookies are hand-rolled and the session token is an opaque server-side key, so
  there's nothing to sign — `node:crypto` + a `session` table is enough. SameSite=Lax covers cross-site
  POST; a dedicated CSRF token is a later hardening item.
- **One SQLite writer.** The seed/import scripts and the dev server share `portal.sqlite`; run seeds with
  the server stopped (P2 has no job queue yet — that's P5's territory).

## [0.1.0-P1] — 2026-07-23

Phase **P1** — the **editor spine**. The bus-leaflet editor is re-homed behind the app as a
**server-enforced safe-subset editor**: an approved organisation opens a map, recolours a route or
shows/hides a landmark, previews the real render live, then **saves a numbered version** and
**downloads print-ready files** — end to end, no localhost tool, no AI.

### Added
- **Object store** (`src/maps/store.js`) — per-map folders under `DATA_DIR` (git-ignored):
  `maps/<id>/data/` (the map's generators + JSON inputs), `overrides.json` (canonical saved edits),
  `renders/v<maj>.<min>/` (four artefacts + `meta.json`). No `localhost:5179`, nothing in git.
- **Safe-subset gate** (`src/maps/safeSubset.js`) — the security boundary. Rebuilds overrides from
  scratch, keeping **only** `routeColors[route]` (recolour) and `internal.pois[key].hide` (toggle),
  validated against the map's palette + known POI keys; **everything expert-only (stops, align,
  rotation, viewport, panel, features, external layout, POI moves/labels) is dropped** no matter what
  the client sends. No-ops (a colour equal to the default, a visible POI) drop too, so an untouched
  map serialises to `{}` and stays byte-identical to baseline.
- **Engine wrapper** (`src/maps/engine.js`) — enumerate the editable routes + POIs (POIs read from a
  one-off `EDITOR_KEYS=1` render, so the toggle keys match exactly what the generator draws),
  `preview()` (SVGs only, nothing persisted), and `renderVersion()` (writes the version's SVG + print
  JPG, then commits the canonical `overrides.json`).
- **Map + version schema** (`map`, `map_version` in `schema.sql`; helpers in `src/db/index.js`) —
  versions are append-only (nothing deleted); shaped so P2's `customer_id` / auth / output-toggles
  grow in without a rewrite.
- **Editor API + UI** — `GET /api/maps`, `GET /api/maps/:id`, `POST …/preview`, `POST …/save`,
  `GET …/versions/:key/:file` (whitelisted `v<maj>.<min>` + known filenames; `?download` sets
  `Content-Disposition`). Served at `/app` (dashboard) and `/app/maps/:id` (the two-pane editor:
  colour pickers + grouped POI toggles on the left; live internal/external preview, save-note and
  print-ready downloads on the right; light/dark, responsive).
- **Importer** (`scripts/import-map.mjs`) — seeds one map from a staged Buses run dir and renders the
  baseline as **v1.0 with empty overrides** (i.e. byte-identical to the shipped leaflet). The minimal
  P1 seed; P2 generalises it to the multi-customer importer.
- `renderMap.generateSvg` gained an opt-in `editorKeys` flag (off by default → the P0 byte-identical
  baseline is untouched).

### Verified
- **Full round-trip on a fresh server**: recolour route 9 + hide Waitrose → live preview through the
  *real* generator (Waitrose gone from the SVG, route 9 redrawn) → **Save → v1.1** rendered (SVG +
  300 dpi JPG × internal/external) → downloads with correct headers. `overrides.json` held exactly the
  sanitised safe subset and nothing else.
- **Baseline stays byte-identical.** v1.0 rendered through the object-store path is **SHA-256-identical**
  to the shipped St Ives v6.6 (all four artefacts), while v1.1 correctly diverges — the P0 guarantee
  survives P1.
- **Safe-subset gate** unit-tested with a hostile payload (stops/align/rotation/panel/external/unknown
  routes/invalid hex/unknown POIs) → all stripped, only the two valid edits survived.
- Path-traversal / bad-version / unknown-file download requests → `400`.

### Lessons learned (read these before extending the build)
- **The object store is *inside* a `type: module` repo, so the CommonJS generators break there.**
  P0's byte-identical test escaped this by copying fixtures to the system temp dir. In the real object
  store, Node walks up to the repo's `package.json` (`type: module`) and runs `gen_*.js` as ESM →
  *"require is not defined in ES module scope"*. Fix: `ensureMapDirs` drops a
  `{ "type": "commonjs" }` marker into each map's `data/` folder (same CommonJS-island trick as
  `engine/`). Any new object-store location that holds a generator needs this marker.
- **Enumerate POI keys from the generator, never reconstruct them.** The override key is the generator's
  *icon* category, not the raw `pois.json` `cat` (e.g. `shop:Waitrose`, **not** `Supermarket:Waitrose`).
  Rendering once with `EDITOR_KEYS=1` and reading the `data-key` tags guarantees the toggle keys match
  what the render actually looks up — reconstructing from `pois.json` would silently mismatch.
- **`node:sqlite` enforces foreign keys.** Wiping `map` + `map_version` fails with
  *FOREIGN KEY constraint failed* unless you `UPDATE map SET current_version_id = NULL` first (the map
  points at its current version). A silent `2>/dev/null` hid this and left the DB and object store
  inconsistent — order matters, and a real "delete map" needs a cascade.
- **One SQLite file, one writer.** The importer and the dev server both open `portal.sqlite`; running a
  CLI write while `npm run dev --watch` is up gives lock contention. For P1, run imports with the
  server stopped (P2's in-process job queue removes this). Also: `node --watch` hot-reloads on every
  save, which is why an already-running server can report new code — restart fresh before trusting a
  test.
- **Safe subset = server-enforced, not UI-hidden.** Hiding the drag controls is not enough; the gate
  runs on every preview and save so a hostile/buggy client can't smuggle a layout edit through.
- **Not yet in the safe subset (deferred within P1's remit):** *relabelling* routes/badges and editing
  the *Services-panel text* need a new **no-op-when-absent** override knob added to the generators (and
  re-gated on all towns) — real engine work, not wiring, so held back. Choosing **which outputs** a map
  produces is explicitly **P2** (typed maps + output toggles); P1 renders internal + external.

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
