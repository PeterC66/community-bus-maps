# Accessibility — what we commit to, and how to check it

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
[`runbook-incident-response.md`](runbook-incident-response.md). Reply, say what you will do, and if
the fix is not quick, offer the information in another format in the meantime. The public statement
promises a reply, not a timescale, and that is deliberate: we are a volunteer-run pilot and should
not claim a service level we cannot keep.

## Related

- [`/accessibility.html`](../public/accessibility.html) — the public statement, including the
  paragraph a customer can paste into their own.
- [`runbook-review-and-publish.md`](runbook-review-and-publish.md) — where the check sits.
- `portal-online-maps-plan_2026-07-26.md` (Buses repo) — the three-tier plan; accessibility is the
  cross-cutting obligation that made the embed tier worth doing properly.
