---
date: 2026-10-03
title: "deploy-caddy refuses from a stale checkout, and checks the live security policy value"
---

- **#465 changes the `deploy-caddy` script only, not the running site.** The script copies the LOCAL Caddyfile to the host, so a checkout behind `origin/main` put an old file on the server and the header check still passed. It now fetches first and refuses when HEAD is behind `origin/main`, failing closed if git cannot answer; `--allow-behind` overrides, and `--dry-run` and `--check` are untouched.
- **Step 3 compares the live Content-Security-Policy value** with the one in the Caddyfile, not just its presence.
- **What a visitor sees.** Nothing. This entry exists because the deploy's step 0 refuses to ship a commit described by nothing (docs/DEPLOY.md §3b), and #465 merged without one.
