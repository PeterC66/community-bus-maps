---
date: 2026-09-29
title: "The /maps place panel prefers the namesake our own map has just shown"
---

- **Searching a name several places share now leads the panel with the one our grid has just placed.** *Hilton* used to put the St Ives map (route 9 goes to Hilton, Huntingdonshire) above a panel saying *Hilton is in Shropshire*. `searchDirectoryWithPlace()` now takes `near`, the subjects of the maps the grid returned, and moves the first namesake whose county or district is a comma-separated part of one of them to the front. The others keep their order, and the displaced one is still listed (buses-data OA-382).
- Only an area map's subject names a county (*St Ives, Cambridgeshire*); a place map's names a town and changes nothing. Both `/maps` and `/api/public/search` pass it, so the server-rendered and browser panels still agree.
- `scripts/test-directory.mjs` holds the Hilton case, the displaced namesake and the place-map control.
