---
date: 2026-09-27
title: "The engine can narrow a road casing that is wider than the road around it"
---

- **Re-vendors `engine/place/gen_internal.js` and adds `engine/casing_width.js` from PeterC66/claude-skills#187 (buses-data OA-064).** A new opt-in key, `internalRoads.casingSmooth`, narrows each grey road-casing segment to the length-weighted median width of the casing around it, which removes the grey disc a knot of short wide segments paints at a busy junction and leaves real wide streets alone. `gen_internal.js` requires the new module at load, so both files travel together. No map sets the key yet, so no sheet changes — `verify:place` is byte-identical.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. Nothing a visitor or a customer sees changes: no schema, route, UI or ink change.
