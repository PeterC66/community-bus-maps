---
date: 2026-10-03
title: "A map can name the roads it wants labelled before its badges are placed"
---

- **Re-vendors `engine/place/gen_internal.js` and vendors the new `engine/road_labels.js`, from claude-skills #277 (buses-data OA-176).** `gen_internal.js` requires the new module at load, so the two travel together; `engine/vendored.json` gains its row and is restamped, and `check-vendored.mjs` accounts for all 41 engine files.
- **`internalRoads.roadLabelPin`, opt-in.** The road names it lists are placed and reserved before the badge pass, so a badge cannot take their space. No stored map sets the key, so no stored sheet moves.
- **No gate fixture moves.** `verify:place` reproduces all four place sheets and `verify:area` the area sheet byte-for-byte.
- **What a customer sees.** Nothing until a map sets the key and is re-rendered.
