---
date: 2026-10-12
title: "The engine's gen_external_radial.js is re-vendored for design.howToUse.fit"
---

- **Re-vendors `engine/area/gen_external_radial.js` for claude-skills#345 (buses-data OA-437, A1 slice 3), #494.** The file is copied byte-for-byte from the merged engine and `engine/vendored.json` is restamped (`a7bd167c6e15` to `0680f7772aef`). The change is `design.howToUse.fit`: a help panel that has no clear ground is narrowed instead of overlapping what is there.
- **What a customer sees.** Nothing. No published map sets the key, and `npm run verify:area` passed with all three shipped SVGs byte-identical under the new file; `npm run fixtures:vendor` found every gate fixture already in step with buses-data, so none was recut.
- **Merge order.** claude-skills#345 could not go green first: its `status` check reads a re-vendor branch older than 12 hours as drift, and this branch was 14 hours old. This pull request merged first and #345 followed within minutes.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries #494 (this re-vendor), #495 (the To-do list's Open buttons open the tab they name, entry `2026-10-12-admin-tab-links`) and #493 (entry `2026-10-11-the-sign-in-link-that-reached-the-container-log`). No schema or route change.
