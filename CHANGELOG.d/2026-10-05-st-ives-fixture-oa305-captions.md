---
date: 2026-10-05
title: "The St Ives test fixture is restaged with the external legend's local-loops caption"
---

- **Re-vendors the St Ives area fixture from buses-data v6.95 (engine a79ac84559, OA-305 captions), #481.** `gate-fixtures/Areas/_portal-fixture/St Ives/` is restaged from S5 v6.95_2026-10-05_0430: `internal.svg`, `internal-schematic.svg`, `external.svg`, `routes.json`, `gen_internal.js`, `gen_external.js` and `build-meta.json`. The place fixtures were already current.
- **What changed in the engine.** buses-data adopted engine a79ac84559, and the external legend now carries the `localLoops` caption (OA-305). That is why the St Ives bytes moved.
- **What a customer sees.** Nothing yet. The fixture is the portal's own regression sample, not a published map. `verify:area` passed with all three sheets byte-identical, SVG and JPG, and `verify:defaults` passed.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries only this entry on top of #481. No schema, route or UI change.
