---
date: 2026-09-29
title: "The schematic and diagram workspaces copy every input by default"
---

- **Re-vendors `engine/engine_paths.js`, `engine/expert/schematize_internal.js` and `engine/expert/diagram_internal.js` from PeterC66/claude-skills#213 (buses-data OA-491).** The two pre-stage generators now call `copyWorkspaceInputs()`, so every top-level `.json` input reaches their nested workspace. Before, `journey_weights.json` was never copied, and a schematic sheet silently lost its minority note. The engine change was byte-identical on all 22 ci-references, and `verify:place` is byte-identical here (4 sheets across 2 fixtures).
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. Nothing a visitor or a customer sees changes: no schema, route, UI or ink change.
