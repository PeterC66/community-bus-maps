# Developing the portal — how to change it safely

<!-- docstamp v1.10 | 2026-08-12 | sha=a89d3399 -->
**v1.10** · updated 12 August 2026

This is the **developer** counterpart to the operator documentation. The [Operations Handbook](H1-operations-handbook.md) and the runbooks tell you how to *run* the service; this tells you how to *change* it without breaking the two things the product rests on: the deterministic render, and the approval gates.

`README.md` covers architecture and quick start — read that first. Start here when you are about to edit code.

## Three separate copies of the code — none of them update each other automatically

This section didn't exist in earlier drafts of this doc, written before there was a live host. There now are **three distinct places** code can be, and moving between them is always a deliberate, manual step — never automatic:

| Copy | Where | Who can see it | How it gets updated |
|---|---|---|---|
| **Your working copy** | `C:\Claude\community-bus-maps` on the laptop | only you, and only while `npm run dev` is running (`127.0.0.1:5180`) | you edit files directly |
| **GitHub `main`** (+ other branches) | `github.com/PeterC66/community-bus-maps` | anyone with repo access; it's the shared history | `git push` from the laptop, or merging a PR on GitHub |
| **The live VPS** | OVHcloud, serves the real public site with 13 real published maps (`docs/DEPLOY.md` §9) | the public, once DNS/Caddy is pointed at it | someone runs `git pull && docker compose up -d --build` **on the VPS itself**, by hand |

The important consequence: **`git push` does not deploy anything.** Pushing a branch, or even merging a PR into `main`, only changes what's stored on GitHub. The live VPS keeps running whatever was last pulled onto it until a person logs in and pulls again — there is no CI/CD hook, no webhook, no auto-deploy. That gap is deliberate at this stage (pilot, one operator, no customers depending on zero-downtime rollout) but it means you cannot reason about the live site from `git log` alone — check `docs/DEPLOY.md` §9 for what's actually been pulled onto the VPS, or ask before assuming a merged change is live.

Practically, this makes ordinary git operations lower-risk than they'd otherwise be: pushing a branch, or opening/merging a PR, cannot break the public site by itself — that only happens at the separate, manual VPS deploy step. It also means **there is no "preview URL per branch."** To see what a branch looks like running, `git checkout` it on the laptop and `npm run dev` — that's a full working portal, just local to you, using your own local `data/portal.sqlite` (empty until you seed it, see `DUMMIES_GUIDE.md` Part 3). It cannot affect the live site or anyone else's laptop.

