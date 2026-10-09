---
date: 2026-10-09
title: "Two patch bumps, a restaged St Ives fixture and a re-stamped R4 go live together"
---

- **`@fastify/static` 10.1.4 to 10.1.5 and `sharp` 0.35.4 to 0.35.5, #483.** The Dependabot "routine" group: two patch-level bumps of production dependencies, in `package.json` and `package-lock.json` only. The server installs them at deploy. CI passed on the pull request, and no application code changed.
- **The St Ives area fixture is restaged with the Dial-a-Ride (FACT) note, #485.** `gate-fixtures/Areas/_portal-fixture/St Ives/` is restaged from buses-data St Ives v7.0 (OA-484): `build-meta.json`, `external.svg`, `internal.svg`, `internal-schematic.svg` and `routes.json`. The generators did not change; what moved the bytes is St Ives' own config, a `mapNotes` block carrying the register's Dial-a-Ride `sheetLine` (SF-011), now on both internal sheets. `verify:area` and `verify:defaults` passed. The fixture is the portal's own regression sample, not a published map.
- **`docs/R4-update-cycle.md` is re-stamped, #489.** The committed docstamp (v1.13) no longer matched the content after the OA-611 rebase and turned buses-data's `gates.yml` red; it is now v1.14, 9 October 2026. Documentation only.
- **What a customer sees.** Nothing: no schema, route or UI change, and the fixture is not a published map. The one thing on the server that moves is the two dependency versions.
- **Deploy history, written before the deploy per [DEPLOY §3b](../docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries only this entry on top of #483, #485 and #489.
