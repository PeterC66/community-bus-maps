---
date: 2026-09-02
title: "DEPLOY.md §4a: a re-vendor is not finished until the LIVE store is tracked, and the live number is not the laptop's"
---

Documentation only — no code change. Written the day it cost something: deploying `a65d9a7` (the OA-224 Tier 3.4/3.5 re-vendor) and then reading the laptop's `track:engine` report.

- **The trap, measured.** A delivered map's pack carries its own copy of the generators and `generateSvg()` runs that copy, so a re-vendor reaches `engine/` and not the maps already in the portal — OA-130's *track, not freeze*, and `scripts/track-engine.mjs` is what closes it. The script's store comes from `MAPS_DIR` ← `DATA_DIR`, which on the laptop is the **dev** store: a different set of maps. After the deploy the laptop reported *3 already current, 10 BEHIND* and the live store reported **10 already current, 36 BEHIND**. Applying it on the laptop and stopping there would have left 36 live packs frozen at the generator they were imported with, with every local signal green.
- **§4a now says where to run it, in full, with the report-then-apply-then-re-read sequence**, and names the state to finish on: `0 BEHIND, 0 skipped`. A `skipped` pack is one whose `engine-source.json` does not record which external generator it was built from; it is skipped rather than guessed, because overwriting a busway map with the radial generator is a silent corruption found at the next render (OA-143).
- **And it records that `check:vendored --skills` answers about the DISK, not the commit.** It compares `engine/` against a skill working tree, so in a shared checkout another session's uncommitted edits read as `DRIFTED` on files your deploy never touched. Four did on the day, and all four matched the skills tree at `HEAD` byte-for-byte. Compare against `git show HEAD:<path>` before believing a drift row.
