---
date: 2026-09-26
title: "A community or residents' association has its own box on the application form"
---

- **`public/apply.html` offers *Community, residents' or neighbourhood association* (`community-group`), above the bus-operator option (buses-data OA-359).** The first organisation ever to apply was a community association and had to choose *Something else*, even though the FAQ, the vetting policy and the non-partisan statement all name community groups as the people this is for. The kind is stored on the application and copied to `customer.type` when an application is approved, so from now on it can be counted.
- **`ORG_TYPES` in `src/http/helpers.js` accepts the new value**, and the `application.org_type` comment in `schema.sql` lists it. `org_type` is not a trigger-enforced enum, so there is no migration. Existing rows are unchanged: the first customer stays `other` until somebody edits it by hand.
- **`test-approve-application` now checks the form against the server's list.** Every option `apply.html` offers must be in `ORG_TYPES`, and a `community-group` application must approve with that kind kept. With the value taken out of `ORG_TYPES`, both assertions went red.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. There are no schema, route or engine changes.
