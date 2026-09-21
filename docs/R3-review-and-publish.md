# Runbook R3 — Review & publish (approver review)

<!-- docstamp v1.8 | 2026-08-29 | sha=31979583 -->
**v1.8** · updated 29 August 2026

**Serves:** managing updates · **Owner:** operator (as approver) · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** How a version becomes the **official public map** — the judgement layer over the P4 mechanics. This is the **third approval gate** (publish), and the one that matters most: people rely on the result.

> **The plain-English counterpart.** R1, this runbook and R4 are also told as one continuous story for the operator — *ask for a map → it gets built → it goes in → you review it → it goes live → a month later it needs refreshing* — in `C:\u3a St Ives\Using AI\Buses\Documentation\README - How to publish a map to the portal.md` (the Buses repo). That guide is deliberately command-free and defers to these three on anything technical; **if you change a step here, check whether it changed the story there.** The review checklist in particular is restated there in plain English, so the two go stale together — [Step 3](#step-3--complete-the-review-checklist) is the authority.

> **Pilot.** Every sheet you publish carries a red **PILOT — SAMPLE MAP** band across the top while `PILOT_MODE` is on. That is correct for our own demo maps. **The wording is wrong for a real customer's map** ("Not published by any organisation") — before signing off the first genuine customer map, decide whether the pilot ends, or the band's wording changes for real maps. Both are one edit in `src/config.js`; see [`PILOT.md`](PILOT.md). Note also that a version renders its band at render time, so a version rendered before the pilot landed publishes **unstamped**. `node scripts/restamp-renders.mjs` (dry run first) tells you.

## The rule — separation of duties

The **editor** who makes a change **submits** it; a platform **approver** (or admin) **publishes** it. Even when you are both, act in the right seat — submit as the editor, then switch to the approver view. The audit depends on it. Approvers can **read/inspect any** map but **never edit** one.

**Enforced since 2026-08-20, and honestly bounded.** The server compares the request's submitter to the approver and returns `409 self-approval` when they are the same person. That check had never existed: this document, the README and `src/publish/index.js` all described the control, and the code checked the role, the request's status and the checklist, and never once compared the two user ids — so all 41 publications up to that date were self-approved (`technical-audit_2026-08-19` S6). A one-operator deployment sets `ALLOW_SELF_APPROVAL=1` to keep working, and then **every self-approval is stamped `selfApproved: true`** in the stored evidence, the audit row and the API response. The review screen says so before you tick anything. Unset the override the day a second person holds `approver`; the point of the flag is that the trail can tell the two eras apart.

**Publishing needs a fresh sign-in.** Whatever your session's age, approving needs a sign-in from the **last 30 minutes** — a stale cookie cannot make a map public. A refusal comes back as `403 step-up-required`; sign out, follow a new sign-in link, and the review is exactly where you left it. Note for scripted work: `scripts/accept-publish-batch.mjs` runs against a session you mint for the task, which is fresh by construction — see the mint-and-revoke note in the operations handbook.

## Step 1 — Editor submits (freezes the head)

In `/app/maps/:id` → **Publish** panel, the editor hits **Send ‹version› for review** — the button carries the version, so it reads *Send v11.0 for review*. The map's guidance card offers the same action as **Send for review →**. Editing then **freezes** (save → 409) so the submitted version can't move under review. **Withdraw and edit** returns it to draft.

**Quote that label, not a paraphrase.** This document said **Submit for publication** until 2026-08-29, a string that has never existed anywhere in the app, and it was read back to an operator as an instruction — who then had to work out for himself that the **Send … for review** button was the one meant. The app is consistent about this in five places (the button, the guidance card action, the progress-strip step *Sent for review*, the audit entry *Sent version for review*, and the accept confirmation, which points at the button by name); only the documentation ever had a second name for it.

## Step 2 — Approver opens the review

As approver/admin, open **`/app/review`** (the queue). Each submission gives you:

- **The change summary** — a deterministic diff of *this version vs the currently-published one* (or the baseline, if nothing is published yet). Because the safe subset only permits **route recolours**
  + **POI show/hide**, this diff is **complete** — nothing else can have moved. It lists: routes whose colour changed (from → to), POIs newly hidden, and POIs newly shown.
- **The print files** — inspect the full-size JPGs inline.

## Step 3 — Complete the review checklist

All three are **required** and **server-enforced** — you cannot publish with any unticked (v5 of the checklist, consolidated from an earlier six-item version that had become a rubber-stamp exercise):

1. **appearance** — at a glance, the services shown, route colours, and points of interest look right on every sheet: no obviously wrong route numbers or destinations, colours stay distinct and colour-blind friendly, nothing obvious is missing.
2. **legible** — you have **viewed the full-size prints (JPG)** and all text is legible.
3. **alternative** — you have opened the map's **services and stops list** (its text alternative, `/m/<slug>/services`), it matches the map, and the map page works from the keyboard. Arrived with P8a, when published maps got a public page worth reading online — see [`ACCESSIBILITY.md`](ACCESSIBILITY.md#before-publishing-a-map-part-of-the-sign-off).

This is a reasonableness check, not a re-derivation of the routes from source data — we don't routinely re-verify services or timings against BODS/operator timetables at this step, and the screen says so beside the checklist rather than asking you to tick it. It still isn't box-ticking: item 2 means **actually opening the JPG**, not trusting the on-screen preview, and anything that looks off should be sent back rather than waved through.

## Step 4 — Decide

- **Publish** → sets the map's **public-current** version (`published_version_id`), retires the previously-published one to `superseded`, and moves the map to `published`. **Publishing never re-renders** — the approved bytes are exactly what gets served, so the byte-identical guarantee is untouched.
- **Send back** → a **reason is required**; the version → `rejected` and editing unlocks so the editor can fix and resubmit.

Both outcomes land in the append-only **audit log** (admin → **Audit**) with who/what/when plus the evidence (the change summary + your completed checklist).

## Two pointers — don't confuse them

- `current_version_id` = the **working head** (moves on every editor save).
- `published_version_id` = the **public-current** official version (moves **only** here, on review).

The public site serves the **published** pointer; edits in flight never reach the public until reviewed.

## What-if

- **Checklist won't submit** → an item is unticked (the server rejects an incomplete checklist; the UI disables **Publish** until 3/3).
- **You published something wrong** → that's an **incident** — [**R6**](R6-incident-response.md): roll the public-current pointer back to a known-good version, or push a corrected version through this gate. **Never** edit a served file in place.
- **Empty queue** → submissions appear only after an editor submits; nothing to do.
