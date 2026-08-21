# Runbook R1 — Create a new area or place map

<!-- docstamp v1.9 | 2026-08-21 | sha=28bb5b9e -->
**v1.9** · updated 21 August 2026

**Serves:** generating maps · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.1`

**Purpose.** Turn "we need a map of X" into a **byte-identical v1.0 baseline** in the portal, owned by the right customer and ready for editing + review.

Two halves, and the split is the point (see the Handbook): **making** the map (stages S1–S6 — live data + judgement, the central pipeline) is done by the map skills; **importing** it (deterministic, no external calls) is done here. Every map still has to pass the publish gate (R3) before it's public.

> **The plain-English counterpart.** This runbook, R3 and R4 are also summarised for the operator as one continuous story — *ask for a map → it gets built → it goes in → you review it → it goes live → a month later it needs refreshing* — in `C:\u3a St Ives\Using AI\Buses\Documentation\README - How to publish a map to the portal.md` (the Buses repo, alongside the guides for the map skills themselves). That guide is deliberately command-free and defers to these three on anything technical; **if you change a step here, check whether it changed the story there.**

> **Pilot.** Step 3's byte-identical check compares the **generator's** output, which the pilot band does not touch — but the map's rendered sheets *will* carry the band. That is correct for our own demo maps; for a real customer's map, see the note in [R3](R3-review-and-publish.md).

## Prerequisites

- The map **skills** (they live in the separate Buses tooling): `make-bus-leaflet` (a town/area) or `make-place-bus-leaflet` (a shop/school/station/point).
- The portal repo with `npm install` done; know your `DATA_DIR`.
- The owning **customer** already exists (created at onboarding — R2). You attach the map by name.
- A decision: **area** or **place**, and the **subject** (town / parish / part-of-town, or the POI).

## Step 1 — Make the map (central pipeline)

> **Claude-assisted shortcut:** run the skill. `make-bus-leaflet` for a town/area, `make-place-bus-leaflet` for a place. It runs S1 services → S2 geometry → S3 config → S4 generate → S5 render → S6 verify, red-teams the routes, and produces a dated **S5-render** folder — that folder is what you import.

The S5-render folder contains the generators + JSON inputs + the rendered SVG/JPG:
- **Area** dir carries `gen_internal.js` + `gen_external.js` + its `*.json`.
- **Place** dir carries `routes.json` + `place.json` (+ inputs). Its generators are **vendored in the portal** (`engine/place/`) and copied in at import — they need not be in the src.

Keep the skill's verification `.docx` with the job — it's your red-team evidence.

## Step 2 — Import into the portal (deterministic)

**Stop the dev server first** (one SQLite writer). Then:

```bash
node scripts/import-map.mjs \
  --src "<path to the S5-render dir>" \
  --name "St Ives" \
  --slug st-ives \
  --kind area \
  --subject "St Ives" \
  --customer "St Ives Town Council" \
  --customer-type council
