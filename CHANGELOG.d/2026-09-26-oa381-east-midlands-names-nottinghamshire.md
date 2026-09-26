---
date: 2026-09-26
title: "The East Midlands panel names Nottinghamshire's county bus map"
---

- **The East Midlands Combined Authority panel now says who does publish a map** (buses-data OA-381). Peter ruled on 2026-09-26 that East Midlands, Southend-on-Sea and York and North Yorkshire stay `networkMap.status: no`, because none of the three authorities publishes a map itself. Southend and York already named the neighbouring or constituent council's map under `alsoPublished`; East Midlands did not, though its private note named the Nottinghamshire County Bus Network map. buses-data now carries that entry, read live on 2026-09-26, and the vendored `public/data/bus-map-directory.json` is re-synced from it with `scripts/sync-directory.mjs`. The only change to the file is the one new `alsoPublished` entry.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It changes vendored data only: no code, schema, route, engine or rendered-sheet change, so `verify:area` and `verify:place` do not move. `test:directory` passes on the re-synced file.
