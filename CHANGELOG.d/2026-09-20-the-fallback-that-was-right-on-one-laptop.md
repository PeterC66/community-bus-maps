---
date: 2026-09-20
title: "The engine's module resolver no longer falls back to whatever engine is installed on the machine — the arm that drew eight hybrid sheets, and the reason a green test could never see it"
---

- **`engine/engine_paths.js` re-vendored: its last-resort arm refuses instead of answering.** The resolver had four arms — a sibling, `SKILL_ASSETS`, the place skill's way across, and then a hard-coded path to the engine **installed on one laptop**. That fourth arm is how eight hybrid sheets reached `main` in September: `rollout.js` copied a generator into a scratch folder without naming an engine, every shared module resolved to the install rather than to the engine being rolled out, and the sheet was stamped with the rolling engine's hash. One build drew two sheets from two different engines using the same generator file. Upstream [claude-skills#64](https://github.com/PeterC66/claude-skills/pull/64); buses-data OA-342 item 5.

- **Nothing here changes, and that is measured rather than argued.** `renderMap.js` always passes `SKILL_ASSETS` pointing at `engine/`, so the refused arm is unreachable from this repository. `scripts/test-engine-selfsufficient.mjs` does not take that on trust: it runs all three sheet generators against a fixture and lists every module each one loaded — **34 loads across `internal`, `external` and `internal-schematic`, every one of them from `engine/` or the map's own data pack, and none from anywhere else**.

- **Why a year of green runs could not see it.** On the laptop where the engine is installed, the fallback path and the engine under test are the *same folder*, so an assertion about which of them answered is vacuous there — the latent hybrid `gate_lib.js`'s own OA-232 comment names. The test that covered this arm was green and empty. An assertion that the arm **throws** is vacuous nowhere, which is why it became a refusal rather than a warning, and the arm was instrumented and the whole engine suite run from a worktree before it was removed: 1001 tests, three callers reached it, and all three were the tests that exist to exercise it.

- **What it owes and does not create.** `engine/` has moved, so the live map store falls one file further behind until `npm run track:engine` is run against the host — the condition already outstanding from the pubs re-vendor, with a second file added to it.
