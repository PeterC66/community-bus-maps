# BusMaps.uk — portal

<!-- docstamp v1.5 | 2026-08-09 | sha=27131643 -->
**v1.5** · updated 9 August 2026

A self-serve portal that lets approved organisations generate and maintain printable bus maps.
Private repo, Business Source License 1.1 (converts to Apache-2.0 on 2030-08-09; free for
non-commercial/internal use, competing commercial use needs a separate licence — see `LICENSE`).
Node + Fastify + `node:sqlite`, no template engine, no framework.

## Read this first: the system is a PILOT

It is feature-complete (P0–P7) and it works end to end — which makes it read like a live service.
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

The headline, so it is not rediscovered the hard way: `changeSummary()` diffs **only** the
customer's safe-subset overrides, so a version created by accepting a *data* refresh reports as
unchanged — and the review screen tells the approver *"this version is identical to the published
version — there is nothing to change"*, which is false and weakens the publish gate.

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
