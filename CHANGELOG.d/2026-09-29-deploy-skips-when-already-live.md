---
date: 2026-09-29
title: "The deploy command says so when there is nothing to deploy"
---

- **`npm run deploy` now compares the host's `HEAD` with `origin/main` before the backup, and stops with "nothing to deploy" when they are the same commit.** Before, it took a backup, pulled, rebuilt, restarted and sent the sign-in smoke-test email even when nothing had changed, and only said "unchanged" after the pull. The check is read-only (one `git rev-parse` over ssh). `--force` deploys anyway.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** Tooling only: nothing a visitor or a customer sees changes.
