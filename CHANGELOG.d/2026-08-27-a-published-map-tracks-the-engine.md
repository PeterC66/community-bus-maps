---
date: 2026-08-27
title: "A published map tracks the engine now, and one command is what makes that true"
---

- **`npm run track:engine` is the new last step of the engine hand-off.** A map's data pack carries its own copy of `gen_internal.js`, and `generateSvg()` runs *that* copy — `path.join(dataDir, generator)`, with no fallback to `engine/` — so until now an engine fix did not reach a published map at all until somebody re-imported it. Measured 2026-08-27, the stored packs were **1,383 lines behind** the vendored engine and required eleven modules they do not mention, which happen to resolve only because `SKILL_ASSETS` points at `engine/`.
- **The decision was freeze-or-track (OA-130), and the answer is track.** Freezing would guarantee that a published map re-renders identically for its whole life; tracking means one fix reaches every map. The script reports which packs are behind and **exits non-zero when any is**, so it is a check as much as a report — a re-vendor that forgets the step fails it. `--apply` brings them forward.
- **It never re-renders, which is the whole safety of it.** Stored SVGs and JPGs are untouched, so nothing a member of the public can see changes on the day it runs; what changes is the NEXT render of each map — a preview, an accepted proposed update, a re-publish. Proven rather than assumed: after applying it, two maps were rendered straight through `generateSvg()` and both wrote a sheet, resolving all eleven modules out of `engine/`.
- **An area pack's `gen_external.js` is skipped and reported, not guessed at.** It was copied from either `gen_external_radial.js` or `gen_external_busway.js` and the pack does not record which. Re-import such a map to move it forward.
