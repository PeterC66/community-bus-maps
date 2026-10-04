---
date: 2026-10-04
title: "A map can keep a pub off route ink even when its name has no other clear spot"
---

- **Re-vendors `engine/poi_select.js` and `engine/place/gen_internal.js` from claude-skills #292 (buses-data OA-430 ink review).** `engine/vendored.json` is restamped.
- **What changed in the engine.** The second look at a named pub or station with no clear spot (#289) may seat it on route ink. A new design key, `strandedOnInk`, set to `false` gives that look the first look's ink test, so the pub is left off instead. Absent, nothing changes.
- **No gate fixture moves.** No portal map sets the key and every gate fixture reproduces byte for byte.
- **What a customer sees.** Nothing yet. A map picks this up the next time it is rebuilt.
