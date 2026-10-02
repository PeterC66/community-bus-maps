---
date: 2026-10-02
title: "A place map can fit its frame to another map's town-centre box"
---

- **Re-vendors `engine/complexity_ladder.js` and `engine/place/gen_internal.js` from the claude-skills branch `work/oa089-partnerbox-fit` (afa68e0, claude-skills #274, buses-data OA-089).** `design.partnerBox.fit: true` fits a place internal sheet's frame to the partner box's outline instead of to its stops, so the box nearly fills the map. Opt-in: absent, every sheet is byte-identical. `engine/vendored.json` is restamped for both files.
- **No gate fixture moves.** No fixture map sets the key. `npm run verify:place` and `npm run verify:area` reproduce every fixture sheet byte for byte on the new engine.
- **What a customer sees.** Nothing. No stored map sets `design.partnerBox.fit`; High Wycombe Town Centre takes it at its next rebuild (buses-data OA-089).
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live.
