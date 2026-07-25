# Runbook R6 — Incident response

**Serves:** managing updates (and keeping the service safe) · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** What to do when something goes wrong — above all a **published map that's wrong in the
wild**, because people act on it. Record every incident in the private
[incident log](../../community-bus-maps-ops/incident-log.md) (P3).

## Severity

- **High** — wrong public transit info people may act on, or a data/privacy breach. **Act now.**
- **Medium** — service degraded (sign-in down, a source stale).
- **Low** — cosmetic / single user.

## A published map is wrong (the big one)

The published bytes are the promise, so act on **visibility**, not the file.

1. **Take it down fast.** As admin, **unlist** the map (the public listing toggle) → it leaves `/maps`
   and `/m/<slug>` immediately, deleting nothing. For a whole-customer problem, **suspend the
   customer** — that pulls *all* their maps (the public front requires an *active* customer).
2. **Fix.** Push a **corrected version** through sign-off (**R3**); or, if an earlier published version
   was correct, re-publish that known-good version through the gate.
3. **Re-list** once the correct version is published.
4. **Record** it in the incident log and tell the publishing organisation.

> **Rough edge:** there's no one-click "revert to the previous published version" — you re-publish
> through the gate (`setMapPublished` exists in the DB layer but has no admin button). **Unlisting is
> the fast mitigation; re-publishing is the fix.** Never hand-edit a served file — always go through a
> version.

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
