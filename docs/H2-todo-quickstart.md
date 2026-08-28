# Daily To-do Quickstart (H2) — BusMaps.uk

<!-- docstamp v1.5 | 2026-08-28 | sha=14befbaa -->
**v1.5** · updated 28 August 2026

**v1.0** · updated 8 August 2026

**For:** the operator (Peter), doing an ordinary daily/weekly pass. **Assumes:** you're working against the **live portal — `busmaps.uk`** — signed in there as admin. That's the normal case now the pilot is deployed; every command below defaults to it.

**If you are testing the process against the local portal** (the dev checkout on this laptop, `http://localhost:3000`, not the live site) **then** swap in the local-mode variant called out under each step — look for the ▸ **Testing locally instead?** line. Don't mix the two: a local-mode command never touches busmaps.uk, and a live-mode command never touches your dev checkout's database. If you're ever unsure which one a command actually talked to, both `worklist.mjs` and `push-status.mjs` print a banner at the very top of their output — `REMOTE — LIVE PORTAL (…)` or `LOCAL — dev checkout (…)` — read that before reading anything else they print.

**Purpose.** One page: open the To-do list, work down it, close it out. No runbook reading required for a normal day — this is the "just tell me what to click and what to type" version of [H1](H1-operations-handbook.md). If something here disagrees with H1 or a runbook, they're right and this page is stale.

---

## The loop, in one picture

```
Portal (busmaps.uk/app/admin → To do)  --tells you what needs doing-->
Laptop (bus-work skill)                --does the making + the commands-->
Portal (busmaps.uk import / propose)   --delivers the result back-->
Portal (busmaps.uk/app/admin, /app/review)  --you decide, in the browser-->
```

"Portal" means `busmaps.uk` throughout this page unless a step explicitly says otherwise.

Two places to look, never more:

1. **The portal's To-do tab** — `https://busmaps.uk/app/admin`, opens on **To do** by default.
   ▸ **Testing locally instead?** `http://localhost:3000/app/admin`, dev server running.
2. **The `bus-work` skill on the laptop** — same list, plus laptop-only signals the portal can't see (stale renders, missing verification). It talks to the **live** portal by default. Run it in Claude Code:

```powershell
node "%BW%\worklist.mjs" --url https://busmaps.uk --cookie <cbm_session value>
```
(`BW` = `C:\u3a St Ives\.claude\skills\bus-work\assets`.) Or just say **"what's next on the buses"** — Claude defaults to live in this context unless you say "local" explicitly, and reads the stored cookie itself (see below).

**The `cbm_session` cookie — get it once a month, not every session.**

Sessions last **30 days** (`SESSION_DAYS` in `src/auth/index.js`). Claude keeps the current value at `C:\Claude\community-bus-maps-ops\live-admin-cookie.txt` (that folder is local-only, never in git — see its own `README.md`) and reads it from there for every `worklist.mjs` / `push-status.mjs` call, so you don't hand it over each time you ask "what's next."

To refresh it — needed once the stored one is ~30 days old, or if a `worklist.mjs`/`push-status.mjs` call comes back with an auth error:
1. Sign in as admin at `https://busmaps.uk` (email → magic link, or reuse the `/auth/verify?token=…` link from the sign-in email).
2. Open DevTools → Application → Cookies → `busmaps.uk` → copy the `cbm_session` value.
3. Paste it in chat. Claude overwrites `live-admin-cookie.txt` with the new value and date, and re-verifies with a live `worklist.mjs` call.

Claude should proactively remind you to do this once the stored cookie is close to 30 days old — check the `obtained:` date in that file before relying on it for a live call.

▸ **Testing locally instead?** Drop `--url` and `--cookie` entirely:
```powershell
node "%BW%\worklist.mjs"
```
With no `--url` it reads the local dev checkout's own SQLite directly (faster, and read-only either way) — but it is **not** the live site's data, so don't act on a local-mode list as if it were the real queue. Say "local" explicitly if that's what you want; otherwise assume live.

**Normal daily routine:** run `bus-work` against the live portal, take the top item, follow the steps below for its type, repeat until the list is empty or everything left is "waiting on others."

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

