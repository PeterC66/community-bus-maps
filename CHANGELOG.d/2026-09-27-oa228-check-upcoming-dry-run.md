---
date: 2026-09-27
title: "check-upcoming can say what it would do first"
---

- **`scripts/check-upcoming-refreshes.mjs` takes `--dry-run` (buses-data OA-228).** It writes a `refresh-flag` message into the admin inbox and a public "changes coming" banner for every map the monthly scan names, and had no way to show its plan first. It now reads `confirm('remote')` from `scripts/lib/cli.mjs`: the default is unchanged and still writes both, and `--dry-run` prints `would flag map <slug>` for each one and counts the banners it would set — leaving out a banner typed by hand, which the real run refuses to overwrite — and writes nothing. New `scripts/test-check-upcoming-refreshes.mjs` (`npm run test:check-upcoming-refreshes`) seeds two built maps and a report into a throwaway store and reads the message table and both banners back after each run; against the old script it fails 6 of its 13 checks. [R4](docs/R4-update-cycle.md) names the flag. The third of the nine scripts OA-228 lists; one pull request each.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. The server does not import `check-upcoming-refreshes.mjs`, so nothing a visitor or a customer sees changes: no schema, route, UI or engine change.
