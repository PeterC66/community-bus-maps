---
date: 2026-09-27
title: "The engine can read a landmark category switch from a map's overrides"
---

- **Re-vendors `engine/poi_select.js` and `engine/place/gen_internal.js` from PeterC66/claude-skills#179 (buses-data OA-439).** The generator now reads the customer's overrides through one function, `mergePoiOverlay()`, which holds the existing landmark-tier merge and a new category switch, `internal.poiInclude` — `{pubs: true}` switches an opt-in category (allotments, pubs, stations) on and `false` switches it off. It is the engine half of the landmark chooser's category switch. Nothing can set it yet: `safeSubset.js` still refuses any `internal` key but `pois` and `poiTiers`, so no saved map carries it, and no sheet changes — `verify:area`, `verify:place` and both defaults gates are byte-identical.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. Nothing a visitor or a customer sees changes: no schema, route, UI or ink change.
