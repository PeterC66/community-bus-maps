---
date: 2026-10-05
title: "A build writes the panel's \"some via\" words to a file the portal can copy"
---

- **Re-vendors `engine/services_panel.js` and `engine/engine_paths.js` from claude-skills #302 (buses-data OA-529, fix 1 engine half).** `engine/vendored.json` is restamped.
- **What changed in the engine.** A build now writes `minority.json` beside `internal.svg`: for each route whose drawn line leaves out a minority working, the words the sheet's Services panel prints ("some journeys via Eynesbury") and the short form it falls back to. It is removed again when a rebuild has nothing to say. No sheet changes.
- **What a customer sees.** Nothing yet. The portal does not read the file until its services text is changed to copy it, which needs each map rebuilt first.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live, and it carries the previous re-vendor (#479, merged and not yet deployed) with it. It carries only the re-vendor and this entry. No schema, route or UI change, and no sheet changes, so `verify:area` and `verify:place` do not move.
