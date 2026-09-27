---
date: 2026-09-27
title: "The schematic sheet names a route's minority workings, as the internal sheet does"
---

- **`engine/expert/schematize_internal.js` and `engine/expert/diagram_internal.js` are re-vendored from claude-skills #191 (`0002368`).** Both run `gen_internal.js` in a nested workspace. Neither had copied `journey_weights.json` into it, so the Services panel on a schematic sheet never printed the "some journeys via …" note (buses-data OA-452) that the internal sheet from the same build carries. The fix adds that file to each script's copy list. `engine/vendored.json` is restamped.

- **Only two maps carry `journey_weights.json` today: St Neots and High Wycombe.** Their schematic sheets change when they are next rebuilt and delivered. No other pack and no committed fixture carries the file, so nothing else moves, and `refresh_area_fixture.js --check` reports CURRENT. The deploy's own §4a tracking step brings the live packs forward.
