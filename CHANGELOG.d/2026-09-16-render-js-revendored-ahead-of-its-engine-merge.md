---
date: 2026-09-16
title: "render.js re-vendored ahead of the engine merge that changed it"
---

- **`engine/render.js` now carries the five-line `require.main` guard from the engine branch `oa344/file-load-guarantee`, vendored from that branch rather than from `main`.** buses-data OA-344 put a load guard on 29 engine files that used to RUN when required, so that the cheapest question there is — does the file load — can be asked of them. `render.js` is the one of the 29 that the portal keeps a copy of. The guard moves no rendered byte: with no arguments it prints the same usage line and exits 1, and with two it writes the same JPG. `engine/vendored.json` is restamped from the bytes that landed.

- **The order is forced and it is the opposite of the intuitive one.** claude-skills' `status` job runs `status.js` against this repository's `main`, so the engine pull request (claude-skills #26) reads `DRIFTED render.js -> engine/render.js` and cannot merge until the portal's copy matches the branch — and the portal's copy cannot be vendored from `main` until the branch has merged. One side has to move first, and it is this one: `check-vendored.mjs --no-skills`, which is what CI runs here, verifies hashes only and does not ask whether the skill has moved on, so this change is green here while the engine branch is still open. The minutes between this merging and #26 merging are an honest red on claude-skills `main` and on buses-data's board, and nothing else.

- **`track:engine` was run and has nothing to do for this file.** `render.js` is not a generator, so no map pack carries a copy of it. The run reported five maps BEHIND on `gen_internal.js`, which is the laptop's development data and a pre-existing state unrelated to this change; the live packs are brought forward on the server, per DEPLOY.md.
