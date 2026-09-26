---
date: 2026-09-26
title: "build-place-index can say what it would do first"
---

- **`scripts/build-place-index.mjs` takes `--dry-run` (buses-data OA-228).** It writes a `places.json` sidecar into every published version's folder in the live store and had no way to show its plan first. It now reads `confirm('remote')` from `scripts/lib/cli.mjs`: the default is unchanged and still writes every sidecar, and `--dry-run` prints `would index <slug> (<version>)` for each one and writes nothing. New `scripts/test-build-place-index.mjs` (`npm run test:build-place-index`) seeds one published map into a throwaway store and looks for the sidecar on disk after each run; against the old script it fails 4 of its 8 checks. The second of the nine scripts OA-228 lists; one pull request each.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. The server does not import `build-place-index.mjs`, so nothing a visitor or a customer sees changes: no schema, route, UI or engine change.