**Where:** `https://busmaps.uk/app/admin` → **Proposed updates**, or click through to `https://busmaps.uk/app/review`.
▸ **Testing locally instead?** `http://localhost:3000/app/admin` / `/app/review`.

**What you're checking** (5-point reasonableness check, not a re-derivation of the routes):
1. Services — routes shown match the change summary
2. Colours — legible, no clashes
3. POIs — sensible, nothing missing that should be there
4. Legible — open the actual JPG, not just the thumbnail, and check it reads at a glance
5. Accurate — the deterministic change summary on the page matches what you'd expect

**Decide, in the browser:**
- **Publish** — if it passes.
- **Send back** — if not; you must give a reason. It returns to the editor as a draft.

Never decide this from the terminal — it's a browser click, always, and it's always the live site unless you deliberately opened localhost to test.

---

## 2. `application` — someone applied to become a customer

**Where:** `https://busmaps.uk/app/admin` → **Applications**.
▸ **Testing locally instead?** `http://localhost:3000/app/admin` → Applications.

**Check against the vetting policy** ([Pol1](Pol1-vetting-and-quota-policy.md)) before deciding:
- Do they have a genuine connection to the area?
- Any hint of a commercial endorsement, or "cover every town automatically"?
- Any personal data on the public-facing page that shouldn't be there?

Default quota if approved: **1 area + 3 places**.

**Decide, in the browser:** Approve (creates the customer + first editor + sends a passwordless invite automatically — a real email now the pilot is live) or Reject.

---

## 3. `request-decision` — an approved customer wants a new map

**Where:** `https://busmaps.uk/app/admin` → **Map requests**.
▸ **Testing locally instead?** `http://localhost:3000/app/admin` → Map requests.

**Check:** the area/place is covered by our bus data (GTFS region), the stops are real, and — if it's a "RED band" complex request — that it's actually buildable.

**Decide, in the browser:** Approve (it becomes a **`build`** item — see below) or Reject (frees up their quota slot).

---

## 4. `build` — an approved request with no map yet

This is the one with real terminal steps. Let `bus-work` walk you through it, or do it by hand:

**Step 1 — make the map** (on the laptop, live data + judgement, same either way):
```powershell
# area (a town):
# run the make-bus-leaflet skill for the subject town
# place (a shop/school/station/point):
# run the make-place-bus-leaflet skill for the subject
```
Ask Claude: *"build the map for `<request>`"* — it runs S1→S6 and hands you a dated **S5-render** folder plus a verification `.docx`. Keep that `.docx`.

**Step 2 — deliver to the live portal.** One laptop command, `ssh`-based (from `C:\Claude\community-bus-maps`):
```powershell
npm run deliver -- --src "<the S5-render dir>" --name "<Town/Place name>" --slug <slug> --kind area --request <id>
# place map instead: --kind place
```
It `scp`'s the render up, **pre-flight verifies it in a throwaway container on the host before touching the running service** (SVG only, never JPG — laptop/host font differences make a JPG check a permanent false alarm, see `GO-LIVE.md` §2.5), only then stops the live service, imports, restarts, and checks `/health?deep=1`. A failure at verify leaves the live site completely untouched. A failure at import leaves it **stopped** rather than serving a half-write — restart it by hand on the host (`docker compose up -d portal`) once you understand why, don't just retry blind.
*(This path is written and dry-run tested. Whether it has been proven end to end against a real request is recorded in ONE place — the "what actually works against the live portal" bullet near the foot of this page — so that the two cannot disagree. They did: this note was dated 10 Aug and that bullet 18 Aug, saying the same thing with eight days between them and nobody obliged to update both.)*

▸ **Testing locally instead?** Skip `npm run deliver`. Stop the dev server, then:
```powershell
node scripts/import-map.mjs --request <id> --src "<the S5-render dir>"
$env:FIXTURE_DIR = "<the S5-render dir>"; npm run verify:area
# place map instead:
$env:PLACE_FIXTURE_DIR = "<the S5-render dir>"; npm run verify:place
```
Must print **PASS** with byte counts. If it doesn't, stop — don't hand over a map that didn't verify.