See [`docs/DUMMIES_GUIDE.md`](DUMMIES_GUIDE.md#8-managing-a-change-across-laptop-github-and-the-live-site) for the plain-language walkthrough of what to commit, push, and merge when, and what never happens without being asked.

> **The system is a PILOT.** It is feature-complete but has **no customers** — every organisation in the database is seeded demo data and every published map is one of ours. Every page carries a banner and every rendered sheet a band saying so, gated on one env var. Two consequences for you: the render path has a post-generation step you need to know about (see *The gates you must run*), and **you must not write copy that claims customers, uptime or response times**. Read [`PILOT.md`](PILOT.md) before touching the render path, the public copy or the seed script.

---

## The two things you must not break

### 1. Determinism

Given a map's data + config + a customer's overrides, the engine must produce **byte-identical** output every time, with **no network access and no AI**. Everything else in the product is built on that promise: customers self-serve edits, the server re-renders untrusted input, and a print file is reproducible months later.

Concretely, in any engine or render code:

- No timestamps, no `Math.random`, no locale-dependent formatting, no reliance on filesystem ordering in anything that reaches the SVG.
- No `fetch`/network at render time. Everything a map needs is baked into its payload at import.
- **Absent config ⇒ previous behaviour.** Every new feature is opt-in via a config key and must be byte-identical when the key is missing. This is what lets a new capability ship without re-validating every existing map.

The pilot band is the worked example of doing this *without* touching the engine: it is applied to the finished SVG in `src/render/renderMap.js` **after** the generator has run, so the generator's own bytes are unchanged and the determinism gate still tests determinism. If you need to add something to every sheet, copy that pattern rather than editing generators — they are vendored per-map (below), so editing `engine/` would not change a single existing map anyway. `src/render/badgeContrast.js` is the second one (a route number must stay readable on a recoloured badge), and it shows the other half of the discipline: a post-generation fix must be a **no-op on a sheet that does not have the fault**, so an untouched map is still byte-for-byte what the generator produced. Both have a companion `scripts/*.mjs` that applies them to sheets already in the object store, because a fix at render time reaches nothing that was rendered before it landed.

### 2. The three approval gates

Nothing reaches the public without a human. Don't add a code path that routes around these:

| Gate | Where | What it enforces |
|---|---|---|
| **Organisation approval** | application → pending account → admin approve | only vetted orgs get in |
| **Map request + quota** | `src/db` map-request lifecycle, server-enforced quota | a customer can't mint unlimited maps |
| **Publish review** | `src/publish` — draft/published two-pointer, approver checklist, audit | no draft becomes a published/printable map without a reviewed approver |

Note also that **publish ≠ public**. A published map only appears on the public front when the customer's own `map.public_listed` switch is on, the customer is active, and the map is published — all three enforced in SQL in `src/public/`.

---

## The engine is vendored, not imported

The map generators are **maintained in a separate authoring toolchain** (the "skill" side, which also does the data fetching, area onboarding and monthly refresh — the judgement-heavy work that deliberately does not live in this repo). This repo holds **byte-for-byte copies**.

| Location | What | Who owns it |
|---|---|---|
| `engine/` | `render.js`, `icons.js` — the shared rasteriser and icon paths | copied from the authoring toolchain |
| `engine/place/` | the place engine, copied into each place map's `data/` at import, plus the portal's `gen_internal_place.js` wrapper | two copied, one portal-owned |
| `engine/expert/` | the schematic + diagram pre-stages, plus the portal's two wrappers | two copied, two portal-owned |
| *(not vendored)* | area generators — these travel **with each map's data** in the object store | per-map |

Each of those folders has its own `README.md` explaining the provenance and why it is arranged that way. Read the relevant one before touching anything in it.

**Consequence:** if the authoring toolchain's engine changes, this repo keeps running the old code until someone re-copies the files and re-runs the gates. There is no automated drift check. When you re-vendor, re-run every gate below and note it in `CHANGELOG.md`.

### The generator env contract

All generators, vendored or per-map, are driven the same way:

| Variable | Meaning |
|---|---|
| `LEAFLET_DIR` | the folder holding the map's data — all inputs read from here, SVG written here. **Preferred over cwd.** |
| `SKILL_ASSETS` | where `icons.js` resolves from (falls back to a sibling `icons.js`) |
| `OVERRIDES_FILE` | the customer's saved safe-subset edits. **Absent or empty ⇒ byte-identical baseline.** |
| `EDITOR_KEYS` | editor-support keys emitted into the SVG |

**The `LEAFLET_DIR` trap.** The schematic and diagram pre-stages spawn `gen_internal.js` with `cwd` set to a workspace and an inherited environment. Because `gen_internal.js` prefers `LEAFLET_DIR` over `cwd`, an inherited value sends that render back to the parent folder and **silently produces the ordinary geographic map** under the expert style's filename. The wrappers in `engine/expert/` delete it for the child and pass everything else through. If you write a new pre-stage or wrapper, do the same. Symptom: an expert sheet that looks exactly like the plain internal map.

---

## The gates you must run

```bash
npm run verify:area     # area map reproduces a shipped leaflet byte-for-byte
npm run verify:place    # same for a place map
npm run test:p7         # expert styles (schematic + diagram), 6 gated outputs
npm run test:lifecycle  # request → build → publish → revert lifecycle
npm test                # public front (P6)
```

### `verify` skips silently — this has caught people out

`verify-reproduce.mjs` and `verify-reproduce-place.mjs` **exit 0 with a "skipping" message when `FIXTURE_DIR` / `PLACE_FIXTURE_DIR` are unset or missing.** That is deliberate — a fresh clone without the separate data repo should still pass `npm test` — but it means **a green run in a clean checkout proves nothing about the renderer.** Set both in `.env` (git-ignored; see `.env.example`) and confirm the output says PASS with byte counts, not "skipping", before you trust a render change.

### The post-generation sheet fixes and the reproduce gates

`generateSvg()` post-processes the finished SVG unless you pass `stamp: false` — badge contrast (`src/render/badgeContrast.js`) then the pilot band (`src/render/pilotStamp.js`). The two `verify-reproduce*` scripts pass it, because they compare the **generator's** output against a shipped fixture — they test determinism, not presentation.

**If `verify` suddenly reports the SVG DIFFERS by a few hundred bytes, check that first.** The fix is never to disable the stamp globally: if a verify script has lost its `stamp: false`, restore it; if it still differs with the stamp off, the generator genuinely changed and the section below applies.

Sheets already in the object store keep whatever band they were rendered with — `node scripts/restamp-renders.mjs` (add `--apply`) brings them into line, in either direction.

### When a gate legitimately fails

If output changed *on purpose*, the shipped fixture is now stale. Re-render the fixture from the new engine, re-import it, and record why in `CHANGELOG.md`. **Never relax a gate's expectation to make it pass** — the gate is the product's core claim.

---

## Where things live

`README.md` has the full layout. The parts you're most likely to need:

| I want to change… | Start in |
|---|---|
| How a map is rendered / which outputs exist | `src/render/renderMap.js`, `src/maps/store.js` (`resolveGen`, `engine:` tags) |
| What a customer is allowed to edit | `src/maps/engine.js` + the safe-subset validation — **server-enforced; never trust the client** |
| Which outputs a customer may switch | `chooseOutputs()` in `src/maps/engine.js` — pure, so `test-p7.mjs` asserts the rules without a server. The tube-map diagram is `requestOnly` (hand-pinned, priced separately): a non-admin PATCH asking for it is **403**, not a silent no-op |
| The publish gate / review checklist | `src/publish/` (pure functions — unit-testable) |
| Monthly change acceptance (accept/decline a proposed update) | `src/refresh/` + `scripts/propose-update.mjs` |
| Auth / sessions | `src/auth/` (magic link, server-side sessions, hand-rolled cookies, no deps) |
| Public pages and listings | `src/public/` — a **read model** over the publish gate, PII-free by construction |
| Per-customer branding | `src/branding/` — a server-enforced whitelist. It decorates the **page**, not the printed sheet |
| The diagram pin editor | `src/expert/` + `public/app/diagram.js` (admin-only). Handles are drawn in the **sheet's** frame, not the solver's — `measureHandleFrame()` recovers the difference by fitting the tagged stop ticks; don't re-derive the generators' transforms by hand |
| Badge legibility after a recolour | `src/render/badgeContrast.js` (+ the mirrored rule in `public/app/editor.js`), `scripts/fix-badge-contrast.mjs` |
| Ops: health, metrics, backup | `src/ops/`, `scripts/backup.mjs`, `scripts/prune-staged.mjs` |
| **Pilot mode** (banner, sheet band, robots block) | `src/config.js`, `src/render/pilotStamp.js`, the `/js/site-banner.js` route in `src/server.js` — see [`PILOT.md`](PILOT.md) |
| Whether a demo org is labelled "Sample" | `customer.is_demo` → `src/branding/index.js` → `src/public/` → `public/js/public-*.js` |
| Importing a finished map | `scripts/import-map.mjs` (`--request <id>` builds an approved request in place) |
| A static per-map extra that isn't a render output (e.g. `disagreements.pdf`) | Add it to `OUTPUT_FILES` in `src/maps/store.js` as one extra entry (outside the `OUTPUTS`-driven list) so the existing generic download/serve routes pick it up for free; copy it into the version folder at the end of `renderVersion()` (`src/maps/engine.js`); add it to `carryExpertTuning()`'s file list so a staged monthly refresh that doesn't bring its own still carries the old one forward |

## House rules

- **No secrets or map/customer data in git.** The portal is a public-facing service — see README "Data hygiene". Configuration comes from `.env`.
- **Pure functions where the decisions are.** `publish/`, `refresh/`, `branding/` are deliberately side-effect-free so the rules can be tested directly. Keep them that way.
- **Server-enforced, always.** Every safe-subset restriction, quota, and visibility condition is checked on the server (and in SQL where it's a visibility condition). Client-side checks are UX, not security.
- **Attribution is not optional.** Maps derive from OpenStreetMap (ODbL) and BODS (OGL). See `NOTICE`. Don't ship an output path that drops the credit.
- **Don't claim what isn't true.** While the pilot is on there are no customers, no SLA and no guaranteed refresh cadence. Copy that says otherwise has been removed once already; don't reintroduce it. If you add a public page, give it the `/js/site-banner.js` `<script>` tag — that is what puts the pilot banner on it.
- **Update `CHANGELOG.md`** with the version and what changed — including re-vendoring.

## Stacked PRs: merge without deleting the base branch

This repo is branch → PR → merge, and merges are **squashes**. That combination breaks a stack, and
it is not obvious until it happens (it did, on 12 August 2026, merging #18 → #19 → #20):

- Squashing #18 makes a *new* commit on `main`. The branch behind #19 still carries #18's original
  commit, which is now unrelated to anything in `main`, so #19 goes **CONFLICTING** until you rebase
  it: `git rebase --onto main <old-base-tip> <branch>`.
- Worse, `gh pr merge --delete-branch` deletes the branch #19 was *based on*, and GitHub then
  **auto-closes #19** instead of retargeting it. A PR whose base branch no longer exists **cannot be
  reopened** — the only route back is to raise a fresh PR from the same branch.

So, merging a stack: **merge each PR without `--delete-branch`**, rebase the next branch onto the new
`main`, re-point its base with `gh pr edit <n> --base main`, and delete the leftover branches by hand
at the end. Re-run `npm test` (and `npm run verify` if the change goes anywhere near a render) **after
each rebase**, not just before the first one — a rebase can silently drop or duplicate a hunk.

Expect one casualty: the docstamp Stop hook restamps documents *after* your commit, so a stack often
carries a stamp-only commit that conflicts on rebase. Drop it (`git rebase --skip`) — the hook
regenerates it.

## Known rough edge

The vendored-engine duplication above is maintained by hand with no drift detection. If you are changing the engine often, that is the first thing worth fixing.

## The update/publish flow has already been reviewed — read it first

Before touching the editor, the review screen or anything in the proposed-update → accept → submit → approve → public chain, read **`Buses/Development Docs/portal-update-flow-findings_2026-08-11.md`** in the private `buses-data` repo (operator-only, outside this repo — same convention as the host details in [`DEPLOY.md`](DEPLOY.md) §9). It walks the whole flow against a real instance with every screen quoted, ranks the fixes, and its **section J** is written for someone starting cold: a file map per item, the isolated-instance recipe, and the traps.

Two things from it that change how you work here:

- **Items 1–12 of its backlog are done — the document describes the flow as it was on 11 August 2026.** Merged 12 August: **H6, A2, E** (#18), **A1** (#23), the **status strip** (#20, which also closed C1, C2, B3, B4, H1 and half of H3), then **H4+H3+D**, **B2**, **H5**, **H1**, **B1**, **H8** and **B5** in `0.9.3-pilot`. Read the findings' *Suggested order of work* first: it carries the per-item status, and the body text above it deliberately still describes the pre-fix behaviour. Only **H9** (the admin's editor's-eye view) is open.
- **None of that backlog should alter a rendered sheet.** Every item is wording, presentation or a query. If `npm run verify` fails, you have gone wrong — don't relax the gate.

Five facts about the shipped work, because they are not obvious from the file tree:

- **A version's data diff lives on the version.** Accepting a refresh writes `map_version.data_change_json` (`{ proposedId, sourceNote, summary }`); `dataChangesSince(mapId, since, until)` reads the refreshes a head carries. `changeSummary()`'s **`unchanged` means both halves are empty** — overrides *and* data. Don't reintroduce a check that looks at overrides alone; `scripts/test-change-summary.mjs` will catch you.
- **`public/app/changes.js` is shared by the editor and the review screen** — a plain script tag on both pages, no build step, exposed as `window.PortalChanges`. It renders the data-change account and the date/ageing helpers. Change it and you change both screens.
- **The status strip is a read-out, not a state machine.** `stripState()` in `public/app/editor.js` derives the five states purely from what `mapDetail` already returns. If you need a new state, the fix is almost certainly there and not in the API.
- **Emails never fail the thing they describe.** `src/email/notify.js` is fire-and-forget: it logs and swallows, so a mail outage cannot fail a publish. It sends nothing without `EMAIL_PROVIDER`, and skips RFC 2606 reserved domains (`.example`, `.invalid`) — every seeded demo organisation uses one, and bouncing at them would cost the sending reputation the magic links depend on.
- **The worklist gained a "nobody is blocked" item.** `listUnsubmittedDrafts()` + the `draft-unsubmitted` item exist because every other queue is defined by somebody being blocked, and the one state nothing surfaced was a draft that will never publish itself. Keep it a query — it must stay derived from live state, never a flag someone has to clear.

### The vocabulary — one word per thing

Settled 12 August 2026 (findings **D**), applied across the app, the public pages and `terms.html`. Use these words in any new copy; grep before inventing a synonym.

| Concept | The word | Never |
|---|---|---|
| The rebuilt map offered to a customer | **update** | monthly update, refresh, proposed update *(customer-facing — `refresh` remains the pipeline's own word for the staged payload: `propose-update.mjs`, the admin Refreshes tab, `proposed_update`)* |
| A saved state of a map | **version** (`v2.0`) | edition |
| Where a version is | **draft** → **awaiting review** → **published** | locked for review, sent for approval, submitted |
| What the customer does with a draft | **send it for review** | submit, submit for publication |
| What only an approver does | **publish** | — |
| The party that reviews | **BusMaps.uk** (to a customer), **approver** (to an operator) | we, the reviewer, the operator |
| The two geographic sheets | area: *Within the area* / *To nearby towns*; place: *Serving this place* / *Where those buses go* | area wording on a place map |

Its companion, `portal-update-flow-walkthrough_2026-08-11.md`, is the same flow written for a customer's admin person, and is the better starting point if you need to understand what the screens are *for* before changing them.

## Table-like grids: use `.grid-table`, not `<table>`

`public/app/admin.js`, `public/app/review.js` and `public/app/app.css` build every data table (admin
console: applications, map requests, awaiting-build, customers, messages, refreshes, audit, ops
store; review console: publication history) as a **CSS Grid**, not an HTML `<table>`. This was not
a style preference — it replaced a real `<table>` that had a genuine, reproducible Chrome bug.

**The bug (2026-08-07):** `table.grid` used `table-layout: fixed` with an explicit `<colgroup>` —
the standard, textbook-correct way to force table columns to stay put. In real Chrome (reproduced in
Incognito with all extensions off), the header row's columns silently stopped sharing widths with
the body rows once a body row held content the header didn't — specifically, a `<button>` or a
pill/badge sitting in a column whose header cell had `white-space: nowrap`. Headers rendered
bunched at their own intrinsic width; data columns spread to fill the table, with no relationship
between the two. Diagnosis (all confirmed against the real, non-injected page, not just a test
harness):

- Toggling `table-layout: auto` vs `fixed` on a live clone produced **byte-identical** (wrong)
  `getBoundingClientRect()` results — evidence the fixed-column algorithm wasn't being applied at
  all in that render path, despite `getComputedStyle(table).tableLayout` reporting `"fixed"`.
- `getComputedStyle(colEl).width` read back as `"0px"` for every `<col>`, even though
  `col.style.width` correctly showed the set percentage.
- An automated bisection (clone the real table, mutate one property at a time, measure) ruled out
  `td.wrap`'s `min-width`/`max-width`, `white-space: pre-wrap`, the `.tag` badge, the `.sub` div,
  `overflow: hidden` on cells, and `border-collapse` — none of them, alone, fixed or explained it.
- It reproduced with plain inline styles (no site CSS at all) once the row included a real
  `<button>` element under a `nowrap` header — but not with plain text, not with `<div>`s, not with
  `min-width` alone. It needed the specific combination.

**The fix:** stop depending on `<table>`'s column-sync guarantee. `.grid-table` (in `app.css`) is a
`display: grid` container; each row is `.gt-row { display: contents }` so its `.gt-cell` children
become direct grid items sharing the **one** `grid-template-columns` declared on `.grid-table`
itself (set inline per table, e.g. `style="grid-template-columns:20% 16% 28% 11% 10% 15%"`). Because
there is only one column-track definition for the whole component — not one resolved per row the
way `<table>` does it — header and body cannot drift apart; there's no separate algorithm to
disagree. `gtOpen(colWidths, headers)` in `admin.js` builds the opening markup; `gtClose` closes it.
Roles (`role="table"/"row"/"columnheader"/"cell"`) preserve table semantics for assistive tech since
these are no longer real `<table>` elements.

**If you add a new admin/review table:** use `gtOpen()` / `.gt-row` / `.gt-cell`, not `<table>`. If
you're tempted to use a real `<table>` for something else in this codebase, it's probably fine for
plain-text content — the bug needs unbreakable content (buttons, badges) under a nowrap header to
trigger — but there's no known safe subset, so default to the grid pattern for anything with actions
or status pills in a cell.
