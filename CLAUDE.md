# BusMaps.uk — portal

<!-- docstamp v1.27 | 2026-09-03 | sha=752898e0 -->
**v1.27** · updated 3 September 2026

A self-serve portal that lets approved organisations generate and maintain printable bus maps.
Private repo, Business Source License 1.1 (converts to Apache-2.0 on 2030-08-09; free for
non-commercial/internal use, competing commercial use needs a separate licence — see `LICENSE`).
Node + Fastify + `node:sqlite`, no template engine, no framework.

## Read this first: the system is a PILOT

It is feature-complete (P0–P7, plus P8a) and it works end to end — which makes it read like a live service.
**It is not one.** There are **no customers**: every organisation in the database is seeded demo data
(`scripts/seed-demo.mjs`) and every map on the public site is one we made ourselves.

While `PILOT_MODE` is on (the default — it is on unless explicitly `0`):

- every page carries a banner and an `[Pilot]` title prefix, from one generated `/js/site-banner.js`
- every rendered sheet carries a red **PILOT — SAMPLE MAP** band
- `robots.txt` says `Disallow: /`
- seeded demo organisations render a **Sample** badge (`customer.is_demo`)

**[`docs/PILOT.md`](docs/PILOT.md) is the authority** — what it claims, why "pilot" and not
"experimental", and the one-switch removal checklist. `grep -rn "PILOT:"` finds every gated block.

Two rules that follow from this:

1. **Do not write copy that claims customers, uptime, response times, or a guaranteed refresh
   cadence.** Wording that did was removed once; don't reintroduce it. If you add a public page, give
   it the `<script src="/js/site-banner.js" defer>` tag.
2. **Sample labelling and the truthful-copy rewrites are NOT pilot-gated.** They must survive
   `PILOT_MODE=0`. Demo data stays demo data.

## Before changing code

Read [`docs/DEVELOPING.md`](docs/DEVELOPING.md). The two things that must not break:

- **Determinism.** Same inputs ⇒ byte-identical output, no network, no AI at render time. Absent
  config ⇒ previous behaviour.
- **The three approval gates.** Organisation approval, map request + quota, publish review. Don't
  add a path around them. Note `publish ≠ public`.

Two structural facts that catch people out:

- **Generators are vendored per map** into `data/maps/<id>/data/`. Editing `engine/` changes nothing
  for existing maps. The pilot band works around this by transforming the finished SVG in
  `src/render/renderMap.js` *after* generation — copy that pattern.
- **`npm run verify` no longer skips** (2026-08-20, technical-audit_2026-08-19 V2). It finds a
  committed fixture in `buses-data` — `Areas/_portal-fixture/` and `Places/_portal-fixture/` — via
  `BUSES_DIR` or a sibling checkout, and it FAILS rather than exiting 0 when there is none.
  `FIXTURE_DIR` / `PLACE_FIXTURE_DIR` still win when set, and still point at the live render tree on
  Peter's laptop, which is where a real regression shows first. `--allow-skip` exists for a clone of
  the portal alone and announces that it proved nothing. Still read the output: PASS with byte counts
  is the evidence, an exit code is not.

## If you are here to improve the update/publish flow

