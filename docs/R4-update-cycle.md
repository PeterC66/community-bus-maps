# Runbook R4 — Monthly update cycle

<!-- docstamp v1.6 | 2026-08-21 | sha=2fae54f1 -->
**v1.6** · updated 21 August 2026

> **Pilot.** A monthly cadence is the **intention**, not a commitment — the public FAQ and the customer guide are both worded that way, and no customer is relying on it yet. Don't let the docs or the site promise a rhythm the pilot cannot keep. See [`PILOT.md`](PILOT.md).

**Serves:** managing updates · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** Keep published maps current as bus services change — the central refresh → **proposed update** → customer **accept** flow (P5). Run monthly (with the BODS cycle), or when a service you know about changes.

> **The plain-English counterpart.** R1, R3 and this runbook are also told as one continuous story for the operator — *ask for a map → it gets built → it goes in → you review it → it goes live → a month later it needs refreshing* — in `C:\u3a St Ives\Using AI\Buses\Documentation\README - How to publish a map to the portal.md` (the Buses repo). That guide is deliberately command-free and defers to these three on anything technical; **if you change a step here, check whether it changed the story there.**

The split again: **you** regenerate a town's data centrally (live sources + judgement); the **portal** stages it as a proposed update the customer reviews. Published maps keep serving untouched until the customer accepts — nothing changes under them.

## What triggers it

The monthly BODS refresh.

> **Claude-assisted shortcut:** the Buses side mines **upcoming changes** (`gtfs_upcoming.py` — the ≥42-day-ahead feed + a month-over-month diff → a per-town upcoming-changes report) so you know *which* towns actually changed before regenerating anything. Work those first; skip the unchanged. `npm run check-upcoming` cross-references that report against the portal's own maps and queues a `refresh-flag` message (Admin → Messages) for every LIVE map — demo or real customer, treated the same — whose town/place shows upcoming changes, so you don't have to remember which towns have a portal map while reading the report. It does not regenerate anything itself: Step 1 below is still a human (+ Claude) job.

## S6 freshness gates delivery

`npm run deliver` refuses a **town** whose S6 verification pre-dates its own data, before it copies anything to the host (`technical-audit_2026-08-19` V3). The byte gate in step 2 proves the portal reproduces the render exactly; S6 is the different question — **is the map right** — and on 2026-08-19 every town's S6 was 8–31 days stale while all thirteen maps were live. The gate board had been printing `28d STALE` beside each one for weeks and nothing read it.

A refusal costs nothing: it happens first, locally, before the `scp`, so the host is untouched.

**Place maps have no S6** — the place skill runs P1–P5 — and the check says so out loud rather than passing silently. "Did not apply" and "passed" must not look the same at a terminal.

**Deferrals live in `scripts/s6-waivers.json` and expire.** All eight towns were stale on the day the gate landed, so shipping it bare would have made it red on its first run for everything, and a check that is red on day one gets muted inside a week. Each entry carries `until`, `why` and `removeBy`, and `deliver-map.mjs` refuses an expired entry as loudly as a missing one. To clear one: run the town's S6 stage against its current data, then delete the entry. Do not extend `until` without writing down what changed.

The one-off escape hatch is `npm run deliver -- … --s6-unchecked "<reason>"`, which prints the reason and is recorded nowhere else. Use it when you know what you are doing and nowhere near a customer's map.

## Step 1 — Regenerate the map data (central)

For each map that changed, re-run its skill (`make-bus-leaflet` / `make-place-bus-leaflet`) to produce a **fresh S5-render dir** for the new month. Same making step as R1, for an existing map.

## Step 2 — Stage it as a proposed update

**Stop the dev server** (one SQLite writer). Then, per map:

```bash
node scripts/propose-update.mjs --map st-ives --src "<fresh S5-render dir>" --note "BODS August 2026 refresh"
```

- `--map` = slug or numeric id · `--src` = the fresh render dir · `--note` = a label.
- It stages the fresh payload **beside** the live map (does **not** touch it), computes a plain-language **service-facts diff** — routes added/removed, descriptions changed, stops changed, operators added/removed, validity dates — and stores it as a **proposed update**. It prints the diff to sanity-check.
- The map must already have built data. A newer refresh **supersedes** any still-pending one (one open per map).

## Step 3 — The customer reviews + accepts

The customer sees it on their dashboard: an **old-vs-new preview** plus the diff. They **Accept** — their colours + POI toggles are **re-applied onto the fresh data as a new major version** (which then goes through the normal **review**, R3) — or **Decline**.

- You can watch the queue at **`/app/admin` → Proposed updates**.
- Accepting is **blocked while a publication awaits review** (withdraw that first).
- **Nudge** customers who don't act — an unaccepted update means their published map is going stale.

## Step 4 — Review + housekeeping

- An accepted update is a new **draft** → review it (**R3**) so the public map advances.
- Periodically clear settled staging: `npm run prune:staged -- --days 90` (dry run by default; add `--yes` to delete, [DEPLOY.md §6](DEPLOY.md)). It never touches a pending update, live data, or a rendered version.

## What-if

- **No changes detected** → the diff says "none"; don't stage a no-op.
- **Customer declines** → they keep the current map; re-propose next month or when it matters more.
- **Wrong data staged** → re-run `propose-update.mjs` with the right `--src`; it supersedes the pending one.
- **Map not built yet** → the script refuses ("nothing to refresh") — build it first (**R1**).
