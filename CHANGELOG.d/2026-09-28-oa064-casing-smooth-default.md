---
date: 2026-09-28
title: "Road casing no longer fuses into a grey lobe where bus lines meet in a tight knot"
---

- **Re-vendors `engine/place/gen_internal.js` and `engine/internal_roads_config.js` from PeterC66/claude-skills#203 (buses-data OA-064).** `internalRoads.casingSmooth: 1` becomes the engine default: each road-casing segment is narrowed to the median casing width around it, so where several bus lines meet in a tight knot the grey casing no longer swells into a lobe. A map can opt out with `casingSmooth: 0`. Only casing widths move; no label, line or icon does.
- **Both gate fixtures are recut on the branch engine.** St Ives was rebuilt in buses-data as v6.87 and its area pack restaged; High Wycombe Aldi's internal and schematic sheets were recut with `scripts/refresh-place-fixture.mjs`; High Wycombe High Street's boarding sheet is unchanged. `npm run verify` passes.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. A map sheet drawn with the vendored engine shows slightly narrower grey road casing at tight junctions; no schema, route or UI change.
