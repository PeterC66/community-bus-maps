---
date: 2026-09-25
title: "create-admin can say what it would do first"
---

- **`scripts/create-admin.mjs` takes `--dry-run` (buses-data OA-228).** It writes to the live store and had no way to show its plan first. It now reads `confirm('remote')` from `scripts/lib/cli.mjs`, the vocabulary `docs/CONVENTIONS.md` gives a script that reaches the live store: the default is unchanged and still creates the admin, and `--dry-run` prints `would create admin: <email>` and writes no user row. It is the first caller `confirm()` has had outside its own tests. A missing `--email` now exits 2 (used wrongly), the house code, where it exited 1. New `scripts/test-create-admin.mjs` (`npm run test:create-admin`) runs the script against a throwaway database and reads the user table back after each run; against the old script it fails 6 of its 11 checks.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. The server does not import `create-admin.mjs`, so nothing a visitor or a customer sees changes: no schema, route, UI or engine change.
