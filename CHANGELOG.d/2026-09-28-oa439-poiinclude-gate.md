---
date: 2026-09-28
title: "The safe subset admits the landmark category switch"
---

- **`src/maps/safeSubset.js` admits `internal.poiInclude` (buses-data OA-439, item 1).** A save or preview may now carry `{ "pubs": true, "stations": false }`: `true` switches an opt-in category on, `false` switches it off, and both are kept. A category outside the engine's `OPT_IN_CATS` (allotments, pubs, stations), a value that is not `true` or `false`, or a switch that is not an object is refused with its reason, where it used to be refused as expert-only. The list is read from the vendored `engine/poi_select.js`, not copied.
- **The landmark chooser's candidates are merged by the engine's own `mergePoiOverlay()` (item 2).** `enumerateCandidatesFromDir()` drops its inline copy of the tiers merge and takes the category switch as an optional third argument, so what the chooser offers and what the sheet draws come from one rule. No caller passes the switch yet, and nothing in the UI sends it: the switch on the Landmarks page is item 3.
- **Tests.** `test-safe-subset.mjs` gains the switch's cases and `test-landmark-tiers.mjs` a fixture pub switched on and off; `prove-red-landmark-tiers.mjs` gains an arm for the dropped overlay and its expert-only anchor follows the widened sweep.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. Nothing a visitor or a customer sees changes: no schema, route, UI or ink change.
