# Daily To-do Quickstart (H2) — BusMaps.uk

<!-- docstamp v1.0 | 2026-08-08 | sha=27db8329 -->
**v1.0** · updated 8 August 2026

**v1.0** · updated 8 August 2026

**For:** the operator (Peter), doing an ordinary daily/weekly pass. **Assumes:** the portal server is already running and you are signed in as **admin**.

**Purpose.** One page: open the To-do list, work down it, close it out. No runbook reading required for a normal day — this is the "just tell me what to click and what to type" version of [H1](H1-operations-handbook.md). If something here disagrees with H1 or a runbook, they're right and this page is stale.

---

## The loop, in one picture

```
Portal (/app/admin → To do)  --tells you what needs doing-->
Laptop (bus-work skill)      --does the making + the commands-->
Portal (import / propose)    --delivers the result back-->
Portal (/app/admin, /app/review)  --you decide, in the browser-->
```

Two places to look, never more:

1. **The portal's To-do tab** — `/app/admin`, opens on **To do** by default. Every queue, one list, ranked by who's blocked.
2. **The `bus-work` skill on the laptop** — same list, plus laptop-only signals the portal can't see (stale renders, missing verification). Run it in Claude Code:

```powershell
node "%BW%\worklist.mjs"
```
(`BW` = `C:\u3a St Ives\.claude\skills\bus-work\assets`.) Or just say **"what's next on the buses"** / **run bus-work** and let Claude run it for you and walk you through the top item.

**Normal daily routine:** run `bus-work`, take the top item, follow the steps below for its type, repeat until the list is empty or everything left is "waiting on others."

---

## What the rows mean

The list is banded, most urgent first:

| Band | Meaning |
|---|---|
| 🔴 Broken | something that used to work no longer does — fix before anything else |
| 🟠 Someone is blocked | a customer or applicant is waiting on **you** |
| 🟡 Your move | approved work with no one waiting yet, or portal housekeeping |
| ⚪ Waiting on others | nothing to do — a customer hasn't responded yet |

Each row has a `type`. That type tells you which section below to use.

---

## 1. `review` — a submitted map is waiting for publish

**Where:** `/app/admin` → **Proposed updates**, or click through to `/app/review`.

**What you're checking** (5-point reasonableness check, not a re-derivation of the routes):
1. Services — routes shown match the change summary
2. Colours — legible, no clashes
3. POIs — sensible, nothing missing that should be there
4. Legible — open the actual JPG, not just the thumbnail, and check it reads at a glance
5. Accurate — the deterministic change summary on the page matches what you'd expect

**Decide, in the browser:**
- **Publish** — if it passes.
- **Send back** — if not; you must give a reason. It returns to the editor as a draft.

Never decide this from the terminal — it's a browser click, always.

---

## 2. `application` — someone applied to become a customer

**Where:** `/app/admin` → **Applications**.

**Check against the vetting policy** ([Pol1](Pol1-vetting-and-quota-policy.md)) before deciding:
- Do they have a genuine connection to the area?
- Any hint of a commercial endorsement, or "cover every town automatically"?
- Any personal data on the public-facing page that shouldn't be there?

Default quota if approved: **1 area + 3 places**.

**Decide, in the browser:** Approve (creates the customer + first editor + sends a passwordless invite automatically) or Reject.

---

## 3. `request-decision` — an approved customer wants a new map

**Where:** `/app/admin` → **Map requests**.

**Check:** the area/place is covered by our bus data (GTFS region), the stops are real, and — if it's a "RED band" complex request — that it's actually buildable.

**Decide, in the browser:** Approve (it becomes a **`build`** item — see below) or Reject (frees up their quota slot).

---

## 4. `build` — an approved request with no map yet

This is the one with real terminal steps. Let `bus-work` walk you through it, or do it by hand:

**Step 1 — make the map** (on the laptop, live data + judgement):
```powershell
# area (a town):
# run the make-bus-leaflet skill for the subject town
# place (a shop/school/station/point):
# run the make-place-bus-leaflet skill for the subject
```
Ask Claude: *"build the map for `<request>`"* — it runs S1→S6 and hands you a dated **S5-render** folder plus a verification `.docx`. Keep that `.docx`.

**Step 2 — stop the dev server**, then import (from `C:\Claude\community-bus-maps`):
```powershell
node scripts/import-map.mjs --request <id> --src "<the S5-render dir>"
```

