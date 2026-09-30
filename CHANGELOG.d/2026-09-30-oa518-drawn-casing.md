---
date: 2026-09-30
title: "A map can opt to draw its grey road casing along the bus lines themselves"
---

- **Re-vendors `engine/place/gen_internal.js` and `engine/casing_width.js` from PeterC66/claude-skills #258 (buses-data OA-518).** The new opt-in key `internalRoads.caseDrawnLanes` draws each route's grey casing along its drawn line, stroke + pad wide, instead of along the matched road at the width of the whole bundle. That removes the grey lobes where a short loop collapses under its lane shift: Ely Co-op's at Tesco, and the inner lobe of St Ives' knot. Road labels are unchanged. `engine/vendored.json` is restamped (2 entries).
- **No gate fixture moves.** No map sets the key yet and the absent key is byte-identical: `npm run verify:area` and `npm run verify:place` reproduce every fixture sheet byte for byte on the new engine.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. Nothing a customer sees changes until a map is rebuilt with the key set; no schema, route or UI change.
