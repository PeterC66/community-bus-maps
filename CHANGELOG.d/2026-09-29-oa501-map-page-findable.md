---
date: 2026-09-29
title: "A map page's title says \"bus map\", and a crawler gets a heading and a sentence"
---

- **The `/m/<slug>` title now names the place first and says "bus map"** — *Wisbech bus map — Buses within Wisbech — BusMaps.uk*, or *St Neots Co-op bus map — Buses serving St Neots Co-op* for a place map. Google had `/m/wisbech` indexed since 19 September and ranked it for nothing, because the old title, *Buses within Wisbech*, never contained the words people search for (buses-data OA-501).
- **The server now writes the page's heading and one sentence** naming the place and its services, for example *The Wisbech bus maps show 12 bus services: …*. Until now the HTML a crawler received had no heading and no text until the browser fetched the map. The heading is now an `<h1>` at the size the old `<h2>` had. The sheet itself still loads in the browser.
- `scripts/test-ssr.mjs` holds the title, the heading, the sentence and the route's wiring. The words come from the new `public/js/shared/map-page.mjs`.