There is an existing review — do not start from scratch, and do not re-derive its findings.
**`Buses/Development Docs/portal-update-flow-findings_2026-08-11.md`** (the private `buses-data`
repo, `C:\u3a St Ives\Using AI\Buses\` on Peter's machine) documents the whole
proposed-update → accept → submit → approve → public chain as it actually behaves, with every
screen quoted verbatim, a ranked backlog, and a **section J written specifically for a cold start**:
which files each item touches, how to run an isolated seeded instance instead of experimenting on
live, and the traps that cost the review itself time. Its companion
`portal-update-flow-walkthrough_2026-08-11.md` is the same flow written for a customer.

**The whole backlog is done (items 1–13, last one merged 12 August 2026) — the document describes the
flow as it was on 11 August.** Read its *Suggested order of work* first for the per-item status; the
body above it still describes the pre-fix behaviour on purpose. Shipped: the three editor defects
(`.r-title` overrun, unstyled disabled buttons, "review it and review it"); **A1** — a version's data
diff now lives on the version (`map_version.data_change_json`) and `changeSummary().unchanged` means
*overrides and data* are both empty, so a refreshed map no longer reports as identical to the
published one; the **status strip** on the map page, a read-out of `mapDetail` that says whose turn
it is; the **vocabulary pass** (one word per thing — see the glossary in `docs/DEVELOPING.md`, and
don't reintroduce "submit for publication" or "Edition"), the **three transactional emails**
(`src/email/notify.js`, proven against real Resend delivery 2026-08-12 — see
`docs/_archive/PORTAL-DEV-PLAN-2026-08-12.md` item 2), the **version list**, the **compare-dialog change
bullets**, the **download-row labelling**, the **unit of publication**, the **`draft-unsubmitted`
worklist item**; and **H9** — a purely presentational "editor's-eye view" toggle for admins
(`public/js/editor-eye-view.js`), plus the independent status-strip wording fix it exposed ("their
move · you can act as admin"), both shipped 2026-08-12.

`docs/_archive/PORTAL-DEV-PLAN-2026-08-12.md` is the record of the session that closed this backlog out and
also rebuilt P8a against current `main` — read it for the mechanics of resolving a stale branch's
conflicts (isolate the branch's own diff rather than merge its history) if that ever needs doing
again for P8b/P8c.

**None of that backlog should change a rendered sheet.** If a change there makes `npm run verify`
fail, the change is wrong.

## Conventions

Flag names, exit codes, streams, the `--apply` / `--yes` vocabulary, naming and the Node pin: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md). One page, and it is the one to read before adding a script.

## Gates to run

```bash
npm test          # the whole suite - scripts/run-tests.mjs discovers every test-*/prove-red-* file
npm run verify    # byte-identical reproduce + escape-hatch defaults, area + place (needs the fixture dirs)
```

`npm run verify` is `verify:area && verify:place && verify:defaults`. The last of those proves every
`design:{key:false}` / `labels:{engine:"v1"}` escape hatch actually changes rendered output on at
least one sheet — i.e. none of them are dead code. One key, `hubFit`, is excluded from the PLACE-side
check with a cited reason; see the resolved note below before touching that exclusion.

If `verify` reports the SVG DIFFERS by a few hundred bytes, suspect a lost `stamp: false` in the
verify scripts before you suspect the generator. Never relax a gate to make it pass.

## House rules

- **No secrets, customer data or map data in git** — the portal is a public-facing service. `data/` is ignored.
  So is `backups/`, and that one has bitten: **`npm run backup` writes to `<DATA_DIR>/../backups/`,
  which is *inside* the repo**, so a plain `git add -A` after a backup stages ~125 files of map
  payloads. `*.sqlite` was already ignored so the database never went in, but the JSON/SVG/JPG did.
  Both are ignored now — the habit that matters is **look at what `git add -A` actually staged
  before committing in a repo with a public remote.**
  Private operator records live in a separate local-only folder, never synced.
- **An edit to a server-rendered shell needs the server restarted, including under `npm run dev`.** `shell()` in `src/routes/public.js` (it was in `src/server.js` until OA-232 Tier 3.2) reads `public/map.html`, `public/services.html` and their siblings **once** into `shellCache` and never invalidates it, and `node --watch` only restarts on files it has *imported* — so an HTML edit is invisible to `/m/<slug>` until the process is stopped and started. Found on 2026-08-27 by screenshotting a page whose new element was in the file and not in the response. CSS and the client JS reload normally; only the SSR shells are cached.
- Server-enforced always; client-side checks are UX, not security.
- Attribution (OpenStreetMap ODbL, BODS OGL) is not optional — see `NOTICE`.
- Record what changed and why as a **fragment** in `CHANGELOG.d/` — `YYYY-MM-DD-slug.md`, with `date:` and `title:` front matter — then run `npm run changelog` from the repository root to rebuild the index. **Do not write into `CHANGELOG.md` itself; it is generated and your entry will be overwritten.** One file per entry is what stops two sessions conflicting over the same file on the same day. `npm test` fails if the index is out of date. See [`CHANGELOG.d/README.md`](CHANGELOG.d/README.md).

## Review checklist & admin to-do — 2026-08-15 session

The publish checklist went from 6 items to 3 (`CHECKLIST_VERSION` 4→5, `src/publish/index.js`):
`appearance` merges the old services/colours/pois items, `legible` and `alternative` are unchanged
in substance, and the old `accurate` item ("this is a visual check, not independent verification")
is no longer a tickbox — it never described something the approver *does*, so it's now static text
next to the checklist. Runbook `docs/R3-review-and-publish.md` was rewritten to match. Same session
also: labelled the JPG/services-list links as opening in a new tab; moved the services-list link next
to the download pills instead of an orphaned "checklist item 6 asks you to open it" cross-reference;
made admin to-do cards (`public/app/admin.js`) whole-card-clickable like the review queue, but only
for cards whose one action is a single portal link — cards with a shell command keep their Copy
button reachable; and reworded `opportunity.html`'s overstated "you do need to be able to read it"
claim about the codebase.

**Gotcha that cost a fix-then-redeploy cycle:** the string "checklist item 6" existed in *two* places
— the dynamic note in `public/app/review.js` (caught first pass) and a hardcoded heading in
`public/app/review-services.html` (missed first pass, only found by testing the live page
end-to-end). **If checklist numbering or count ever changes again, `grep -rn "checklist item" public/
docs/` before considering it done** — don't rely on having found review.js and assume that's the only
place.

Deployed to the live VPS in two steps: `b6760bb` (the consolidation), then hotfix `0b91d05` for the
above gotcha. Both confirmed via `curl https://busmaps.uk/health?deep=1` showing the matching
`gitSha`. **Testing the live review queue needs a real pending submission** — signing in alone isn't
enough to exercise the checklist/Publish-button wiring. On 2026-08-15 there was a real one waiting
(`Beaconsfield Simpson Centre` v2.0, submitted 2026-08-13) — it was opened and the checklist/Publish
gating verified via JS (ticking boxes, checking `approveBtn.disabled`), but **never actually
published** — completing a live publish/reject decision is Peter's call, not something to do as a
side effect of UI testing.

**Signing in to a LOCAL dev instance, so an app page can actually be driven in a browser (2026-09-01).** A session is a row in the dev database, so one can be made directly and no email is involved. Insert into `session` (`token`, `user_id`, `created_at`, `expires_at`) where **`token` holds the SHA-256 hex of the raw value, not the raw value** — `src/auth/index.js` has stored the hash rather than the token since 2026-08-25 — then set `document.cookie = 'cbm_session=<raw>; path=/'` in the browser and navigate. Two things this bought that reading the source did not. **Sign in as the persona the page is written for**: `/app/maps/:id/landmarks` hides its *Copy for our records* button from non-admins, so an admin session shows a screen no editor ever sees. And the **browser pane is a hidden tab**, so `document.hidden` is true and `requestAnimationFrame` never fires — an animation started there silently never runs and reads as a broken feature until you check, which cost one wrong diagnosis before it was measured. OA-215 recorded local sign-in as refused and built its verification out of wiring checks instead; it is not refused.

**Browser-pane testing notes for this app specifically:**
- The dev-server magic-link DB read (`reference_portal_signin_without_console` memory) needs a
  different path on the live VPS than locally: `docker compose exec -T portal node -e "...
  DatabaseSync('/data/portal.sqlite', ...)..."` (container-internal path), not
  `./data/portal.sqlite` (that's the laptop's dev path).
- On the live site, `computer` clicks on the sign-in form and on `.queue-item` buttons sometimes
  silently no-op (no request fires, no error) — most likely stale `ref`s after a page reload/redirect.
  When a click that should cause a network request produces nothing in
  `read_network_requests`, don't retry the same click — switch to `javascript_tool` and either
  `fetch()` the endpoint directly or `document.querySelector(...).click()` on the real element; both
  proved reliable when the `computer` tool's ref-based click didn't fire.

## The monthly BODS scan now names places — 2026-08-17

`scripts/check-upcoming-refreshes.mjs` cross-references the Buses side's `upcoming-report_*.md`
against portal maps. That report used to contain **towns only**, and a place map was matched to its
town's section by substring on `map.subject`. Both halves changed:

- The report now carries `## <Place> — <verdict>` sections with a `_kind place · region … · town … ·
  radius … km_` meta line. `parseSections` reads that into `{name, kind, parent, region, radiusKm}`
  and still fills `section.town` for anything that only knew about towns.
- **Join exactly, per kind** (`mapsForSection`). `mapsForSectionLegacy` exists only for reports
  written before this change, selected by `reportHasPlaces(sections)` — do not reintroduce the
  substring rule for current reports. Why it mattered is not duplicate messages (those dedup per map
  per report date) but that the matched section seeds the map's **public** banner via
  `setMapBannerNoteAuto`: the Aldi map would have advertised a new service that does not serve it.

Two traps if you touch this: the verdict is parsed field-by-field because a `2 to verify` section
(0 actionable) silently vanished under the old all-or-nothing regex; and the report is written on
Windows, so every parser here must tolerate CRLF — that has bitten this file before. `npm run
test:upcoming-join` covers all of it, and its legacy assertions are meant to prove the old behaviour
was wrong, so don't "tidy" them away.

## RESOLVED — `npm run verify:defaults` — landed 2026-08-18, built 2026-08-17

Landed: `scripts/verify-reproduce-defaults.mjs`, `scripts/verify-reproduce-place-defaults.mjs`,
`package.json`'s `verify`/`verify:defaults` scripts, `.env`'s `FIXTURE_DIR` (repointed to a fresh
render), and the refreshed `Buses/Places/_portal-fixture/High Wycombe Aldi/routes.json`. `npm run
verify` now runs clean end to end (exit 0, all four PASS) — see the resolved `hubFit` item below
before touching the PLACE-side `KEYS` exclusion it depends on.

**Why this exists.** Flagged by another session: `npm run verify` (area + place) can only ever prove
determinism against whatever config a fixture happens to carry, and every fixture's `routes.json` now
carries `design:{}`/`labels:{}` — G5 (`label-and-design-quality-plan.md`, Phase 8 item 5, 2026-08-17)
emptied it on every real committed town/place. **This gate is CLAUDE.md's own second invariant, "absent
config ⇒ previous behaviour," and nothing in `npm run verify` had ever tested it.**

**Two wrong designs before this one, both proven wrong by actually breaking something and watching the
gate NOT go red** — see the header comment in `verify-reproduce-defaults.mjs` for the full account:
1. "Strip design/labels, rebuild, assert byte-identical to as-is" — vacuous once every fixture's config
   is already `{}`, because `RJ.design || {}` makes "empty object" and "missing key" the same input.
   Confirmed: broke the `iconSet` default's fallback value, both builds went through the same broken
   fallback, gate reported PASS.
2. "Force ALL twelve keys to `false` at once, assert differs from as-is" — non-vacuous but too coarse.
   Confirmed: deleted `iconSet`'s `=== false` check entirely (hardcoded the constant), the other eleven
   keys still moved enough ink that the two builds differed anyway, gate reported PASS.

**Landed on:** build once with the fixture as-is, then once per key with ONLY that key forced to its
`false` (or `labels.engine:"v1"`) value, and assert EACH variant differs from as-is on at least one
sheet. Confirmed working by the same method as everything else in this project — **the mutation was
in the wrong file the first time**: the AREA fixture (`FIXTURE_DIR`) runs the `gen_internal.js` COPY
bundled inside the fixture's own S5-render folder (gitignored, see the duplication map in the Buses
repo's `Documentation\README - How to enhance the system.md`), not `engine/place/gen_internal.js` —
mutating the wrong one made the area-side gate un-testable by construction, not passing for a good
reason. Once mutated in the right file, deleting `iconSet`'s escape hatch correctly turned red
**exactly one row, `iconSet`, on both the area-side and place-side gates**, with the other twelve
staying green — proof the per-key isolation works, not just that something changed somewhere.

**RESOLVED 2026-08-18: the place-side `hubFit` false positive, confirmed and excluded.**
`verify-reproduce-place-defaults.mjs` reported `hubFit` as "IDENTICAL on every sheet" against the
`High Wycombe Aldi` fixture with no deliberate mutation, on the current, un-broken engine. Confirmed
two ways before excluding it: (1) an isolated re-run (`git diff engine/place/gen_internal.js` empty,
gate run alone) reproduced the same result — `hubFit` the only FAIL among 12 keys, all others DIFFER;
(2) reading `HUB_W` in `gen_external_places.js` directly shows the `hubFit`-on and legacy-off formulas
are both `Math.max(26, ...)`, and "Aldi" (4 characters) is short enough that the 26mm floor wins under
both — so the two codepaths are provably byte-identical for this one place, regardless of what
`hubFit` does. Independent corroboration: the AREA-side gate (`St Ives`, longer names) shows `hubFit`
genuinely DIFFERS on `external.svg` — the key is live code, just untestable by this one PLACE fixture.
`hubFit` is now excluded from `verify-reproduce-place-defaults.mjs`'s `KEYS` list with a comment citing
this paragraph. A fixture with a longer place name would cover it; none exists yet.

`npm run verify` now passes clean end to end (exit 0, all four PASS: `verify:area`, `verify:place`,
and both halves of `verify:defaults`). `verify:defaults` is in the "Gates to run" section above. The
wrong-file trap this took two attempts to notice (mutating `engine/place/gen_internal.js` instead of
the AREA fixture's own bundled copy) is now also recorded as a fourth trap in the Buses repo's
`Documentation\README - How to enhance the system.md`, "The duplication map" section.

## RESOLVED — `FIXTURE_DIR` is a list, and the gate that reads it wrong told nobody — 2026-08-18

**One fixture can't test thirteen keys, once a fix elsewhere changes what any single town needs.**
The Buses-side legend measurement fix (written up in `open-actions.md` at the time; that file was cut
back to a pure open-items list on 2026-08-20, so the account is now in its git history at `546cd62`)
narrowed every external legend panel by ~5mm, which let it *fit* where Beaconsfield and St Ives
already configure it — so `design.legendPlace:false` stopped changing anything on those two towns
specifically. Not dead code: measured across all eight towns, `legendPlace` bites on Huntingdon
alone, `badgeFit` on five towns but not Huntingdon, `hubFit` on seven but not March. **No single
fixture covers all thirteen keys**, and the alternative — another cited `KEYS` exclusion like the
PLACE-side `hubFit` above — is a cost every time: an excluded key is a key nothing tests, and
`legendPlace` is the worst possible candidate for that (it's the key whose absence let
`design.spokeSpread` bury 62 pieces of artwork across six towns while every defect metric went down).

**Landed:** `FIXTURE_DIR` is now `;`-separated (`.env.example` documents the format and gives a
worked three-town example). `verify-reproduce-defaults.mjs`/`-place-defaults.mjs` build against
every fixture in the list and a key passes if it moves ink on **any** of them — "this escape hatch
is live code" is a property of the engine, not of one town. Chosen combination for the area side:
St Ives, Huntingdon, Beaconsfield — between them they cover all thirteen keys.

**Splitting the env var broke the OTHER gate that reads it, silently, and that's the part worth
remembering.** `verify-reproduce.mjs` (the plain byte-identical check) ran `existsSync()` on the
whole `;`-joined string — never a real path — so it started printing "FIXTURE_DIR not set or
missing — skipping" and exiting **0**, with the renderer determinism check simply not running,
while `npm run verify` stayed green the entire time. This is the exact "a green run in a clean
checkout proves nothing about the renderer" trap this file's own header already names — a second,
independent instance of it inside one session. **It was caught by counting `RESULT:` lines in the
verify output (three where there should have been four), not by the exit code, which was 0
throughout.** Any script reading `FIXTURE_DIR` now needs to split the list itself
(`(process.env.FIXTURE_DIR||'').split(';').map(f=>f.trim()).filter(Boolean)`) rather than treating
it as a single path — check for this if a new consumer of the variable is ever added.

Confirmed working the same way as everything else in this file: `npm run verify` now prints four
real `RESULT:` lines with real byte counts, not a skip message, and `npm test` passes.

## Design review (Impeccable)

`PRODUCT.md` and `DESIGN.md` at repo root are the Claude Code `/impeccable` skill's product/design
authority for this repo — read them before any UI work rather than re-deriving audience or visual
rules from the code. `.impeccable/critique/` holds dated critique snapshots (`/impeccable critique
<target>`). The first (2026-08-14) critique's P0s and P1s were fixed 2026-08-15; a second critique run
right after found a live regression those very fixes had exposed — the hero/maps search input
rendering 28px wide, unusable — which was found, fixed and deployed within that same session (see
`CHANGELOG.md`). That second critique (`2026-08-15T05-10-40Z__public-index-html.md`) also found two
WCAG contrast fails (`.badge.place`, `.badge.extra` — amber-on-tint text, ~2.3:1) and a soft
cognitive-load call on the "Who it's for" 5-card grid — **both fixed and deployed 2026-08-15** (see
[`docs/_archive/CHANGELOG-to-2026-08-19.md`](docs/_archive/CHANGELOG-to-2026-08-19.md)'s "impeccable round-2 findings" entry): a new `--accent-tint-ink` token replaced
`var(--accent)` as text-on-tint wherever that pattern occurred (including `.pill.amber`, which shared
the bug but wasn't named in the critique), and the grid dropped to 4 cards. Remaining open items from
that snapshot are P2/P3 only (uncontrolled emoji icon system, succession-risk section not bridging
back) — lower priority, not yet scheduled.

**Whenever `/impeccable critique` (or any command spawning its Assessment A/B sub-agents) runs here,
pass `model: "opus"` on both sub-agent calls** — Peter's standing instruction, not specific to this
repo.
