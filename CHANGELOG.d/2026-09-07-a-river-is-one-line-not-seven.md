---
date: 2026-09-07
title: "A river is one line, not seven — the diagram engine stops mapping a feature one OSM way at a time"
---

Engine re-vendor for buses-data OA-059, from `claude-skills` `db4f011`. Byte-inert on every stored sheet in the portal today: `track-engine.mjs` re-renders nothing, so what changes is the next render of each map.

- **`engine/expert/diagram_internal.js`.** `mapFeatureSeg()` pins a polyline where it crosses the solved route network and similarity-transforms the spans between crossings — per POLYLINE, and a river is many OpenStreetMap ways. Two ways that met in reality got different transforms and stopped meeting on the sheet; a way crossing no route at all fell through to `warp()`, a third transform again. The ways are now welded into chains before mapping, so each real line gets one transform.
- **What it was, measured on the shipped St Ives v6.70 diagram** rather than argued: the river is seven ways forming one chain through five end-to-end joins, and three of the five arrived broken, by up to 18% of the river's own width across the page. 958 mm of river was drawn and 190 mm of it landed inside the map box; the rest was flung off a 210 mm page. High Wycombe's River Wye was an amoeba — one polyline drawn back over itself — and the Chiltern Main Line was three unconnected fragments on two different sheets.
- **`engine/linear_features.js`.** The eight pure polyline helpers move from inside the factory to module scope so `stitchSegs` can be exported. It is imported rather than copied because its `maxTurn` guard was written after St Neots' four parallel tracks chained into a path that doubled back four times, and a hand-written second copy would not have it.
- **The build now says how many ways became how many chains,** per feature, which is the half of this that no byte count, label diff or quality metric could ever have shown. Beaconsfield's railway reads 30 ways to 3 chains; High Wycombe's 73 to 8.
