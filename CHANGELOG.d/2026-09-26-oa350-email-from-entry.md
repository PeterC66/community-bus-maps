---
date: 2026-09-26
title: "The deploy history no longer says the sign-in sender is a bare address"
---

- **The `8493db1` (#277) entry in `docs/DEPLOY.md` now says its `EMAIL_FROM` recommendation was acted on the same day (buses-data OA-350).** The entry closed by saying `EMAIL_FROM` was a bare address and should be given a name. Peter did that on 12 September 2026, but nothing recorded it, and on 14 September a session read the entry as a description of the host and weakened a correct sentence in a letter to a member of the public. The entry now gives the date and points to `checks.email.from` on `/health?deep=1`, available since #299, as the only source for the live value. It does not copy the value, so the entry cannot go stale the same way again.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It changes documentation only: no schema, route, engine or stored-sheet changes. The only §3a reading that can see it is `X-App-Version`, which must move from `0.10.0-pilot+ac1e1a5` to the merge.
