# Accessibility — what we commit to, and how to check it

<!-- docstamp v1.2 | 2026-09-13 | sha=41e58f5d -->
**v1.2** · updated 13 September 2026

*Operator-facing. The public statement is [`/accessibility.html`](../public/accessibility.html);
this is the reasoning behind it and the checks that keep it true.*

Last reviewed 2026-07-26 (P8a).

## Why this is not optional

A bus map is a picture. Put a picture of one on a web page and it excludes everyone who cannot see
it, and everyone who can see it but not at 4 CSS pixels.

It also transfers a legal duty. Our likely customers — town and parish councils, schools — are
public sector bodies caught by the **Public Sector Bodies (Websites and Mobile Applications)
Accessibility Regulations 2018**, which require **WCAG 2.2 level AA**. The moment one of them links
to or embeds our map, our page is part of what they have to be able to defend. A map we cannot
stand behind is a map they cannot use.

So the target is WCAG 2.2 AA across the public pages, and the load-bearing piece is the text
alternative.

## What P8a actually delivers

| Requirement | How it is met |
|---|---|
| **1.1.1 Non-text content** | Every published map has a service list at `/m/:slug/services` — route, operator, days, stops served, where it goes — as ordinary HTML. The SVG itself is `role="img"` with a `<title>`/`<desc>` that names the alternative, so it is announced once rather than read out as 117 stray labels. |
| **1.4.1 Use of colour** | Routes carry their number/letter everywhere they carry a colour — on the sheet, in the key, and in the text version. The palette is colour-blind-safe by construction (it always was; this just keeps it true online). |
| **1.4.4 Resize text / 1.4.10 Reflow** | Vector artwork, not a flat raster: the map stays sharp at any size. Page content reflows to 320 px with no horizontal scroll; the map has its own pan/zoom rather than trapping the page. |
| **2.1.1 Keyboard** | The viewer stage is focusable and driven by arrows, `+`, `−`, `0`; every control is a real `<button>` with a label. Nothing needs a pointer. |
| **2.4.7 Focus visible** | `:focus-visible` outline on the stage and controls. |
| **4.1.3 Status messages** | Zoom level goes through a polite live region. |
| **3.1.x / provenance** | Every map states when its information is correct as at, and says so loudly once it is older than `STALE_AFTER_MONTHS`. |

## What is *not* solved, and why we say so

- **The map image cannot be made readable by a screen reader.** No description conveys what a
  network diagram conveys. The service list carries the same facts; it is a list, not a map. We say
  this on the public page rather than implying a parity that does not exist.
- **Downloaded files** (print JPG, SVG) are not accessible documents. The service list is the route
  to the same information; on request we will supply it another way.
- **JavaScript is required** to draw a map page, and currently to render the service list. The
  facts come from `/api/public/maps/:slug/services`, so a server-rendered fallback is a small
  change if it is ever asked for.

## The printed sheet is the primary product, and until 2026-09-13 this statement said nothing about it

**Everything above concerns the web page. The thing most of these maps become is paper on a wall, and where that paper is fixed decides who can read it** — which the public statement had no sentence for until buses-data OA-327. The gap was found in the field rather than by any check: two readers said publicly that they could not read our St Neots sheet in a bus shelter at Love's Farm because it was mounted above wheelchair and above eye height, and a third pointed out it sat above the head of the person who put it up.

**It is an accessibility failure of the primary product, and it was invisible here for a structural reason worth stating.** This document, the public statement and every check behind them ask about a *page*. A page's height above the ground is not a property anything in this repository can observe, so no amount of WCAG work could ever have surfaced it. The only instrument that found it was somebody standing at the stop.

**What the public statement now commits to**, in *If you put a printed sheet up*: the whole sheet between 900mm and 1800mm above the ground, centred about 1400mm, and a second copy centred 1000–1100mm where there is room. The source is the Department for Transport's [Inclusive Mobility](https://www.gov.uk/government/publications/inclusive-mobility-making-transport-accessible-for-passengers-and-pedestrians) (2022, §9.6, §13.4 and §13.7) — **and the edition a search returns first is the 2005 one, withdrawn on 10 January 2022, which is the only version that exists as readable HTML.** Both editions give the same numbers, so a wrong citation would carry a right figure and nobody checking the number would catch it. Quote the 2022 PDF.

**One consequence joins the paper back to this statement's own argument.** The QR code on every sheet sits 2–22mm above its bottom edge and leads to the map's service list — the text alternative that every claim above leans on. A sheet mounted out of reach does not merely become hard to read; it severs the only route the paper has to its accessible version. So height is not an afterthought about print, it is load-bearing for the alternative we offer.

**It is advice, deliberately, and not a condition of the licence.** We cannot observe how anybody mounts a sheet, so a condition could never fire — and a condition would imply we are responsible for the display, which contradicts what the same FAQ entry says about permission being the organisation's to obtain. The licence conditions are properties of the artefact (do not alter it, do not crop the credits) and are visible in any copy anyone shows us; a height is a property of a wall.

## Before publishing a map (part of the sign-off)

The publish checklist has a required `alternative` item. To tick it honestly:

1. Open `/m/<slug>/services`. Does every service on the sheet appear, with the right number,
   operator and days? Does anything appear that is *not* on the sheet?
2. Back on `/m/<slug>`, press <kbd>Tab</kbd> to the map. Can you zoom with `+`/`−`, pan with the
   arrows, and reset with `0`? Is the focus ring visible?
3. Switch sheets with the tabs using only the keyboard.
4. Check the "correct as at" date is the one you expect.

Once a release cycle, go further: run a screen reader (NVDA on Windows is free) over one map page
and its service list, and view a page at 400% browser zoom. Record what you found in the ops folder.

## If someone reports a barrier

Treat it as an incident, not a feature request — see
[`R6-incident-response.md`](R6-incident-response.md). Reply, say what you will do, and if
the fix is not quick, offer the information in another format in the meantime. The public statement
promises a reply, not a timescale, and that is deliberate: we are a volunteer-run pilot and should
not claim a service level we cannot keep.

## Related

- [`/accessibility.html`](../public/accessibility.html) — the public statement, including the
  paragraph a customer can paste into their own.
- [`R3-review-and-publish.md`](R3-review-and-publish.md) — where the check sits.
- `portal-online-maps-plan_2026-07-26.md` (Buses repo) — the three-tier plan; accessibility is the
  cross-cutting obligation that made the embed tier worth doing properly.
