---
date: 2026-10-01
title: "A place map can outline another map's town-centre box"
---

- **Re-vendors `engine/complexity_ladder.js` and `engine/place/gen_internal.js` from the claude-skills branch `oa534/partner-box` (claude-skills #260, buses-data OA-534).** A place internal sheet can now draw ANOTHER sheet's town-centre box as a dashed outline, so a place map inside a town's box shows where the town sheet's box falls. It is `design.partnerBox`, opt-in: absent, every sheet is byte-identical. The outline is drawn with `path` and its label with `text`, both already on the SVG allowlist. `engine/vendored.json` is restamped for both files.
- **No gate fixture moves.** No fixture map sets the key. `npm run verify:place` and `npm run verify:area` reproduce every fixture sheet byte for byte on the new engine.
- **What a customer sees.** Nothing. No stored map sets `design.partnerBox`; High Wycombe Town Centre takes it at its next rebuild (buses-data OA-089).
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live.