**Step 3 — hand over, in the browser:** open `https://busmaps.uk/app/maps/<id>` as admin, confirm the outputs (v1.0 defaults to internal-geographic + external; the tube-map diagram is request-only, see H1 §4b). The map is a **draft** until it goes through the `review` step above.
▸ **Testing locally instead?** `http://localhost:3000/app/maps/<id>`.

---

## 5. `refresh` — a live map's bus data has changed (BODS)

**Step 1 — regenerate** (laptop, same either way): re-run the same skill (`make-bus-leaflet` / `make-place-bus-leaflet`) for that town/place, producing a fresh S5-render folder.

**Step 2 — deliver it to the live portal.** One laptop command, `ssh`-based, the same script a new-map build uses (§4) — run it from `C:\Claude\community-bus-maps`:
```powershell
npm run deliver -- --src "<the fresh S5-render dir>" --map <slug> --kind area --note "BODS <date> refresh"
# place map instead: --kind place
```
`--src` is the dated S5-render folder the skill just produced (a Windows absolute path with spaces in it is fine — `scp` handles the drive letter). `--map` is the live map's slug or numeric id, e.g. `st-ives`; **passing `--map` instead of `--name`/`--slug` is what makes this a refresh rather than a new import**. `--kind` is `area` or `place` and only picks which pre-flight gate runs (`verify:area` vs `verify:place`). `--note` is the free-text "what this refresh is" that the customer sees on the proposal.

It `scp`'s the render up, pre-flight verifies it byte-identically in a throwaway container **before the running service is touched**, then runs `propose-update.mjs` against it and prints the plain-language diff (routes added/removed, stops, operators, validity dates) — read that before moving on. It never advances the live-serving version: all it does is stage a proposal for the customer.

*(Proven end to end on 18 Aug 2026 — all 13 sample maps were refreshed this way from the laptop in one pass. Expect two side effects per call: the portal is briefly stopped and restarted, and the customer is emailed an "update is ready" notification.)*

▸ **Testing locally instead?** Skip `npm run deliver`, stop the dev server, and run the proposer straight against the local checkout (from `C:\Claude\community-bus-maps`):
```powershell
node scripts/propose-update.mjs --map <slug> --src "<the fresh S5-render dir>" --note "BODS <date> refresh"
```

**Step 3 — that's it for you.** It's now the customer's move: they accept (re-applies their recolours/POI toggles onto the new data as a new draft, which then needs a `review`) or decline. It shows up as `awaiting-customer` until they do. Accepting is **browser work** — there is no script for it, and a map with any open publish request refuses the accept with a 409 until that request is withdrawn.

---

## 6. `refresh-local` — a town leaflet with no portal map yet

