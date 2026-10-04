---
date: 2026-10-04
title: "A map can keep its exit captions off route ink"
---

- **Re-vendors `engine/labeller.js` and `engine/place/gen_internal.js` from claude-skills #293 (buses-data OA-561).** `engine/vendored.json` is restamped.
- **What changed in the engine.** A new design key, `exitAvoidsInk`, gives each "to X" exit caption a ceiling on route ink and two further positions to try, so it can clear its own badge. A caption with no clear spot is still placed, on the least ink. Absent, nothing changes.
- **No gate fixture moves.** No portal map sets the key and `verify:place` and `verify:area` reproduce every sheet byte for byte.
- **What a customer sees.** Nothing yet. A map picks this up the next time it is rebuilt with the key set.
