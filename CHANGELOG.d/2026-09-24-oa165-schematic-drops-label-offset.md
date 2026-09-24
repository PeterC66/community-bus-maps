---
date: 2026-09-24
title: "The simplified street map no longer moves a label by a nudge meant for the geographic map"
---

- **Re-vendored `engine/place/gen_internal.js` and `engine/poi_select.js` from claude-skills#118** (buses-data OA-165, decided by Peter on 2026-09-21). A landmark's `force` still holds on every sheet. Its hand-set `label.offset` and `label.anchor` now apply to the geographic sheet only, because the schematic redraws the geometry and the same millimetre nudge lands somewhere unrelated: on High Wycombe Aldi it put the *Aldi* label on the route 27 line. A customer who nudges a label in the editor therefore moves it on the geographic sheet only. The Aldi place fixture's `internal-schematic.svg` is recut from buses-data `a6693ab3`, and that is the only sheet that moves.