Laptop-only, no import step, and no live/local distinction — this row never talks to any portal, whether or not busmaps.uk is up:
```powershell
# re-run S1-S5 for the town via make-bus-leaflet, then:
node "%SK%\refresh_latest.js"
```
(`SK` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`.) Commit the change in the Buses repo, noting the version bump.

---

## 7. `housekeeping` — engine updated but old maps weren't rebuilt

**Engine-stale renders** (a shipped map was made with an older version of the drawing engine). This is laptop/Buses-repo work — it rebuilds source images, it does not touch the portal:
```powershell
node rollout.js --all          # dry run first — always look at this
node rollout.js --all --apply  # writes: one commit per town, minor version bump
# or just one town:
node rollout.js --town "St Ives" --apply
```
Stops itself if a label/POI would be lost in the process — read the message if it does. If a town this rebuilds is already live on busmaps.uk, the portal doesn't see the rebuild automatically — that still needs a `refresh` (§5) to reach it.

**Missing/stale S6 verification:** run S6 for the town via `make-bus-leaflet`, one town at a time. Findings are either **HARD** (blocks — needs your judgement call) or **SOFT** (logged, no action needed).

---

## 8. `awaiting-customer` — staged, ball's in their court

Nothing to do if it's recent. If it's been **2+ weeks**: send a nudge email naming the map and what changed, and note that you nudged them (so it doesn't nag you again next week).

---

## 9. `gate` — 🔴 always top of the list, always first

Something the byte-identical check used to pass now fails. This is a laptop-only proof — it always regenerates from the local engine and compares against what's committed, regardless of whether busmaps.uk is up. Reproduce it:
```powershell
node "%SK%\status.js"
```
- If a **town** fails: either it's an *intended* engine change (fix it via `housekeeping` → `rollout.js` above) or a genuine regression (fix the generator, don't ship until it's clean).
- If the **portal vendoring row** fails: re-vendor the changed file into `community-bus-maps/engine/`, then:
```powershell
npm test
npm run verify
```
Must show **PASS** with byte counts before you touch anything else. This is exactly the check `npm run deliver`'s pre-flight step reuses before anything reaches the live site, so a clean local gate here is what keeps that step honest. **Never relax a gate to make it pass** — that's the one rule that overrides convenience.

---

## Closing out

After each item: re-run `bus-work` (or `worklist.mjs`) and confirm the row is gone. Occasionally — or whenever you've just fixed a `gate`/`housekeeping` item — push the result to the live portal so it shows up there too:
```powershell
node "%BW%\push-status.mjs" --url https://busmaps.uk --token <STATUS_TOKEN>
```
▸ **Testing locally instead?** Drop `--url`/`--token` — it writes to the local checkout's own `status-snapshot.json` file instead of POSTing anywhere:
```powershell
node "%BW%\push-status.mjs"
```

## Rules that always apply, whichever type you're doing

- **Never decide a `review` / `application` / `request-decision` from the terminal.** Those are yours to click in the browser — bus-work will summarise, never decide, for you.
- **Never hand-edit a rendered file.** Regenerate instead.
- **Stop the dev server** before any command that writes directly to a **local** checkout (`import-map.mjs`, `propose-update.mjs` run locally, `rollout.js --apply`, `seed-demo.mjs`) — one SQLite writer. `npm run deliver` (live map builds §4, live refreshes §5) handles its own stop/start on the host for you; you don't do this by hand for either path.
- **PowerShell `$env:VAR = ...` form only** for the verify commands — the bash `VAR=x npm run …` form silently no-ops on this machine.
- **What actually works against the live portal from this laptop — last checked 28 Aug 2026, and this bullet is the SINGLE record of it:** reading (`worklist.mjs` / `push-status.mjs` with `--url`) — yes. Delivering a **refresh** to an already-live map (`npm run deliver -- --map <slug>`, §5) — yes, proven end to end on 18 Aug 2026 across all 13 sample maps. Delivering a **brand-new** map (`npm run deliver -- --name … --slug …`, §4) — yes, but **still not proven end to end against a real request**, so watch its output. Re-checked 28 Aug 2026 and nothing had settled it either way, which is the point of dating it: an unproven path quietly becomes a proven-looking one the longer the sentence sits unchanged. **What would settle it:** one delivery of a new map against a real approved request, with `maprequest.fulfil` in the audit log and the map live. Update this bullet the day that happens, and nothing else. What has **no** laptop path at all is the operator half of the cycle: accepting a proposed update, withdrawing a publish request and changing a map's outputs are HTTP endpoints needing a signed-in admin session, so they are browser work rather than terminal work. If a command's actual target is ever in doubt, check the `LOCAL —` / `REMOTE —` banner both scripts print first, before reading anything else in their output.

## If you want the why, not just the how

This page is deliberately just the steps. Background and reasoning live in:
- [H1 — Operations Handbook](H1-operations-handbook.md) — the full picture, roles, vocabulary
- [GO-LIVE.md](_archive/GO-LIVE.md) — historic go-live record: why the laptop/host split exists, what `npm run deliver` does step by step, and what wasn't yet built at the time (§2.1 Phase 2 — a refresh delivery path)
- [R1](R1-create-map.md) / [R2](R2-onboarding.md) / [R3](R3-review-and-publish.md) / [R4](R4-update-cycle.md) — the detailed runbooks each section above is a shortcut for
- `C:\u3a St Ives\.claude\skills\bus-work\references\playbooks.md` — the same procedures, written for Claude to follow
