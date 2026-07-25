# Licensing & attribution sign-off (launch gate)

This is the launch go/no-go the planning documents named: the maps are built from
other people's data, published to the public, and printed by third parties, so the
obligations have to be written down and **signed off before the public site is
announced** — not discovered afterwards.

`NOTICE` carries the short attribution statement; this file is the working detail and
the sign-off record.

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

- **On every printed sheet** — the map generator prints the OSM + BODS attribution and a
  "check live times" line onto the sheet itself, so a photocopy on a noticeboard still
  carries it. *This is the load-bearing one: it survives being detached from the website.*
- **On every public page** — the footer of the shopfront, `/maps`, `/m/<slug>`, `/o/<slug>`
  (P6) repeats the same statement.
- **`/legal.html`** — the fuller explanation of the sources, plus how the sheets may be
  reused.
- **`NOTICE`** — for anyone redistributing the software.

**Check before launch:** print one A4 sheet of each of the four outputs (geographic,
schematic, diagram, external) and confirm the attribution is legible on paper, not just
on screen. The two expert styles arrived in P7 and re-run the same generator, so they
inherit the credit line — but "inherits" is a claim to verify with a printout, once.

## 3. The open question: bustimes.org

Cross-checking against bustimes.org is part of *central* map-making (the expert tier), not
something a customer's browser or the portal server does. The volume is a handful of pages
per town per month, read by a person or with a person reviewing the result.

That is very likely fine, and it is deliberately **not** scaled into the self-serve tier —
but it has never been confirmed against the site's terms. Before launch, either:

1. read the current terms and record the conclusion below, or
2. write to the site owner describing the use (per-town, monthly, human-reviewed, credited)
   and record the reply, or
3. drop the dependency: the same check can be made against operator timetables and the
   BODS feed alone (slower, and it loses a genuinely useful sanity check).

Until one of those is recorded, treat "any UK town, automated" as **out of scope** — the
present scale (a few towns, monthly, expert-run) is what the assessment covers.

## 4. Other launch-gate items

- **Privacy notice** — `/legal.html` is written but marked a working draft; confirm the
  wording and add a "last reviewed" date (P6 follow-up).
- **No personal data on public pages** — verified by construction in P6 (an organisation's
  branding carries no contact details); re-check if branding ever gains new fields.
- **Print-safety wording** — every public page and sheet says to confirm live times with
  the operator. Keep it: it is the honest limit of a printed map, and it is what makes
  "the map is a guide" defensible.
- **Sheet branding** — a customer's logo/colours are deliberately *not* printed on the
  sheet (P6/P7 decision). If that changes, re-check that a customer cannot imply an
  endorsement by an operator or a council they don't represent.

## 5. Sign-off

| Item | Position | Who | Date |
|---|---|---|---|
| OSM (ODbL) attribution present on sheet + web | ☐ confirmed | | |
| BODS (OGL) attribution present | ☐ confirmed | | |
| Printed-sheet credit legibility (all four outputs) | ☐ checked on paper | | |
| bustimes.org terms | ☐ resolved (see §3) | | |
| Privacy notice reviewed + dated | ☐ confirmed | | |

Nothing here is legal advice; it is the operator's checklist. Record the outcome in this
file (it is versioned) so the decision and its date survive.
