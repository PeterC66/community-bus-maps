---
date: 2026-09-30
title: "A \"to X\" caption no longer prints over its own route badge, and its leader leaves the nearest badge"
---

- **Re-vendors `engine/labeller.js` and `engine/place/gen_internal.js` from PeterC66/claude-skills#251 (buses-data OA-302).** On an internal sheet a terminus caption such as "to Leighton Bromswold" may no longer sit over the route badges it names, and its leader line now starts at the rim of the badge nearest the caption instead of the middle of the badge row, so it is not drawn across a sibling badge's number. Other leaders are unchanged, and no label is lost or gained on any sheet measured.
- **The place gate fixture is recut on the branch engine.** High Wycombe Aldi's internal and schematic sheets were recut with `scripts/refresh-place-fixture.mjs` and vendored with `npm run fixtures:vendor -- --apply`; each keeps exactly the same labels. The St Ives area pack and High Wycombe High Street's boarding sheet are unchanged. `npm run verify` passes locally.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. A map sheet drawn with the vendored engine may place a destination caption and its leader slightly differently beside its badges; no schema, route or UI change.
