---
date: 2026-09-14
title: "The de-duplicator reaches the portal"
---

- **The vendored engine now carries the OA-338 de-duplication rule.** `poi_select.js` and `place/gen_internal.js` moved; the other 30 vendored files were already current, which is the measurement that says this is the whole of the change rather than a sweep that happened to include it. The rule it brings is that a category label is not a name: two differently-named places of one category are no longer collapsed because they are close together, so Boots survives Superdrug 24 m away, and four Wisbech Boots, five High Wycombe libraries and three museums stop being drawn as one each.

- **It reproduces the post-rollout sheets byte-for-byte, which is the only evidence worth having here.** `verify:area` regenerates the current St Ives `v6.82_2026-09-13_2026` render and matches on all three sheets — 521,491 B internal, 39,099 B external, 298,552 B schematic — and on both JPGs at 3508x2480. `verify:place` matches 4 sheets across 2 fixtures. 86 tests, 0 failed.

- **Nothing a member of the public can see changes today.** Re-vendoring copies generators; it never re-renders, so every stored SVG and JPG is untouched. What changes is the next render of each map, and only once `npm run track:engine` has been run against the live store after the deploy — that step is deliberately not in this change, because it writes data packs rather than tracked files.

- **This branch existing is a precondition for the engine change landing at all, which is the part worth writing down.** `claude-skills` PR #9 cannot merge while the portal's vendored copies read DRIFTED: `status` is a required check there, `strict` with `enforce_admins` on, and it runs `status.js` whole. That board marks a drift row `PENDING` and `inFlight` as soon as the skill's bytes are found on a *pushed* portal branch, inside a twelve-hour grace — so pushing this branch is what unblocks the engine PR, and merging it is not needed to get there. The order that follows is: this branch pushed, then PR #9 merged, then this merged and deployed, then `track:engine`.
