---
date: 2026-09-29
title: "No landmark symbol sits on the town-centre square or its name"
---

- **Re-vendors `engine/place/gen_internal.js` and `engine/poi_select.js` from PeterC66/claude-skills#235 (#443, buses-data OA-523).** The town-centre anchor's square and its name now form one box that `spreadIcons` pushes landmark symbols off (`pushOffBoxes` in `poi_select.js`). Before, a symbol could land on the anchor's name: on St Ives the Waitrose trolley sat on "St Ives Bus Station" on the schematic, and now it moves clear. The same PR vendors the St Ives gate fixture as v6.94, rebuilt on claude-skills 25d4fae, and `verify:area` is byte-identical on all three sheets.
- **Restages the St Ives gate fixture as v6.93 on claude-skills fe67c9a (#442, buses-data OA-522).** The diff is the build stamp, the engine fields and the fixture's copy of `gen_internal.js`, which is the fe67c9a bytes already vendored in #439. No ink moves; test fixtures only.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. No schema, route or UI change. A map drawn in the portal after this deploy keeps landmark symbols off the town-centre name, and no published sheet changes until it is redrawn.
