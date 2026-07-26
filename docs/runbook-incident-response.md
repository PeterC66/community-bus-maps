# Runbook R6 — Incident response

**Serves:** managing updates (and keeping the service safe) · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.1`

**Purpose.** What to do when something goes wrong — above all a **published map that's wrong in the
wild**, because people act on it. Record every incident in the private
[incident log](../../community-bus-maps-ops/incident-log.md) (P3).

> **Pilot.** There are **no real published maps** — everything public is our own demo data, labelled
> **Sample**, behind a pilot banner and a `robots.txt` `Disallow: /`. So "a member of the public acted
> on a wrong map" is currently a *hypothetical*, and the severities below are calibrated for the world
> after the pilot ends. Keep the procedures; scale the urgency to reality. The first genuine customer
> map is the point at which this runbook becomes live — see [`PILOT.md`](PILOT.md).

## Severity

- **High** — wrong public transit info people may act on, or a data/privacy breach. **Act now.**
- **Medium** — service degraded (sign-in down, a source stale).
- **Low** — cosmetic / single user.

## A published map is wrong (the big one)

The published bytes are the promise, so act on **visibility**, not the file.

1. **Take it down fast.** As admin, **unlist** the map (the public listing toggle) → it leaves `/maps`
   and `/m/<slug>` immediately, deleting nothing. For a whole-customer problem, **suspend the
   customer** — that pulls *all* their maps (the public front requires an *active* customer).
2. **Fix.** If an earlier published version was correct, **revert to it** (below — one click). If none
   was, push a **corrected version** through sign-off (**R3**).
3. **Re-list** once the correct version is published.
4. **Record** it in the incident log and tell the publishing organisation.

> **Unlisting is the fast mitigation; a correct sheet being served is the fix.** Never hand-edit a
> served file — always go through a version.

### Revert to the previous published version

As **approver or admin**: **`/app/review` → "Published maps"** → pick the map → its **publication
history** (every version ever signed off, newest first, each with its approver, note and print files)
→ **Revert to this**. A **reason is required**; it goes in the audit trail (`version.revert`) — paste
the same line into the incident log.

What it does and does not do:

- It moves only the **public-current pointer**. Nothing is re-rendered, and the customer's working
  version is untouched — they can carry on preparing the correction.
- The only versions on offer are ones that **already passed the publish gate** and whose rendered
  files are still on disk. A revert can never serve bytes nobody signed off. (If the files have been
  pruned, it says so and you must publish a correction instead.)
- The version you reverted **away from** stays in the history, so you can roll forward again once it
  is fixed, or revert again.
- Reverting does **not** re-list an unlisted map. If you unlisted it in step 1, re-list it in step 3.
- If a version is awaiting sign-off, decide that request first — the revert refuses while one is open,
  so an approver is never reviewing against a pointer that moves under them.

## Sign-in / access failure

- Sign-in is a **magic link**: **dev** prints it to the server console; **production** needs
  `EMAIL_PROVIDER` set ([DEPLOY.md §2](DEPLOY.md)). If users can't get links, check that config and the
  mail provider first.
- Sessions purge hourly; a stuck session clears itself. As **admin** you can still act while
  investigating.

## Health / readiness failure

- `/health?deep=1` returning **503** means the DB, disk, the engine files, or sharp failed
  ([DEPLOY.md §4](DEPLOY.md)). Follow the **restore drill** ([§5](DEPLOY.md)) if it's data; check the
  **sharp/libvips pin** ([§7](DEPLOY.md)) if it's rendering.

## Byte-parity break after a deploy

- If `npm run verify` fails after an upgrade, the bytes served may differ from what an approver signed
  off — **roll the deploy back** / re-pin `sharp` and re-verify before serving ([DEPLOY.md §7](DEPLOY.md)).
  Treat it as **high** even if nothing looks visibly wrong: it breaks "the file we serve is the file
  that was approved."

## Data-source outage (BODS / OSM / bustimes)

- These are **central-pipeline only**. Already-built, published maps keep serving (the portal makes no
  external calls). The monthly refresh (**R4**) may slip — no public impact; note it and catch up.

## Suspected personal-data exposure

- Treat as **high**. The public site is built to carry no personal data (branding has no contact
  fields). If something slipped through: unlist/suspend to contain, fix, record, and consider the
  notification duties in the privacy notice (`legal.html` / the `ops/` privacy-review note).

## After any incident

- One line in the private **incident log** (P3): what, severity, affected map/customer, how detected,
  action taken, resolution, follow-up.
- **Update whatever runbook** should have prevented or handled it — the durability rule.
