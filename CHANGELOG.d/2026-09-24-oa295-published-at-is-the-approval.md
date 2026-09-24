---
date: 2026-09-24
title: "A public map's Published date is when it was approved"
---

- **`publishedAt` in `/api/public/maps`, the *Published* pill on every public map page, the map cards' *updated* date and the sitemap's `lastmod` now give the time the live version was APPROVED.** Until now they gave the time its version row was created, which is days earlier for a draft that waited: Ramsey v8.0 was created on 8 September and published on 10 September, and its page said 8 September. `PUBLIC_COLUMNS` in `src/db/index.js` now takes the latest approved `publish_request.reviewed_at` for that version, the same value the version-history query already calls `published_at`, and falls back to the version's creation time where no approved request exists, for example after a direct re-import. The field keeps its name (buses-data OA-295, decided by Peter on 2026-09-21).
- `listPublicMaps()` is now ordered by that date, as its comment always said it was. `npm run test:p6` has four new cases, including a later *rejected* request that must not move the date. Two mutations turn them red: putting back `pv.created_at` fails three, and dropping the `approved` filter fails two.
