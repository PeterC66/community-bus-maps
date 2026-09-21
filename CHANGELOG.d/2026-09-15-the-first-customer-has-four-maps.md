---
date: 2026-09-15
title: "The first customer has four published maps"
---

- **BusMaps.uk has a customer with a public presence.** `st-neots`, `st-neots-town-centre`, `st-neots-tesco-extra` and `st-neots-co-op` are all **v1.0**, all owned by Love's Farm Community Association, every page and sheet answering 200 and none carrying *"Not published by any organisation"*. The pilot organisation drops from 18 public maps to 14. The quota was exactly right at 1 area and 3 places, which is what St Neots has. The sheet in the Love's Farm bus shelter now has a QR leading to a page badged by the town's own community association.

- **A re-imported map is a DRAFT, and a draft is a 404 — the largest cost of the delete-and-reimport path, and it was written down nowhere.** `import-map.mjs` sets `current_version_id` and never `published_version_id`; `PUBLIC_WHERE` requires the latter. So a map leaves every public query the moment the old row is deleted and does not return when the import succeeds — it returns when somebody puts v1.0 through the P4 gate with `scripts/publish-baseline.mjs`. Found when the first map delivered answered 404 after a delivery that reported success at every step. `docs/R1-create-map.md` now states it first among that path's costs and gives the sequence as **six** steps per map, not five.

- **Check the status code before the content.** The check being used was `grep` for the pilot band in the served SVG — which returns nothing when the sheet is a 404, and that empty result reads exactly like *the band is gone*. R1 now says to confirm the page answers 200 before looking at anything else. A content check cannot tell a missing artefact from a missing feature.

- **Take `--src` from the board, never from a directory listing.** `ls | tail -1` sorts `v2.9` after `v2.32` and `v1.9` after `v1.19`, and that delivered three of the four maps from renders a fortnight old. The portal's pre-flight verify refused one of them — the 26 August render regenerates larger under the de-duplicated engine — and **passed the other two**, because that engine change happens not to alter those sheets: a stale render that still reproduces is indistinguishable, to a gate that asks only whether it reproduces, from a current one. `status.js` prints the current build for every map and was the right source all along.

- **`--customer` matches by exact bytes and a miss cannot be undone.** `getCustomerByName` is a plain SQL `=`, so one wrong character creates a second organisation — and no tool in this repository can delete a customer row. R1 now says to copy the name out of the admin console rather than type it, and to confirm the importer printed `· owner: existing customer`.

- **And the delete half still has no laptop command.** `deliver-map.mjs` carries the import end to end and knows nothing about `delete-map.mjs`, so a handover is two stop/start cycles per map with the delete run over `npm run ssh`. Recorded in R1 rather than built around: a `--replace` doing both inside one cycle would close the second window, and one customer did not justify it.
