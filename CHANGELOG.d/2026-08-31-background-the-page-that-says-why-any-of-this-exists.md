---
date: 2026-08-31
title: "/background.html — the site could say what it does and what it costs, and not why it exists"
---

New public page telling the origin story: the 2026 St Ives volunteer leaflet, what it cost to make, and the question that followed from that cost. Linked from the footer on every page.

- **The gap it fills.** `/index.html` says what the system does, `/pricing.html` what it costs, `/examples.html` what it produces and `/opportunity.html` who should take it on. Nothing said **why any of it exists** — so the one question a journalist, a councillor or a curious reader asks first had no answer on the site, and was being retyped into emails each time.
- **It shows the thing it is arguing about.** The 2026 leaflet is on the page next to the generated St Ives sheets, because the claim is a comparison and a comparison with only one side is an assertion. The leaflet is a new static asset (`public/img/stives-leaflet-2026-{internal,external}.jpg`); the generated pair uses the live `/api/public/maps/st-ives/preview/*` with a static fallback, the same pattern as `index.html` and `examples.html`, so it follows the published map rather than freezing a copy that quietly ages.
- **The fallback images are cut from the current render, not the existing ones.** `public/examples/stives-area-*.jpg` date from 8 August; reusing them would have put a sheet on the page that no longer matches what the portal serves. The new ones are cut from `build 6.66 · 31 Aug 2026`, read off the sheet's own footer rather than inferred from a folder date — which mattered, because St Ives was rolled twice today and the first cut of this page was already stale by the time the page was written.
- **No pilot claims.** The page states there are no customers and that this is a pilot, in its own words rather than relying on the banner, and it makes no promise about how often a map is refreshed — the two things `CLAUDE.md` says public copy must not drift into. It carries `site-banner.js` like every other public page.
- **The footer link went through `scripts/lib/site-chrome.mjs`, not fifteen hand edits.** `npm run chrome:apply` propagated it; the diff is exactly one line per page, which is the evidence that nothing else moved while it did.
