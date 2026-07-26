# Runbook R3 — Review & publish (approver sign-off)

**Serves:** managing updates · **Owner:** operator (as approver) · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** How a version becomes the **official public map** — the judgement layer over the P4
mechanics. This is the **third approval gate** (publish), and the one that matters most: people rely
on the result.

> **Pilot.** Every sheet you publish carries a red **PILOT — SAMPLE MAP** band across the top while
> `PILOT_MODE` is on. That is correct for our own demo maps. **The wording is wrong for a real
> customer's map** ("Not published by any organisation") — before signing off the first genuine
> customer map, decide whether the pilot ends, or the band's wording changes for real maps. Both are
> one edit in `src/config.js`; see [`PILOT.md`](PILOT.md).
>
> Note also that a version renders its band at render time, so a version rendered before the pilot
> landed publishes **unstamped**. `node scripts/restamp-renders.mjs` (dry run first) tells you.

## The rule — separation of duties

The **editor** who makes a change **submits** it; a platform **approver** (or admin) **publishes** it.
Even when you are both, act in the right seat — submit as the editor, then switch to the approver view.
The audit depends on it. Approvers can **read/inspect any** map but **never edit** one.

## Step 1 — Editor submits (freezes the head)

In `/app/maps/:id` → **Publish** panel, the editor hits **Submit for publication**. Editing then
**freezes** (save → 409) so the submitted version can't move under review. **Withdraw** returns it to
draft.

## Step 2 — Approver opens the review

As approver/admin, open **`/app/review`** (the queue). Each submission gives you:

- **The change summary** — a deterministic diff of *this version vs the currently-published one* (or
  the baseline, if nothing is published yet). Because the safe subset only permits **route recolours**
  + **POI show/hide**, this diff is **complete** — nothing else can have moved. It lists: routes whose
  colour changed (from → to), POIs newly hidden, and POIs newly shown.
- **The print files** — inspect the full-size JPGs inline.

## Step 3 — Complete the sign-off checklist

All five are **required** and **server-enforced** — you cannot publish with any unticked:

1. **services** — every bus service that should appear is shown, with the correct number and destination.
2. **colours** — route colours are distinct and remain colour-blind friendly.
3. **pois** — the points of interest shown or hidden are correct; nothing important is missing.
4. **legible** — you have **viewed the full-size print (JPG)** and all text is legible.
5. **accurate** — to the best of our knowledge the information is accurate and current.

These aren't box-ticking; they're the transit-safety promise. Item 4 especially means **actually
opening the JPG**, not trusting the on-screen preview.

## Step 4 — Decide

- **Publish** → sets the map's **public-current** version (`published_version_id`), retires the
  previously-published one to `superseded`, and moves the map to `published`. **Publishing never
  re-renders** — the approved bytes are exactly what gets served, so the byte-identical guarantee is
  untouched.
- **Send back** → a **reason is required**; the version → `rejected` and editing unlocks so the editor
  can fix and resubmit.

Both outcomes land in the append-only **audit log** (admin → **Audit**) with who/what/when plus the
evidence (the change summary + your completed checklist).

## Two pointers — don't confuse them

- `current_version_id` = the **working head** (moves on every editor save).
- `published_version_id` = the **public-current** official version (moves **only** here, on sign-off).

The public site serves the **published** pointer; edits in flight never reach the public until signed
off.

## What-if

- **Checklist won't submit** → an item is unticked (the server rejects an incomplete checklist; the UI
  disables **Publish** until 5/5).
- **You published something wrong** → that's an **incident** (**R6**, planned): roll the public-current
  pointer back to a known-good version, or push a corrected version through this gate. **Never** edit a
  served file in place.
- **Empty queue** → submissions appear only after an editor submits; nothing to do.
