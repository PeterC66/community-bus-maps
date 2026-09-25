---
date: 2026-09-25
title: "A delivery round can end in one update email per customer"
---

- **A round of map updates can now be announced in one email per customer instead of one per map (buses-data OA-152).** Staging each map with `propose-update.mjs --no-notify` and then calling `POST /api/admin/notify-update-ready-batch` with the proposed-update ids the round staged sends one *N map updates ready* digest to each customer, listing every map with its link and what changed. On 2026-08-28 one round put 18 near-identical notices in one inbox.
- **The server groups, and only the ids it is given.** `updateRoundDigests()` in `src/email/notify.js` reads the pending proposed-update queue, keeps the ids named, and groups them by customer, so the wording and the recipient lookup stay in one place. An update still pending from an earlier round was already announced and is not swept up; an id that is not pending is reported back as `skipped`. `listPendingProposedUpdates()` now selects `customer_id` for this. The call is recorded in the audit trail.
- **Tested and proven red.** `npm run test:notify` checks the digest's wording and that a round of four updates for two customers makes two digests, three maps in one, with an earlier pending update left out. Removing the id filter turns four of those checks red. `scripts/route-table.json` records the new route.
- **Nothing calls it yet.** The delivery path still sends one email per map unless `--no-notify` is given; wiring the round's flush into `deliver` is what is left of OA-152.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It adds one admin route, one email wording and one column to an admin query. No schema, engine or rendered-sheet change, so `verify:area` and `verify:place` do not move, and no customer is emailed by the deploy itself.
