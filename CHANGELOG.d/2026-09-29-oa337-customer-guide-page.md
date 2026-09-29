---
date: 2026-09-29
title: "The customer guide has a page on the site, and the invite letter links to it"
---

- **The customer guide C1 is published at `/guide.html` (buses-data OA-337).** Until now it could be read only by being sent it: no page, route or link on the site named it. The page is generated from `docs/C1-customer-user-guide.md` by `scripts/build-guide.mjs`, so C1 stays the one copy anybody edits. The script's default mode is a check, and it runs as a preflight of `npm test`: an edit to C1 without `npm run guide:apply` goes red. C1's docstamp is left out of the page, because the pre-commit hook rewrites it after the page is built. `scripts/test-build-guide.mjs` proves both of those edits behave, and that a link into `docs/`, a dangling anchor or unbalanced emphasis is refused rather than printed wrong.
- **Every page's footer links to the guide**, and `/guide.html` is in `STATIC_PAGES`, so the sitemap and the footer agree.
- **The customer invite letter names the guide**, as a sentence before the "if you were not expecting this" paragraph, with the address derived from the sign-in link the way the stale-link sentence's is. The adviser letter does not, because the guide is for customers.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It adds one static page, a footer link on every page, and one sentence to one email: no schema, route or ink change.
