# Runbook R4 — Monthly update cycle

**Serves:** managing updates · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** Keep published maps current as bus services change — the central refresh → **proposed
update** → customer **accept** flow (P5). Run monthly (with the BODS cycle), or when a service you
know about changes.

The split again: **you** regenerate a town's data centrally (live sources + judgement); the **portal**
stages it as a proposed update the customer reviews. Published maps keep serving untouched until the
customer accepts — nothing changes under them.

## What triggers it

The monthly BODS refresh.

> **Claude-assisted shortcut:** the Buses side mines **upcoming changes** (`gtfs_upcoming.py` — the
> ≥42-day-ahead feed + a month-over-month diff → a per-town upcoming-changes report) so you know
> *which* towns actually changed before regenerating anything. Work those first; skip the unchanged.

## Step 1 — Regenerate the map data (central)

For each map that changed, re-run its skill (`make-bus-leaflet` / `make-place-bus-leaflet`) to produce
a **fresh S5-render dir** for the new month. Same making step as R1, for an existing map.

## Step 2 — Stage it as a proposed update

**Stop the dev server** (one SQLite writer). Then, per map:

```bash
node scripts/propose-update.mjs --map st-ives --src "<fresh S5-render dir>" --note "BODS August 2026 refresh"
```

- `--map` = slug or numeric id · `--src` = the fresh render dir · `--note` = a label.
- It stages the fresh payload **beside** the live map (does **not** touch it), computes a plain-language
  **service-facts diff** — routes added/removed, descriptions changed, stops changed, operators
  added/removed, validity dates — and stores it as a **proposed update**. It prints the diff to
  sanity-check.
- The map must already have built data. A newer refresh **supersedes** any still-pending one (one open
  per map).

## Step 3 — The customer reviews + accepts

The customer sees it on their dashboard: an **old-vs-new preview** plus the diff. They **Accept** —
their colours + POI toggles are **re-applied onto the fresh data as a new major version** (which then
goes through the normal **sign-off**, R3) — or **Decline**.

- You can watch the queue at **`/app/admin` → Proposed updates**.
- Accepting is **blocked while a publication awaits sign-off** (withdraw that first).
- **Nudge** customers who don't act — an unaccepted update means their published map is going stale.

## Step 4 — Sign off + housekeeping

- An accepted update is a new **draft** → sign it off (**R3**) so the public map advances.
- Periodically clear settled staging: `npm run prune:staged -- --days 90 --dry-run`, then without
  `--dry-run` ([DEPLOY.md §6](DEPLOY.md)). It never touches a pending update, live data, or a rendered
  version.

## What-if

- **No changes detected** → the diff says "none"; don't stage a no-op.
- **Customer declines** → they keep the current map; re-propose next month or when it matters more.
- **Wrong data staged** → re-run `propose-update.mjs` with the right `--src`; it supersedes the pending
  one.
- **Map not built yet** → the script refuses ("nothing to refresh") — build it first (**R1**).
