---
date: 2026-09-30
title: "A route badge no longer prints over the anchor's own name on a place map"
---

- **Re-vendors `engine/place/gen_internal.js` from PeterC66/claude-skills (buses-data OA-531).** The pass that guarantees a badge to a line whose colour is shared now skips a spot where the badge stack would cover the map's anchor label, as the lane badges already did. On High Wycombe Town Centre the 102/103/104/105/M40/X74 stack could print over "Oxford Street"; the forcing pass is unchanged, so a line that needs identifying still gets its badge. `engine/vendored.json` is restamped (1 entry).
- **No gate fixture moves.** High Wycombe Aldi's internal, external and schematic sheets and High Wycombe High Street's boarding sheet reproduce byte for byte on the new engine (`scripts/refresh-place-fixture.mjs --check`), `gate-fixtures/` is in step with buses-data, and `npm run verify:place` passes locally.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. A place sheet drawn with the vendored engine may put an identifying badge stack in a different spot when its first choice sat on the anchor label; no schema, route or UI change.