**Step 3 — verify byte-identical:**
```powershell
$env:FIXTURE_DIR = "<the S5-render dir>"; npm run verify:area
# place map instead:
$env:PLACE_FIXTURE_DIR = "<the S5-render dir>"; npm run verify:place
```
Must print **PASS** with byte counts. If it doesn't, stop — don't hand over a map that didn't verify.

**Step 4 — hand over, in the browser:** open `/app/maps/<id>` as admin, confirm the outputs (v1.0 defaults to internal-geographic + external; the tube-map diagram is request-only, see H1 §4b). The map is a **draft** until it goes through the `review` step above.

---

## 5. `refresh` — a live map's bus data has changed (BODS)

**Step 1 — regenerate** (laptop): re-run the same skill (`make-bus-leaflet` / `make-place-bus-leaflet`) for that town/place, producing a fresh S5-render folder.

**Step 2 — stop the dev server**, then stage it:
```powershell
node scripts/propose-update.mjs --map <slug> --src "<fresh S5-render dir>" --note "BODS <date> refresh"
```
This prints a plain-language diff (routes added/removed, stops, operators, validity dates) — read it before moving on.

**Step 3 — that's it for you.** It's now the customer's move: they accept (re-applies their recolours/POI toggles onto the new data as a new draft, which then needs a `review`) or decline. It shows up as `awaiting-customer` until they do.

---

## 6. `refresh-local` — a town leaflet with no portal map yet

Laptop-only, no import step:
```powershell
# re-run S1-S5 for the town via make-bus-leaflet, then:
node "%SK%\refresh_latest.js"
```
(`SK` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`.) Commit the change in the Buses repo, noting the version bump.

---

## 7. `housekeeping` — engine updated but old maps weren't rebuilt

**Engine-stale renders** (a shipped map was made with an older version of the drawing engine):
```powershell
node rollout.js --all          # dry run first — always look at this
node rollout.js --all --apply  # writes: one commit per town, minor version bump
# or just one town:
node rollout.js --town "St Ives" --apply
```
Stops itself if a label/POI would be lost in the process — read the message if it does.

**Missing/stale S6 verification:** run S6 for the town via `make-bus-leaflet`, one town at a time. Findings are either **HARD** (blocks — needs your judgement call) or **SOFT** (logged, no action needed).

---

## 8. `awaiting-customer` — staged, ball's in their court

Nothing to do if it's recent. If it's been **2+ weeks**: send a nudge email naming the map and what changed, and note that you nudged them (so it doesn't nag you again next week).

---

## 9. `gate` — 🔴 always top of the list, always first

Something the byte-identical check used to pass now fails. Reproduce it:
```powershell
node "%SK%\status.js"
```
- If a **town** fails: either it's an *intended* engine change (fix it via `housekeeping` → `rollout.js` above) or a genuine regression (fix the generator, don't ship until it's clean).
- If the **portal vendoring row** fails: re-vendor the changed file into `community-bus-maps/engine/`, then:
```powershell
npm test
npm run verify
```
Must show **PASS** with byte counts before you touch anything else. **Never relax a gate to make it pass** — that's the one rule that overrides convenience.

---

## Closing out

After each item: re-run `bus-work` (or `worklist.mjs`) and confirm the row is gone. Occasionally — or whenever you've just fixed a `gate`/`housekeeping` item — push the result to the portal so it shows up there too:
```powershell
node "%BW%\push-status.mjs"
```

## Rules that always apply, whichever type you're doing

- **Never decide a `review` / `application` / `request-decision` from the terminal.** Those are yours to click in the browser — bus-work will summarise, never decide, for you.
- **Never hand-edit a rendered file.** Regenerate instead.
- **Stop the dev server** before any command that writes (`import-map.mjs`, `propose-update.mjs`, `rollout.js --apply`, `seed-demo.mjs`). One SQLite writer.
- **PowerShell `$env:VAR = ...` form only** for the verify commands — the bash `VAR=x npm run …` form silently no-ops on this machine.
- If you're working against a **remote** portal: reading is fine, but delivery commands (`import-map.mjs`, `propose-update.mjs`, `rollout.js --apply`) only work from the machine actually hosting that portal's data. If in doubt, say so and stop rather than guess.

## If you want the why, not just the how

This page is deliberately just the steps. Background and reasoning live in:
- [H1 — Operations Handbook](H1-operations-handbook.md) — the full picture, roles, vocabulary
- [R1](R1-create-map.md) / [R2](R2-onboarding.md) / [R3](R3-review-and-publish.md) / [R4](R4-update-cycle.md) — the detailed runbooks each section above is a shortcut for
- `C:\u3a St Ives\.claude\skills\bus-work\references\playbooks.md` — the same procedures, written for Claude to follow
