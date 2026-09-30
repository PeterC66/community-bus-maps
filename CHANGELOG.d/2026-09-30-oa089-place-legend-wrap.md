---
date: 2026-09-30
title: "A place map's legend can wrap a long operator row, and two dependency advisories are fixed"
---

- **Re-vendors `engine/place/gen_external_places.js` from PeterC66/claude-skills#249 (#446, buses-data OA-089).** A place's "Buses from" sheet now honours `legendWrap:{perRow:N}`, the key the town radial already uses, so an operator with many routes wraps onto further rows instead of one row the width of the page. High Wycombe Town Centre's 17 Carousel routes needed it. Absent the key a sheet is byte-identical: `verify:place` reproduces all four fixture sheets byte for byte.
- **`npm audit fix` for two advisories published on 2026-09-30 (#447).** brace-expansion 5.0.9 → 5.0.12 (high: three denial-of-service advisories) and fast-uri 4.1.4 → 4.2.1 and 3.1.7 → 3.1.8 (moderate: host normalisation, mailto injection). Lockfile only, patched versions of packages already in use; `npm test` and `npm run verify` pass.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. No schema, route, UI or ink change for any published map.
