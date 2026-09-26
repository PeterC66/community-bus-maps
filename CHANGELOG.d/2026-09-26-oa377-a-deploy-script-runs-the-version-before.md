---
date: 2026-09-26
title: "A change to deploy.mjs is first run by the NEXT deploy"
---

- **The deploy that shipped the deploy-history check did not run it (buses-data OA-377).** `npm run deploy` runs `scripts/deploy.mjs` from the laptop's checkout, and a session moves that checkout to the new `main` only AFTER the deploy. So #387's own deploy of `68e39cb` ran the previous `deploy.mjs`, which has no step 0. Its fragment said it was the first deploy the check guarded, and that was wrong; this pull request corrects that sentence. Any change to `deploy.mjs` works the same way: nothing runs it until the deploy after the one that ships it.
- **This pull request's deploy is the first real run of step 0.** It fetches, and it must report every commit after `9db6dd3` as described: #387 adds a fragment and this merge adds this one. It then carries on to the backup.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This merge is the commit that goes live. Two `CHANGELOG.d/` files change and nothing else: no schema, route, UI or engine change.
