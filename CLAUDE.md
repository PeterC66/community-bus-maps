# BusMaps.uk — portal

<!-- docstamp v1.11 | 2026-08-15 | sha=fa4c858a -->
**v1.11** · updated 15 August 2026

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
`docs/PORTAL-DEV-PLAN-2026-08-12.md` item 2), the **version list**, the **compare-dialog change
bullets**, the **download-row labelling**, the **unit of publication**, the **`draft-unsubmitted`
worklist item**; and **H9** — a purely presentational "editor's-eye view" toggle for admins
(`public/js/editor-eye-view.js`), plus the independent status-strip wording fix it exposed ("their
move · you can act as admin"), both shipped 2026-08-12.

`docs/PORTAL-DEV-PLAN-2026-08-12.md` is the record of the session that closed this backlog out and
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

## Design review (Impeccable)

`PRODUCT.md` and `DESIGN.md` at repo root are the Claude Code `/impeccable` skill's product/design
authority for this repo — read them before any UI work rather than re-deriving audience or visual
rules from the code. `.impeccable/critique/` holds dated critique snapshots (`/impeccable critique
<target>`); every P0 and P1 the first (2026-08-14) critique of the homepage found were fixed
2026-08-15 (see `CHANGELOG.md`). Only its Minor Observations remain open (uncontrolled emoji icon
system, map images lacking "paper" framing in dark mode, missing width/height on `.map-list`
thumbnails, the diagram "extra" cost badge having no magnitude, an ungrouped 10-link footer) — worth
a `critique` re-run before the next round of homepage work rather than assuming the score still holds.
