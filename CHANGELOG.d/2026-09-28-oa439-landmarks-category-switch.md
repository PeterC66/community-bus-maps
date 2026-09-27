---
date: 2026-09-28
title: "The Landmarks page switches pubs, allotments and railway stations on and off"
---

- **A category switch on the Landmarks page (buses-data OA-439, item 3).** A panel, *Kinds of place most maps leave off*, has one checkbox each for pubs, allotments and railway stations, with how many of each the map's own OpenStreetMap data holds. A category the data holds none of is shown disabled with the reason. The switch takes effect on save: the map is redrawn and the places join or leave the list. Only a switch that differs from the town's own default is saved, as `internal.poiInclude`.
- **`GET /api/maps/:id/landmarks` passes the saved switch to `enumerateCandidatesFromDir()`**, so the chooser offers what the sheet draws, and returns `categories`, one row per switch, from the new `categorySwitchesFromDir()`. **`GET /api/maps/:id/poi-tiers` returns the customer's saved switch as `include`**, for `poi_tiers_sync.js` to carry into the source data (item 4).
- **A switched-off category keeps its answers.** `editablePoiKeysFromDir()` enumerates with every opt-in category on, so a pub answered and then switched off is not refused on the next save.
- **Both save paths carry the switch.** The map editor holds `poiInclude` unchanged, as it holds `poiTiers`, so a save there no longer deletes it.
- **The review summary reports it.** `changeSummary()` gains `categories`, and a version whose only change is a switch is no longer reported as unchanged. The editor's summary and the review page list it.
- **Tests.** `test-change-summary.mjs` gains the switch cases, watched red by hand. `test-landmark-tiers.mjs` checks that a pub answer survives the switch being off. `prove-red-landmark-tiers.mjs` gains an arm for that, and its two key-universe anchors follow the changed line.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. A customer sees the new panel on the Landmarks page. No schema change, and no sheet's ink moves until a customer uses the switch.
