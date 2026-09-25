---
date: 2026-09-25
title: "A landmark mapped twice keeps its name"
---

- **Re-vendored `engine/poi_select.js` from the claude-skills pull request for buses-data OA-347.** When OpenStreetMap maps one site twice, once with a name and once without, the engine kept whichever record came first in the file. In March the nameless record came first, so George Campbell Leisure Centre was dropped and the site was left blank on the sheet. The named record now wins, and it brings its own position. When both records are named, or both are unnamed, the first still wins, as before. Across buses-data's 23 committed maps only March changes: its geographic and simplified street sheets gain the leisure centre's symbol and a numbered key entry, and Lidl's caption moves 3.8 mm. Every other map, including both portal fixtures (St Ives and High Wycombe Aldi), is byte-identical, so `verify:area` and `verify:place` do not move.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries only the re-vendor and this entry. No schema, route or UI changes. The published March sheets redraw at their next re-render. §3a has no sheet-level check that can see this. The claude-skills estate measurement in the engine commit is the evidence.
