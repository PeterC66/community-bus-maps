# BusMaps.uk — portal

<!-- docstamp v1.18 | 2026-08-18 | sha=6d2cc3a7 -->
**v1.18** · updated 18 August 2026

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
- **`npm run verify` skips silently** when `FIXTURE_DIR` / `PLACE_FIXTURE_DIR` are unset, so a green
  run in a clean checkout proves nothing about the renderer. Confirm it says PASS with byte counts.

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

## Gates to run

```bash
npm test          # P6 public front, P7 expert styles, request→publish→revert lifecycle
npm run verify    # byte-identical reproduce, area + place (needs the fixture dirs)
```

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
- Server-enforced always; client-side checks are UX, not security.
- Attribution (OpenStreetMap ODbL, BODS OGL) is not optional — see `NOTICE`.
- Update `CHANGELOG.md` with what changed and why.

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

## WORK IN PROGRESS, not committed — `npm run verify:defaults` — 2026-08-17

**Uncommitted in this working tree right now**: `scripts/verify-reproduce-defaults.mjs`,
`scripts/verify-reproduce-place-defaults.mjs` (new files), `package.json`'s `verify`/`verify:defaults`
scripts, `.env`'s `FIXTURE_DIR` (repointed to a fresh render), and a refreshed
`Buses/Places/_portal-fixture/High Wycombe Aldi/routes.json`. **Do not run `npm run verify` and
assume a FAIL means a real regression until the open item below is resolved** — see it first.

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

**OPEN ITEM, left here on purpose (Peter's instruction, 2026-08-17): the place-side gate has one
apparent false positive.** `verify-reproduce-place-defaults.mjs` reports `hubFit` as "IDENTICAL on
every sheet" against the `High Wycombe Aldi` fixture — **without any deliberate mutation**, i.e. on
the CURRENT, un-broken engine. Very likely NOT a bug: item 3b's session already found and documented
that "Aldi" is short enough to hit the 26mm hub-box floor under BOTH the `hubFit` and legacy sizing
formulas, so the two are byte-identical for this one place regardless of whether the engine's `hubFit`
code is doing anything at all — see `design-quality.md`'s "The PLACE external" section, `HUBFIT`. That
would make this a genuine **untestable-by-this-fixture** case, not dead code. **Needs confirming, not
re-investigating from scratch**: revert any stray mutation first (`git diff engine/place/gen_internal.js`
should be empty), run `node --env-file-if-exists=.env scripts/verify-reproduce-place-defaults.mjs`
alone, and check whether `hubFit` is STILL "IDENTICAL" with nothing broken. If so, exclude it from the
`KEYS` list in `verify-reproduce-place-defaults.mjs` with a comment citing this paragraph and the
`design-quality.md` finding — do not silence it by weakening the assertion for every key, only this one,
and only with a cited reason. If the isolated re-run instead shows hubFit CHANGING something (meaning
this note's hypothesis is wrong), treat it as a live gate failure and investigate the generator, not the
test.

**Before landing any of this:** the `hubFit` item above must be resolved (excluded-with-reason or fixed)
so `npm run verify` does not FAIL on a healthy tree — a gate that cries wolf gets ignored, this repo's
own `fixture-freshness.mjs` says so in as many words. Then: re-run the full `npm run verify` chain
clean, add `verify:defaults` to the "Gates to run" section above, note it in `CHANGELOG.md`, and check
whether the Buses repo's `Documentation\README - How to enhance the system.md` or `gotchas.md` want a
line about the fixture-vs-vendored-copy trap this took two attempts to notice.

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
`CHANGELOG.md`'s "impeccable round-2 findings" entry): a new `--accent-tint-ink` token replaced
`var(--accent)` as text-on-tint wherever that pattern occurred (including `.pill.amber`, which shared
the bug but wasn't named in the critique), and the grid dropped to 4 cards. Remaining open items from
that snapshot are P2/P3 only (uncontrolled emoji icon system, succession-risk section not bridging
back) — lower priority, not yet scheduled.

**Whenever `/impeccable critique` (or any command spawning its Assessment A/B sub-agents) runs here,
pass `model: "opus"` on both sub-agent calls** — Peter's standing instruction, not specific to this
repo.
