---
date: 2026-09-28
title: "The /maps panel says Lancashire publishes a bus map"
---

- **Re-syncs `public/data/bus-map-directory.json` from buses-data (buses-data OA-497).** The directory row for Lancashire County Council said the council publishes no network map. It publishes *bus map & guide — Map 1, Lancaster & Morecambe*, January 2026, and the row now reads `some · pdf · council · 2026-01`, pointing at Lancaster District Bus Users' Group's timetables page. That row is the only change in the file; the bus user group register added to buses-data's directory the same day is not a projected field and does not reach the portal. This also turns buses-data's CI green, whose `sync:directory --check` step has been red since the row was corrected.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** A visitor to /maps who picks Lancashire sees the council's January 2026 map instead of the letter asking for one. No schema, route or ink change.
