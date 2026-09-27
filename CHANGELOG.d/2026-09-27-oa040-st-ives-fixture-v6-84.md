---
date: 2026-09-27
title: "The St Ives gate fixture is re-vendored at v6.84, which names the Hemingfords on the 9's exit arrow"
---

- **Re-vendored `gate-fixtures/Areas/_portal-fixture/St Ives` from buses-data 13d19cd9, for buses-data OA-040 item 3.** St Ives was rebuilt as v6.84 in buses-data 0ec80299. The 9's exit arrow on the internal and schematic sheets now reads "to Hemingfords & Huntingdon" instead of "to Huntingdon", a config change. The pack's generators are engine d5237bbda5 in place of 3b0658bfb8. That brings in two changes that are already live in `engine/`: the Frequent key row reads "at least every 30 minutes" (OA-282), and the external arm note is one line per route (J10). Only fixture files change: seven under `gate-fixtures/`. `verify-reproduce.mjs`, run against this committed fixture with no `FIXTURE_DIR`, is byte-identical on all three sheets. Both defaults scripts pass (17 and 15 escape hatches).
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries only the fixture and this entry. No schema, route, UI or engine changes. The live St Ives map is unchanged until its customer accepts a proposed update. That update has not been staged.
