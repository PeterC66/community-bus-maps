---
date: 2026-09-27
title: "publish-baseline can say what it would publish first"
---

- **`scripts/publish-baseline.mjs` takes `--dry-run` (buses-data OA-228).** It moves a map's published pointer through the P4 gate — a publish request, the version's state, the pointer, the map's status, two audit rows and the place-name sidecar — and with `--all-drafts` it does that to every draft at once, with no way to show which maps first. It now reads `confirm('remote')` from `scripts/lib/cli.mjs`: the default is unchanged, and `--dry-run` prints `would publish <slug> v1.0` for each map it would have published and writes no row and no file. New `scripts/test-publish-baseline.mjs` (`npm run test:publish-baseline`) counts the rows of every table in a throwaway store before and after each run and checks for the sidecar, with a real run as the control; against the old script it fails 10 of its 17 checks. [R1](docs/R1-create-map.md) names the flag where it gives the command. The fifth of the nine scripts OA-228 lists; one pull request each.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. The server does not import `publish-baseline.mjs`, so nothing a visitor or a customer sees changes: no schema, route, UI or engine change.
