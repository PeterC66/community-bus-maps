---
date: 2026-10-05
title: "The services text carries a route's \"some via\" words, as the sheet's panel does"
---

- **`buildFacts()` reads `minority.json` and appends its words to a route's days** (buses-data OA-529, fix 1, portal half). A route the file names reads "daily · some journeys via Eynesbury", the same "days · words" the sheet's Services panel prints; a map with no such file reads exactly as before. The words are copied from the file the engine wrote (#480), never re-derived.
- **What a customer sees.** Nothing yet. No committed map has the file until it is rebuilt, so St Neots route 18 and High Wycombe route 40 gain the words at their next rebuild, and a snapshot already written keeps its old days.
- **Tests.** `scripts/test-p8a.mjs` gained three checks; the one that names a route in `minority.json` was seen red with the change removed.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries four earlier merges that were not yet deployed: #479 (`design.legendFit`, byte-inert), #480 (the `minority.json` re-vendor), #481 (the St Ives fixture re-vendor) and #482 (its changelog). No schema, route or UI change, and no sheet changes beyond the St Ives fixture those merges already described.