```

Flags:

| Flag | Meaning |
|---|---|
| `--src` (required) | the S5-render dir |
| `--name` (required) | display name |
| `--slug` | URL slug (defaults to a slugified name); **must be unique** |
| `--kind area\|place` | default `area` |
| `--subject` | what the map is of (defaults to `--name`) |
| `--customer "Name"` | attach to that customer (created if missing). **Omit ⇒ unowned (admin-only, invisible to the public site — see below)**; always name an owner, even for our own demo maps |
| `--customer-type` | one of `council · shop · business · school · function-organiser · charity-nt · other` (only used if the customer is created here) |

What it does: copies the generators + JSON inputs into the git-ignored object store (`DATA_DIR/maps/<id>/data/`); stores any shipped `overrides.json` as **expert framing** (`base-overrides.json`, merged *under* customer edits — never as the customer layer); writes empty customer overrides `{}`; renders **v1.0 = the byte-identical baseline**; prints the new map id and its edit URL `/app/maps/<id>`.

## Step 3 — Verify the baseline is byte-identical

The whole system rests on v1.0 == the shipped leaflet. Confirm it:

```powershell
$env:FIXTURE_DIR = "<the S5-render dir>"; npm run verify:area   # or PLACE_FIXTURE_DIR + verify:place
```

**The shell matters here.** This was written as bash (`FIXTURE_DIR="…" npm run …`) until 2026-08-07, and PowerShell has no inline env-var prefix: run that way on Windows the variable is never set, `npm run verify` **skips silently**, and the check reports nothing while looking like it passed. In bash the original form is still correct.

Green = the portal reproduces the desktop bytes exactly — insist on **PASS with byte counts**, not merely a zero exit. **If it fails, stop** — check the `sharp`/libvips version against the desktop pipeline before anything else (see [DEPLOY.md §7](DEPLOY.md)).

## Step 4 — Choose outputs, then hand to review

- Sign in as admin, open `/app/maps/<id>`, set which of the four **outputs** this map offers (v1.0 renders internal-geographic + external by default; the two expert styles are opt-in).
- The map is a **draft**. It only reaches the public through the publish gate (**R3**): the customer edits + submits, an approver reviews.

## Demo and example maps (for demos, docs and screenshots)

Same runbook — **do not "just leave off `--customer`"**. Without an owner the map is *unowned*, and unowned means admin-only: the public front's queries all `JOIN customer`, so an unowned map can never appear on `/maps`, `/m/<slug>` or `/o/<org-slug>` no matter how far it gets through the publish gate. There is also no editor account, so the edit → submit → review loop — the thing most worth demonstrating — can't be shown at all. Owner also carries the branding, the org credit and the **Sample** badge.

Give every example map a **seeded demo organisation** instead, flagged `is_demo` so it is labelled "Sample" on every public surface:

- **Preferred — add it to `DEMO[]` in [`scripts/seed-demo.mjs`](../scripts/seed-demo.mjs)** and re-run the script. It is idempotent (existing customers, users and maps are reused, not duplicated), it creates the customer with `is_demo: true` plus an editor user and public branding, it calls `import-map.mjs` with the right flags, and `publishBaseline()` takes the map through a real P4 review so it has a live public page. The point is reproducibility: `data/` is git-ignored, so a map that exists only in your local `DATA_DIR` is lost on a fresh checkout — a map in the seed script is not.
- **Ad hoc** — run Step 2 with `--customer "<Demo Org>" --customer-type …`, then set the flag (`setCustomerDemo(id, true)`). Skip that and the organisation renders publicly as if it were a real customer, which contradicts the pilot's "there are no customers" claim ([`CLAUDE.md`](../CLAUDE.md), [`PILOT.md`](PILOT.md)).

The three orgs are deliberately spread **0 / 1 / the rest** across the seeded maps, not one-org-per-map — so an editor login exists for each UI state worth demoing (an empty dashboard, a plain single-map org, and a multi-map org with mixed kinds/statuses) without having to approve an application first. New example maps should generally go to the "rest" org rather than minting a fourth org, unless the point of the example specifically needs its own owner (e.g. demonstrating org-scoped isolation).

Two standing rules for demo material:

1. **Name and label them so they can't be mistaken for the real body.** The seeded three (Broadmeadow Parish Council, Fenmarsh District Council, Oakfield Community Transport Trust — all suffixed "(demo)") are fully invented names, not paired with any real body: the grouping is deliberately by **map-count, not by locality** (see below), so there is no real council or business the name could plausibly be mistaken for anyway. Each still carries `is_demo` *and* an explicit "Sample organisation — invented for testing, not a real customer" blurb — don't drop either just because the name is already unmistakable.
2. **Sample labelling is not pilot-gated** — it must survive `PILOT_MODE=0`. The red **PILOT — SAMPLE MAP** band on the sheets *is* pilot-gated, and on our own demo maps it is correct and wanted.

Worth covering across the set, so the docs can point at a real example of each: both **kinds** (area and place), a cross-border / multi-locality area, one outside the home GTFS region, and at least one map with the **expert styles** switched on (schematic + tube-map diagram are opt-in per map) so all four outputs are demoable. Note the diagram is *request-only* for customers — you switch it on, they ask ([OPERATIONS-HANDBOOK §4b](H1-operations-handbook.md)).

## Taking over a demo-held town (a real customer wants St Ives / St Neots / …)

**Policy: one live map per town, ever — the demo org's or a real customer's, never both.** A real
customer signing up for a town a demo org already holds is not a second map; it's the demo's map
being retired and a real one taking its place, starting clean at **v1.0** (see [R2 → Step
5](R2-onboarding.md#step-5--their-maps)).

`import-map.mjs` refuses a duplicate `--slug` outright (What-if below), so retire the demo's map
first:

```bash
# server STOPPED (one writer)
node scripts/delete-map.mjs --slug st-ives              # dry run — shows owner, version/publish/
                                                          # proposed-update counts, the data/maps/<id>
                                                          # folder; deletes nothing
