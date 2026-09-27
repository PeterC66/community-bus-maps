---
date: 2026-09-27
title: "A managed customer gets no email from the portal"
---

- **A customer whose Plan is `managed` is sent none of the five customer emails (buses-data OA-468).** `notify()` in `src/email/notify.js` returns before choosing recipients for `update-ready`, `update-ready-batch`, `published`, `published-batch` and `sent-back` when `customer.plan` reads `managed` (case and surrounding spaces ignored), and logs that Peter writes to them. `propose-update.mjs` treats a managed customer as though `--no-notify` were given and says so. Sign-in, invitation and adviser mail do not pass through `notify()` and are unchanged. Set the Plan field to `managed` on the admin Customers screen to switch a customer over. A customer on any other plan is emailed exactly as before.
- **Tests.** `test:notify` checks each of the five against a managed customer, with the same customer on plan `free` as the control. `test:propose-no-notify` stages an update for a managed customer and checks that `notify()` is never reached. With the suppression switched off, seven checks went red.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. There is no schema, route, UI or ink change.
