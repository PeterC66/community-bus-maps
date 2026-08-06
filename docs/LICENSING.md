# Licensing & attribution sign-off (launch gate)

<!-- docstamp v1.0 | 2026-07-27 | sha=9e948b44 -->
**v1.0** · updated 27 July 2026

This is the launch go/no-go the planning documents named: the maps are built from other people's data, published to the public, and printed by third parties, so the obligations have to be written down and **signed off before the public site is announced** — not discovered afterwards.

> **Pilot.** The scope this assessment covers is deliberately small — a few towns, monthly, expert-run, no customers, not indexed by search engines (`robots.txt` `Disallow: /` while `PILOT_MODE` is on). **Ending the pilot widens the scope**, so the sign-off below should be revisited at the same time, not inherited. See [`PILOT.md`](PILOT.md).

`NOTICE` carries the short attribution statement; this file is the working detail and the sign-off record.

---

## 1. What the maps are made from

| Source | Used for | Licence | What it obliges us to do |
|---|---|---|---|
| **OpenStreetMap** | streets, rivers, points of interest, the road skeleton behind every internal map | **ODbL 1.0** (© OpenStreetMap contributors) | Credit OSM contributors visibly on anything we publish; the produced maps are a *Produced Work*, so the credit is the main obligation. If we ever publish a **derived database** (e.g. exported geometry), it must be offered under the ODbL too. |
| **UK Bus Open Data Service (BODS)** | routes, stops, operators, days of operation, validity dates | **Open Government Licence v3.0** | Attribute the source. No share-alike. |
| **bustimes.org** | cross-checking a route against an operator's own timetable during central map-making | **site terms — OPEN QUESTION** | See §3. Central, low-volume, human-in-the-loop use only. |
| **sharp / libvips, Fastify, Node.js** | the software stack | Apache-2.0 / MIT-family | Preserve their notices (bundled in `node_modules`, not redistributed by us). |
| **This portal's code** | — | **Apache-2.0** (`LICENSE`) | Keep `LICENSE` + `NOTICE` with any redistribution. |

## 2. Where the credits actually appear

A licence obligation is only met if a reader sees it. Today:

- **On every printed sheet** — the map generator prints the OSM + BODS attribution and a "check live times" line onto the sheet itself, so a photocopy on a noticeboard still carries it. *This is the load-bearing one: it survives being detached from the website.*
- **On every public page** — the footer of the shopfront, `/maps`, `/m/<slug>`, `/o/<slug>` (P6) repeats the same statement.
- **`/legal.html`** — the fuller explanation of the sources, plus how the sheets may be reused.
- **`NOTICE`** — for anyone redistributing the software.

**Check before launch:** print one A4 sheet of each of the four outputs (geographic, schematic, diagram, external) and confirm the attribution is legible on paper, not just on screen. The two expert styles arrived in P7 and re-run the same generator, so they inherit the credit line — but "inherits" is a claim to verify with a printout, once.

## 3. The open question: bustimes.org

Cross-checking against bustimes.org is part of *central* map-making (the expert tier), not something a customer's browser or the portal server does. The volume is a handful of pages per town per month, read by a person or with a person reviewing the result.

That is very likely fine, and it is deliberately **not** scaled into the self-serve tier — but it has never been confirmed against the site's terms. Before launch, either:

1. read the current terms and record the conclusion below, or
2. write to the site owner describing the use (per-town, monthly, human-reviewed, credited) and record the reply, or
3. drop the dependency: the same check can be made against operator timetables and the BODS feed alone (slower, and it loses a genuinely useful sanity check).

Until one of those is recorded, treat "any UK town, automated" as **out of scope** — the present scale (a few towns, monthly, expert-run) is what the assessment covers.

### Findings (2026-07-25)

A read of bustimes.org's own `/data` page records:

- Its timetable/route data is drawn from **NPTG, NaPTAN, NOC, TNDS, BODS and TfL** and is **"licensed under the Open Government Licence v3.0"** — i.e. the facts we cross-check are the same open data we already use directly, not a proprietary dataset.
- It publishes an **API** for structured access — programmatic reuse is an intended path.
- The page states **no explicit restriction** on reusing or cross-referencing what it shows.

This *supports* the assessment that our use (central, human-in-the-loop, a handful of pages per town per month, to sanity-check a route already built from BODS) is proportionate and low-risk. It does **not** by itself formally close the question — there is no published terms-of-use granting or denying HTML-page reuse — so the go/no-go is still a judgement for the operator to **record**. Pick one and sign §5:

- **Accept at current scale** — record this finding as sufficient for the few-towns, monthly, expert-run use, and keep automated any-UK-town use out of scope.
- **Ask** — send the courtesy enquiry below to `bustimes.org/contact` and record the reply.
- **Drop** — cross-check against operator timetables + the BODS feed alone.

**Draft enquiry (the "Ask" option):**

> Subject: Cross-checking a route against your site — community bus maps Hello — I run a small non-commercial project that makes printable bus maps for local organisations (community-bus-maps, Apache-2.0). The maps are built from BODS and OpenStreetMap; during map-making I sometimes open a few of your pages by hand to sanity-check a route against an operator's timetable — a handful of pages per town, about once a month, always reviewed by a person, never bulk or automated. I credit OSM and BODS on every sheet. Is that use welcome, and is there anything you'd like me to do or avoid? Happy to add a bustimes.org credit if that helps. Thank you for the site. — [name]

## 4. Other launch-gate items

- **Privacy notice** — `/legal.html` is written but marked a working draft; confirm the wording and add a "last reviewed" date (P6 follow-up).
- **No personal data on public pages** — verified by construction in P6 (an organisation's branding carries no contact details); re-check if branding ever gains new fields.
- **Print-safety wording** — every public page and sheet says to confirm live times with the operator. Keep it: it is the honest limit of a printed map, and it is what makes "the map is a guide" defensible.
- **Sheet branding** — a customer's logo/colours are deliberately *not* printed on the sheet (P6/P7 decision). If that changes, re-check that a customer cannot imply an endorsement by an operator or a council they don't represent.

## 5. Sign-off

Progress recorded 2026-07-25. The **web-attribution** rows were verified by Claude: the OSM + BODS credit string is present in the footer of **every** public page (all 9 templates — shopfront, `/maps`, `/m/`, `/o/`, `legal`, `faq`, `examples`, `apply`, `contact`). The **printed-sheet** checks and the **final launch go/no-go** remain the operator's — a screen credit is not a paper credit, and this is a legal gate, not a code test.

| Item | Status | Verified by | Date |
|---|---|---|---|
| OSM (ODbL) credit — on **web** | ✅ present on all public pages | Claude | 2026-07-25 |
| BODS (OGL) credit — on **web** | ✅ present on all public pages | Claude | 2026-07-25 |
| OSM + BODS credit — on the **printed sheet** | ☐ check on paper (operator) — see §2 | | |
| Printed-sheet credit **legibility**, all four outputs | ☐ check on paper (operator) | | |
| bustimes.org terms | ◑ researched (§3 findings); **decision to record** (operator) | | |
| Privacy notice reviewed + dated | ✅ reviewed against the system (`legal.html`, dated); confirm for launch (operator) | Claude | 2026-07-25 |

**To close the paper checks:** print one A4 of each of the four outputs (geographic, schematic, diagram, external) from a signed-off map and confirm the OSM + BODS + "check live times" line is present and legible on paper. Then tick the two sheet rows with your initials + date.

Nothing here is legal advice; it is the operator's checklist. Record the outcome in this file (it is versioned) so the decision and its date survive.
