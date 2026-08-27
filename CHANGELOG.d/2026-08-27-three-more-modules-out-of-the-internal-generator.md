---
date: 2026-08-27
title: "Three more modules out of the internal generator, and the require scan caught them itself"
---

`Development Docs/open-actions.md` in `buses-data`, OA-129 Phase 3, extractions 6–8.

- **`engine/place/gen_internal.js` is re-vendored 3,735 → 3,454 lines**, with three new modules beside it at the engine root: `svg_primitives.js` (the eight small marks a sheet is drawn out of), `linear_features.js` (river, road, railway and canal — style layering, geometry, and the stitch and merge passes) and `label_placer.js` (the shared reserved-box list, both label placers, and the route-ink contrast floor). Every one of the 74 sheet verdicts on the skills-side board is byte-identical across all three extractions, and so are an `EDITOR_KEYS=1` render and the build's stderr on all 20 maps.
- **The require scan fixed last week did its job on its first real test.** Copying the generator across with no manifest rows failed the audit and named all three modules by name — `UNRESOLVED required through SKILL_ASSETS by place/gen_internal.js` — rather than reporting all clear the way it did before that fix. The rows were then written by hand, because the manifest is the vendor script's input and it cannot invent a row for a module nobody has listed.
- **`npm run test:selfsufficient` now resolves 13 modules out of `engine/` and one from the data pack**, with none from anywhere else, so the three new files are proven to load through `SKILL_ASSETS` rather than through the laptop's fallback path into the skill checkout.
- `npm test` and the whole `npm run verify` chain — area, place, defaults and self-sufficiency — are green, and the skills-side board reports no portal drift.
