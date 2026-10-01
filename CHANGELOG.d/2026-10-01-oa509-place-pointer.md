---
date: 2026-10-01
title: "A place map points at the place with a red arrow"
---

- **Re-vendors `engine/place/gen_internal.js` and adds `engine/place_pointer.js` from the claude-skills branch `oa509-place-pointer` (buses-data OA-509).** Every place internal sheet now draws a red arrow with a white edge aimed at the place's own marker, so the place is the first thing a reader finds. It is `design.placePointer`, on wherever `routes.json` names a `place` and off for a town; `false` declines it on one place. The arrow picks its own bearing and reserves its length, so badges and labels work round it. It is drawn with `line` and `path` only, both already on the SVG allowlist. `engine/vendored.json` gains its row and is restamped.
- **One gate fixture moves, on purpose.** High Wycombe Aldi's internal and schematic sheets each gain the six-line arrow group; they are recut in buses-data (`21b914d9`) and copied into `gate-fixtures/`. High Wycombe High Street has no internal sheet and is unchanged. `npm run verify:place` and `npm run verify:area` reproduce every fixture sheet byte for byte on the new engine.
- **What a customer sees.** Nothing changes on deploy: no stored sheet is re-rendered. Once `npm run track:engine` has copied the new generator into the stored packs, the NEXT render of a place map — a preview, an accepted proposed update, a re-publish — draws the arrow. A town map renders exactly as before, because the key is off for a town.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live.
