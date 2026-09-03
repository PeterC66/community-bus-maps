---
date: 2026-09-03
title: "The road graph the two pre-stages both built"
---

- **`engine/road_graph.js` is new, and `engine/expert/`'s two pre-stages are ~190 lines shorter.** `schematize_internal.js` and `diagram_internal.js` each built the same road graph — node interning, edge insertion, junction-cluster contraction, corridor walking, Douglas-Peucker, the least-squares solver and the inverse-distance warp field. That graph is now one module, required by both. OA-232 Tier 3.3, the last item of the 2026-09-03 codebase review.

- **The three differences between the two copies are parameters**, which is the shape `external_primitives.js` already established: the diagram keeps `ll` on a node and `name` on an edge, the schematic keeps neither, and the schematic calls its Douglas-Peucker `dp`. The two node shapes are **whole object literals rather than a spread**, because `{ll: undefined}` is a key and these pre-stages serialise nodes for a living.

- **Nothing drawn moved, and the two sheets that could have are the two this touches.** `npm run verify:area` reproduces `internal-schematic.svg` (299,671 B) and `internal-diagram.svg` (303,237 B) **byte-identically through the vendored copies**, and `verify:place` reproduces all four place sheets. On the skill side all 98 sheet verdicts were identical to a baseline taken before the first edit.

- **`road_graph.js` had to be vendored, not just referenced.** It is a new load-time dependency of two files the portal already vendors, and a partial vendor takes the whole render down rather than staling one output. `check-vendored.mjs` is what would have caught it — its `UNRESOLVED` class is exactly "a `SKILL_ASSETS` require that was never vendored at all" — and it now accounts for **34 engine files, and every module they require**.

- **Engine stamps move with it:** town `ded663a06e` → `e05a4f0cfb`, place `0437926deb` → `76db6792ff`. Nineteen maps were re-stamped in buses-data `f6db5f2`; Wisbech is held back under its dated exception. `npm run track:engine` carries the delivered map packs forward after this is deployed.
