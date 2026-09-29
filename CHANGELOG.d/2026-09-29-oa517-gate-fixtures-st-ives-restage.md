---
date: 2026-09-29
title: "The St Ives gate fixture was restaged on engine 160a199"
---

- **Re-vendors the five changed files of `gate-fixtures/Areas/_portal-fixture/St Ives` (#436, buses-data OA-517).** St Ives v6.89 was re-stamped as donor after claude-skills#228, so the fixture that `verify:area` redraws carries the current build stamp and engine fields. The diff is the stamp and the engine fields, with no ink; `verify:area` is byte-identical and `verify:defaults` passes 15/15.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** Test fixtures only: nothing a visitor or a customer sees changes, and there is no schema, route, UI or ink change.
