---
date: 2026-08-27
title: "The Services panel becomes a module of its own, and an entire layout turns out to be drawn by nobody"
---

`Development Docs/open-actions.md` in `buses-data`, OA-129 Phase 3, extraction 9.

- **`engine/place/gen_internal.js` is re-vendored 3,454 → 2,873 lines**, and `engine/services_panel.js` joins it at the engine root: the sheet's whole right-hand column — the Services list in its four layouts, the pictogram Key, the frequency-tier rows and the fare note. 598 lines moved verbatim. Across the phase the generator is down 3,933 → 2,873, a 27% cut. All 74 sheet verdicts on the skills-side board are byte-identical, and so are an `EDITOR_KEYS=1` render, its `data-kind` count, the exit status and the normalised stderr on all 20 maps.
- **The module returns nothing, which was measured rather than assumed.** Every one of the thirty-odd names the block declares was checked for a use below it and not one has one, so the interface is 26 inputs and no outputs at all.
- **`design.panelCols` is an entire list layout that no committed map draws.** Instrumenting the module and rendering all 18 maps with an internal sheet put nine of its 35 branches at zero, and that whole layout — with three guards of its own — is one of them: High Wycombe is the only town carrying a `panelCols` block and it sets `panelCorridors` too, which wins the if/else, so only its `panelCols.keyAt` has ever been read. Also dark: the entire `design.panelScale` opt-out, the fare note, `keyCols:1`, `footerSafe:false`, and three of the corridor note's four forms. Nineteen new unit tests cover exactly those, and 16 new mutations prove all nineteen can go red.
- **The require scan fired again on a real new module.** `gen_internal.js` was deliberately copied across before the manifest row was written, and `npm run vendor:engine` refused with `services_panel.js UNRESOLVED required through SKILL_ASSETS by place/gen_internal.js`. Thirty seconds, and it is the only way to watch that guard work on something other than a fixture.
- No new SVG element or attribute, so `src/public/svgSanitise.js` is untouched: an extraction draws exactly what it drew. `npm test` is green and the skills-side board reports all 25 engine files in sync, exit 0.
