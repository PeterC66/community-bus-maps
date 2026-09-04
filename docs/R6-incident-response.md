# Runbook R6 — Incident response

<!-- docstamp v1.5 | 2026-09-04 | sha=04fb0b45 -->
**v1.5** · updated 4 September 2026

**Serves:** managing updates (and keeping the service safe) · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.1`

**Purpose.** What to do when something goes wrong — above all a **published map that's wrong in the wild**, because people act on it. Record every incident in the private incident log, `P3-incident-log.md` in the ops folder (`C:\Claude\community-bus-maps-ops\`).

> **Pilot — and this runbook is now live.** It is still true that there are no *customer* maps: every organisation is one of ours, every rendered sheet carries the `PILOT — SAMPLE MAP` band ([`src/render/pilotStamp.js`](../src/render/pilotStamp.js)), and the pilot banner is on every page. **What is no longer true is that nobody acts on them.** On 2026-08-28 a member of the public in Ramsey read the published external map, found that it showed a place the X31 does not serve and omitted three that it does, and took the trouble to report all of it accurately through *report a problem*. Every claim held. The map was unlisted the same day. So treat the severities below as calibrated for **now**, not for after the pilot ends.
>
> Two things that paragraph used to say are worth keeping as corrections, because both were load-bearing and both had quietly expired. **`robots.txt` is no longer `Disallow: /`** — the site has been indexable since 2026-08-21 and publishes a sitemap, so a wrong sheet is reachable from a search engine and not only from someone we told. And **the `SAMPLE MAP` band is on the rendered sheet only**: the `/services` text page, which exists as the accessible alternative to the sheet, presents the same service data with the pilot banner but no sample marking on the content itself. A reader who prefers text gets the weaker warning. See [`PILOT.md`](PILOT.md).

## Severity

- **High** — wrong public transit info people may act on, or a data/privacy breach. **Act now.**
- **Medium** — service degraded (sign-in down, a source stale).
- **Low** — cosmetic / single user.

## A published map is wrong (the big one)

The published bytes are the promise, so act on **visibility**, not the file.

1. **Take it down fast.** As admin, **unlist** the map (the public listing toggle) → it leaves `/maps` and `/m/<slug>` immediately, deleting nothing. For a whole-customer problem, **suspend the customer** — that pulls *all* their maps (the public front requires an *active* customer).
2. **Fix.** If an earlier published version was correct, **revert to it** (below — one click). If none was, push a **corrected version** through review (**R3**).
3. **Re-list** once the correct version is published.
4. **Record** it in the incident log and tell the publishing organisation. **While every map is ours, that step is us** — there is no third party to hand it to, and the temptation is to treat the fix as the whole response and skip the record. The Ramsey report on 2026-08-28 is the worked example: the incident row, not the commit, is what tells a later session why the map is unlisted.

> **Unlisting is the fast mitigation; a correct sheet being served is the fix.** Never hand-edit a served file — always go through a version.

### Revert to the previous published version

As **approver or admin**: **`/app/review` → "Published maps"** → pick the map → its **publication history** (every version ever reviewed, newest first, each with its approver, note and print files) → **Revert to this**. A **reason is required**; it goes in the audit trail (`version.revert`) — paste the same line into the incident log.

What it does and does not do:

- It moves only the **public-current pointer**. Nothing is re-rendered, and the customer's working version is untouched — they can carry on preparing the correction.
- The only versions on offer are ones that **already passed the publish gate** and whose rendered files are still on disk. A revert can never serve bytes nobody reviewed. (If the files have been pruned, it says so and you must publish a correction instead.)
- The version you reverted **away from** stays in the history, so you can roll forward again once it is fixed, or revert again.
- Reverting does **not** re-list an unlisted map. If you unlisted it in step 1, re-list it in step 3.
- If a version is awaiting review, decide that request first — the revert refuses while one is open, so an approver is never reviewing against a pointer that moves under them.

## Sign-in / access failure

- Sign-in is a **magic link**: **dev** prints it to the server console; **production** needs `EMAIL_PROVIDER` set ([DEPLOY.md §2](DEPLOY.md)). If users can't get links, check that config and the mail provider first.
- Sessions purge hourly; a stuck session clears itself. As **admin** you can still act while investigating.

## Health / readiness failure

- `/health?deep=1` returning **503** means the DB, disk, the engine files, or sharp failed ([DEPLOY.md §4](DEPLOY.md)). Follow the **restore drill** ([§5](DEPLOY.md)) if it's data; check the **sharp/libvips pin** ([§7](DEPLOY.md)) if it's rendering.

## Byte-parity break after a deploy

- If `npm run verify` fails after an upgrade, the bytes served may differ from what an approver reviewed — **roll the deploy back** / re-pin `sharp` and re-verify before serving ([DEPLOY.md §7](DEPLOY.md)). Treat it as **high** even if nothing looks visibly wrong: it breaks "the file we serve is the file that was approved."

## Data-source outage (BODS / OSM / bustimes)

- These are **central-pipeline only**. Already-built, published maps keep serving (the portal makes no external calls). The monthly refresh (**R4**) may slip — no public impact; note it and catch up.

## Suspected personal-data exposure

- Treat as **high**. The public site is built to carry no personal data (branding has no contact fields). If something slipped through: unlist/suspend to contain, fix, record, and consider the notification duties in the privacy notice (`legal.html` / the `ops/` privacy-review note).

## After any incident

- One line in the private **incident log** (P3): what, severity, affected map/customer, how detected, action taken, resolution, follow-up.
- **Update whatever runbook** should have prevented or handled it — the durability rule.
