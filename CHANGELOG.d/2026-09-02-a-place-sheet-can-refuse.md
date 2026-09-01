---
date: 2026-09-02
title: "A place sheet can refuse"
---

- **`engine/place/gen_external_places.js` re-vendored from claude-skills `84dc944`: the place external adopts STRICT_GUARDS.** It is the area radial's clone and never received the contract the radial took on 2026-08-28 (OA-045), so its one refusal site — the *how to read this* panel, NOT DRAWN when nowhere on the sheet is clear — wrote to stderr and exited 0, which `renderMap.js` reads only on a non-zero status. A place sheet with a silently missing panel could be published as complete. It now calls `refuse()` there with the same words and reports the refusals as an exit code, exactly as the radial does.
- **Byte-inert, and proven so before it moved.** `render_sweep.js` over all 20 maps under `STRICT_GUARDS=1` reports 0 unable to re-render, so nothing starts red; `status.js` gates every place sheet PASS; `npm run verify:place` reproduces all four fixture sheets byte-for-byte through the vendored copy; `refresh-place-fixture --check` reports the fixture unchanged. The place template hash moved (`b85ef04cfa` → `c8d9b3a1aa`) and the twelve places in buses-data took a stamp, not a rebuild (`25b937b`).
- Found by the 2026-09-01 codebase review (buses-data OA-224, Tier 1.4).
