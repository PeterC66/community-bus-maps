---
date: 2026-10-02
title: "A street carried by many lanes can be drawn as one trunk, and a town-centre place map draws no red arrow"
---

- **Re-vendors `engine/place/gen_internal.js` and `engine/place_pointer.js`, and vendors the new `engine/trunk_segments.js`, from claude-skills `work/trunk-segments` (buses-data OA-549).** `gen_internal.js` requires the new module at load, so the three travel together; `engine/vendored.json` gains its row and is restamped, and `check-vendored.mjs` accounts for all 40 engine files.
- **`internalRoads.trunkSegments`, opt-in.** Any stretch on which more than `minLanes` lanes run together is drawn as one neutral grey ribbon, with each lane gathering into it and spreading out of it in its own colour. A badge stack names only the routes never seen leaving the trunk, and S6 refuses a route that is neither seen leaving nor named. No stored map sets the key.
- **The red place arrow is off by default on a place carrying `design.partnerBox`**, a town centre, which its box identifies as an area rather than a point (Peter, 2026-10-02). High Wycombe Town Centre is the only stored map with a partner box; its next render loses the arrow, and a road name and one place label move into the space.
- **No gate fixture moves.** `verify:place` reproduces all four place sheets and `verify:area` the area sheet byte-for-byte; the fixture estate in claude-skills moved engine stamps only.
- **What a customer sees.** Nothing until a map is re-rendered. High Wycombe Town Centre is rebuilt with the trunk in buses-data and arrives as a proposed update for acceptance.
