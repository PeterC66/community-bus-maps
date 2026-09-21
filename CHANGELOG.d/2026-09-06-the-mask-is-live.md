---
date: 2026-09-06
title: "The address mask is live on the access log, read back on the host before and after"
---

`Caddyfile` deployed for buses-data OA-086 phase 1 (#246). **The first deploy in this project's history that is a `Caddyfile` on its own**, which is exactly the asymmetry `docs/DEPLOY.md` §3a names: `npm run deploy` cannot ship this file, and `npm run deploy:caddy` cannot ship the app.

- **Read back on the host, before and after, rather than reported.** The same request was made either side of the reload. Before: `remote_ip` and `client_ip` both held `2a0a:ef40:9fa:3e01:88b8:a521:17ea:23f8`. After: **both** read `2a0a:ef40::`. The `before` line is worth as much as the `after` one — it is the only thing that shows the two fields really did both carry the address, which is the claim the two-field assertion in `scripts/test-caddyfile.mjs` rests on.
- **The OA-006 query filter survived the edit.** `uri` still reads `/maps?q=REDACTED`. That is the regression this file's own instructions exist to catch, and it is why the check is *two* things and not one.
- **The retention was read out of the RUNNING config, not inferred from `caddy validate` accepting it.** `curl -s localhost:2019/config/logging/logs/log0/writer/` on the host returns `roll_size_mb: 10, roll_keep: 10, roll_keep_days: 30` — the 30 days `/legal.html` promises the public. A rolling setting appears in no log line and in no response header, so "validate accepted it" and "it is in force" are different claims.
- **It went up from a worktree of `main`.** The laptop's checkout was on another session's branch, whose `Caddyfile` predates the merge. Deploying from whichever tree you happen to be sitting in is the same class of mistake as not deploying at all — and it would have silently *reverted* the file rather than failing.
- **Half of phase 1 is deliberately still not live.** `X-App-Version` remains `0.10.0-pilot+07d8b0a`, so the app's own request log still writes full addresses; `loggableReq()` masks them from the next ordinary `npm run deploy`. Nothing here touched the database, the object store or the container, so no backup applies.
