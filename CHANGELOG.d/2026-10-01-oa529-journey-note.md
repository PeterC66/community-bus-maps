---
date: 2026-10-01
title: "A bracketed stop on the external sheet is a journey note, not a place"
---

- **The public services page stops listing "(some via Gransden)" as a place the bus goes (#456, buses-data OA-529).** The external sheet draws bracketed labels such as "(some via Gransden)", "(express via A428)" and "(term-time)" on a line, and `buildFacts()` copied them into `journeys[].places`, so `/m/<slug>/services` listed them as places (St Neots 18 and 905, Wisbech 52). `splitJourneyNote()` in `src/maps/facts.js` moves any wholly bracketed entry into `journey.note`, brackets dropped; it runs in `buildFacts()` and again on read in `publicServices()`, so snapshots written before this change are corrected too, and it is idempotent. Both renderers print the note after the days, as the sheet does.
- **No gate fixture moves.** No SVG is touched; `scripts/test-p8a.mjs` gains nine checks, eight of them seen red without the fix.
- **What a customer sees.** On the services page of St Neots and Wisbech, the bracketed text now reads as a note on the journey instead of a stop. No sheet changes.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live, and it carries #456 with it.
