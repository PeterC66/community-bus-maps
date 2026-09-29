---
date: 2026-09-29
title: "An opt-in landmark symbol gives way to route ink, and the St Ives gate fixture is from v6.92"
---

- **Re-vendors `engine/place/gen_internal.js` and `engine/poi_select.js` from PeterC66/claude-skills#231 (#439, buses-data OA-522).** A pub, station, post office, allotments or industrial-estate symbol is now placed last, at the nearest spot within 4 mm that is clear of route ink, badges and everything reserved, and is left off where there is none. Core symbols are unchanged. Both committed gate fixtures still reproduce byte for byte on the new engine (`verify:area` and `verify:place` pass), so a sheet only changes when it is next drawn, and only where an opt-in symbol sat on route ink.
- **Re-vendors `gate-fixtures/Areas/_portal-fixture/St Ives` from St Ives v6.92 (#440, buses-data OA-430).** v6.92 was drawn on the pinned claude-skills 160a199 with `internalRoads.skeletonMaxW` removed; against the previous fixture only the build stamps and that key move, and the sheets are byte-identical bar the stamp.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. No schema, route or UI change; no published sheet changes until it is redrawn.
