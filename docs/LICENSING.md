# Licensing & attribution review (launch gate)

<!-- docstamp v1.5 | 2026-08-09 | sha=7ff96dc4 -->
**v1.5** · updated 9 August 2026

This is the launch go/no-go the planning documents named: the maps are built from other people's data, published to the public, and printed by third parties, so the obligations have to be written down and **reviewed before the public site is announced** — not discovered afterwards.

> **Pilot.** The scope this assessment covers is deliberately small — a few towns, monthly, expert-run, no customers, not indexed by search engines (`robots.txt` `Disallow: /` while `PILOT_MODE` is on). **Ending the pilot widens the scope**, so the review below should be revisited at the same time, not inherited. See [`PILOT.md`](PILOT.md).

`NOTICE` carries the short attribution statement; this file is the working detail and the review record.

---

## 1. What the maps are made from

| Source | Used for | Licence | What it obliges us to do |
|---|---|---|---|
| **OpenStreetMap** | streets, rivers, points of interest, the road skeleton behind every internal map | **ODbL 1.0** (© OpenStreetMap contributors) | Credit OSM contributors visibly on anything we publish; the produced maps are a *Produced Work*, so the credit is the main obligation. If we ever publish a **derived database** (e.g. exported geometry), it must be offered under the ODbL too. |
| **UK Bus Open Data Service (BODS)** | routes, stops, operators, days of operation, validity dates | **Open Government Licence v3.0** | Attribute the source. No share-alike. |
| **bustimes.org** | cross-checking a route against an operator's own timetable during central map-making | **confirmed acceptable, no attribution required** (resolved 2026-08-07) | See §3. Central, low-volume, human-in-the-loop use only. |
| **sharp / libvips, Fastify, Node.js** | the software stack | Apache-2.0 / MIT-family | Preserve their notices (bundled in `node_modules`, not redistributed by us). |
| **This portal's code** | — | **Business Source License 1.1** (`LICENSE`) | Non-commercial/internal use is free; competing commercial use needs a separate licence from the Licensor until the Change Date (2030-08-09), after which it converts to Apache-2.0. Keep `LICENSE` + `NOTICE` with any redistribution. |

## 2. Where the credits actually appear

A licence obligation is only met if a reader sees it. Today:

- **On every printed sheet** — the map generator prints the OSM + BODS attribution and a "check live times" line onto the sheet itself, so a photocopy on a noticeboard still carries it. *This is the load-bearing one: it survives being detached from the website.*
- **On every public page** — the footer of the shopfront, `/maps`, `/m/<slug>`, `/o/<slug>` (P6) repeats the same statement.
- **`/legal.html`** — the fuller explanation of the sources, plus how the sheets may be reused.
- **`NOTICE`** — for anyone redistributing the software.

**Check before launch:** print one A4 sheet of each of the four outputs (geographic, schematic, diagram, external) and confirm the attribution is legible on paper, not just on screen. The two expert styles arrived in P7 and re-run the same generator, so they inherit the credit line — but "inherits" is a claim to verify with a printout, once.

## 3. bustimes.org — resolved (2026-08-07)

Cross-checking against bustimes.org is part of *central* map-making (the expert tier), not something a customer's browser or the portal server does. The volume is a handful of pages per town per month, read by a person or with a person reviewing the result.

The site owner, Josh Goodwin, was written to directly describing this use (per-town, roughly monthly, a handful of pages, human-reviewed, not from any website users) and asked (a) whether the use is acceptable and (b) what attribution wording, if any, was wanted. His reply, received 7 August 2026:

> "That sounds very acceptable to me; I have no attribution requirements."

**Outcome:**

- Our use of bustimes.org (central, human-in-the-loop, a handful of pages per town per month, to sanity-check a route already built from BODS, and to fill gaps BODS doesn't cover) is **confirmed acceptable** by the site owner.
- **No attribution to bustimes.org is required** on printed sheets, public pages, `NOTICE`, or anywhere else. The footer/legal-page mentions of bustimes.org as a place to check live times are a courtesy link, not a data credit, and may stay or go at the operator's discretion.
- The correspondence is kept at `bustimes.org OK our use.txt` (outside this repo, operator's local files) as the record of consent.

This closes the item that was previously an open launch-gate question. Widening the scope beyond the pilot (any UK town, automated/bulk use) was not what was described or approved, and would be worth a fresh note to the site owner if it happens.

### Findings (2026-07-25, superseded by the direct reply above)

A read of bustimes.org's own `/data` page recorded: its timetable/route data is drawn from NPTG, NaPTAN, NOC, TNDS, BODS and TfL and is licensed under the Open Government Licence v3.0; it publishes an API for structured access; and the page stated no explicit restriction on reusing or cross-referencing what it shows. This research is superseded by the direct confirmation above but is kept here as background.

## 4. Other launch-gate items

- **Privacy notice** — `/legal.html` is written but marked a working draft; confirm the wording and add a "last reviewed" date (P6 follow-up).
- **No personal data on public pages** — verified by construction in P6 (an organisation's branding carries no contact details); re-check if branding ever gains new fields.
- **Print-safety wording** — every public page and sheet says to confirm live times with the operator. Keep it: it is the honest limit of a printed map, and it is what makes "the map is a guide" defensible.
- **Sheet branding** — a customer's logo/colours are deliberately *not* printed on the sheet (P6/P7 decision). If that changes, re-check that a customer cannot imply an endorsement by an operator or a council they don't represent.

## 5. Review

Progress recorded 2026-07-25. The **web-attribution** rows were verified by Claude: the OSM + BODS credit string is present in the footer of **every** public page (all 9 templates — shopfront, `/maps`, `/m/`, `/o/`, `legal`, `faq`, `examples`, `apply`, `contact`). The **printed-sheet** checks and the **final launch go/no-go** remain the operator's — a screen credit is not a paper credit, and this is a legal gate, not a code test.

| Item | Status | Verified by | Date |
|---|---|---|---|
| OSM (ODbL) credit — on **web** | ✅ present on all public pages | Claude | 2026-07-25 |
| BODS (OGL) credit — on **web** | ✅ present on all public pages | Claude | 2026-07-25 |
| OSM + BODS credit — on the **printed sheet** | ☐ check on paper (operator) — see §2 | | |
| Printed-sheet credit **legibility**, all four outputs | ☐ check on paper (operator) | | |
| bustimes.org terms | ✅ **resolved** — site owner confirmed use acceptable, no attribution required (§3) | operator (Josh Goodwin, bustimes.org) | 2026-08-07 |
| Privacy notice reviewed + dated | ✅ reviewed against the system (`legal.html`, dated); confirm for launch (operator) | Claude | 2026-07-25 |
| CSRF tokens on state-changing POSTs | **Accepted risk for the pilot** — deferred, not fixed. `SameSite=Lax` already blocks cross-site POST from another origin; the residual risk is a same-site/XSS-chained attack, judged low for a handful of known pilot users. Revisit before opening self-serve signup to the public (`ROADMAP.md` follow-up). | GO-LIVE.md §3 | 2026-08-09 |

**To close the paper checks:** print one A4 of each of the four outputs (geographic, schematic, diagram, external) from a reviewed map and confirm the OSM + BODS + "check live times" line is present and legible on paper. Then tick the two sheet rows with your initials + date.

Nothing here is legal advice; it is the operator's checklist. Record the outcome in this file (it is versioned) so the decision and its date survive.
