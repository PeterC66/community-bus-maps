---
date: 2026-09-29
title: "The St Ives gate fixture was recut on the current engine"
---

- **Re-vendors the seven files of `gate-fixtures/Areas/_portal-fixture/St Ives` from buses-data a4393a7f (buses-data OA-491, #431).** St Ives v6.88 was re-stamped as donor at the claude-skills b4f50d9 pin, so the fixture that `verify:area` redraws is the one the current engine drew. `verify:area` is byte-identical on all three sheets.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** Test fixtures only: nothing a visitor or a customer sees changes, and there is no schema, route, UI or ink change.