node scripts/delete-map.mjs --slug st-ives --yes         # actually deletes: the map row, its
                                                          # versions, publish requests and proposed
                                                          # updates, and data/maps/<id>/ on disk
```

Then build and import as normal (Step 1–4 above), owned by the real customer:

```bash
node scripts/import-map.mjs --src "<S5-render dir>" --name "St Ives" \
     --slug st-ives --customer "St Ives Town Council" --customer-type council
```

`nextVersion()` starts a brand-new map row at v1.0 unconditionally — there's nothing to reset, the
fresh row just never had a v6-whatever to inherit. Detail worth knowing: `delete-map.mjs` does
**not** touch the `customer` row, so the demo organisation itself survives (it may still own other
demo maps); it detaches (doesn't delete) any `message` rows the old map had received; and it writes
the deletion to the append-only `audit_log`, same as any other governance action.

**If the demo still needs a placeholder town after this**, don't try to coexist on the same slug —
give it a different, as-yet-unclaimed town instead. See `scripts/seed-demo.mjs` and the *Demo and
example maps* section above.

## Building a map a customer asked for (fulfil the request in place)

When the map exists because a customer **requested** it (R2 → customer requests → admin **approves**), build it into **that row**. The approved request *becomes* the built map: one row, quota counted once, no placeholder to tidy.

The admin console lists what is waiting: **`/app/admin` → Map requests → "Approved — awaiting a build"**, with the exact command per row (there's a **Copy** button). The same queue from the shell:

```bash
node scripts/import-map.mjs --list-requests
```

Then make the map (Step 1) and fulfil the request with its id:

```bash
node scripts/import-map.mjs --request 7 --src "<path to the S5-render dir>"
```

In `--request` mode the row supplies the defaults, so only `--src` is required. **Owner, kind, name, slug and subject come from the request**; `--name`, `--slug` and `--subject` still override (useful to correct "Seam Village" to "Seam Village, Cambs" at build time). Everything else is as Step 2, and the map lands as an ordinary **draft** — the publish gate (R3) is unchanged.

It refuses, before touching anything, if:

| Refusal | Why / what to do |
|---|---|
| the request is still `requested` | **approval is the gate** — approve it in the admin console first |
| the map has already been built | new *data* for a built map is the monthly refresh (`propose-update.mjs`), not an import |
| `--kind` differs from the request | quota is per kind; reject the request and ask for the right kind rather than repurposing the row |
| `--customer` names a different organisation | re-owning someone's map is not an import job — drop the flag |
| the slug belongs to another map | pick another `--slug`; if the slug is a queued request's, it tells you the `--request <id>` to use instead |

Fulfilment is written to the audit log as `maprequest.fulfil` (who/when/which version/from which src).

**Plans changed?** An approved request that will never be built can be **archived** from the same admin table, which frees the customer's quota slot. As admin you can also build + import **proactively**, with no prior request — that's the plain Step 2 form.

## What-if / rollback

- **Slug already exists** → pick another `--slug`, or retire the existing map first: `node scripts/delete-map.mjs --slug <slug> --yes` (dry run without `--yes`). If the slug belongs to an approved request, build *that* row instead: `--request <id>`. If it belongs to a demo map a real customer is taking over, see *Taking over a demo-held town* above.
- **Wrong customer** → re-import under the right `--customer` (new row) and archive the wrong one; there's no in-place re-owner tool.
- **Bad build** → pre-publish, the object store + v1.0 are disposable: `node scripts/delete-map.mjs --map <id> --yes` (removes the row, its versions, and `maps/<id>/`), then re-import. **Never** hand-edit a rendered file — always go through a version. A **fulfilled request** is a normal map by then, so re-doing it means deleting that row too: the request itself is gone (it *is* the map), so re-import as a fresh map with `--customer`.
