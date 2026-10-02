---
date: 2026-10-02
title: "A coreBox suppresses the anchor only when it contains it"
---

- **Re-vendors `engine/place/gen_internal.js` from claude-skills `work/corebox-anchor` (0392a7e, claude-skills #279, buses-data OA-549), merged here as #461.** The anchor square, its label and the place pointer used to be suppressed on a `coreBox`'s mere presence, which held while every box sat on its anchor. High Wycombe Town Centre v2.4 recentres an 80 m box onto the bus station, 210 m from its Oxford Street anchor, and the first build lost "Oxford Street", the stop the sheet exists to name. The condition is now "the box contains the anchor". `engine/vendored.json` is restamped.
- **No gate fixture moves.** No stored map draws a box away from its anchor; High Wycombe's and Wisbech's boxes contain theirs. `status.js` under the new engine gates every map PASS, and the post-merge `verify (byte-identical)` run is green.
- **What a customer sees.** Nothing today. High Wycombe Town Centre v2.4 is built with this engine in buses-data and arrives as a proposed update once this is live.
- **Deploy history, written after the merge this time.** #461 went up without its fragment; this entry describes it so the deploy's step 0 can let it go live, per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).
