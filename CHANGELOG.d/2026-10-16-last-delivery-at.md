---
date: 2026-10-16
title: "GET /api/maps says when each map was last delivered"
---

- **Each map in `GET /api/maps` carries `lastDeliveryAt`**, the database's UTC `YYYY-MM-DD HH:MM:SS`, or `null` for a map never built. It is the newest of the map's first version, which `import-map.mjs` writes, and its newest `proposed_update` of any status, which `propose-update.mjs` writes and `deliver-map.mjs` runs. A version the customer saved is not a delivery and does not move it. A retired version keeps its row, so the import time survives a prune.
- **Why.** bus-work's worklist (claude-skills) now raises `undelivered-<slug>` when a map's newest local S5 render is newer than the portal's last delivery of it. Before this, a rebuild that never reached the portal silenced its own refresh reminder and nothing else chased it; Godmanchester Co-op Ermine Street v1.35 was the example. Nothing on the host records which render a delivery came from (deliver-map.mjs step 0b), so a time is the one fact both sides hold. The worklist reads it with the read-only `OPERATOR_TOKEN`, which admits `/api/maps` and not `/api/maps/:id`, so the field goes on the list and the token gains no route.
- **`scripts/test-last-delivery.mjs`** (`npm run test:last-delivery`) has eight cases, and each move is paired with a customer save that must not move it. Counting every version as a delivery turned two of them red.
- **What a customer sees.** Nothing. It is one more field in an API response the editor already ignores.
