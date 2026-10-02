---
date: 2026-10-02
title: "A map can carry a description of its own"
---

- **`map.description`, a nullable column, `SCHEMA_VERSION` 5 → 6 (buses-data OA-545).** One or two sentences about one map, up to 400 characters, cleaned by `src/maps/description.js` (control characters and runs of space collapse, angle brackets are dropped). Additive: a v5 release opens a v6 database and ignores the column.
- **Set it in the editor.** A *Description* panel on the map editor, saved by `PATCH /api/maps/:id/description` to the owning customer or an admin, cleared by an empty body, audited as `description.update`. It is not part of a version, so it shows on the public page at once.
- **What a reader sees.** The sentence appears under the title on `/m/<slug>`, and is that page's `<meta>` description, Open Graph description and JSON-LD description in place of the generated "Bus maps published by …". A map without one reads exactly as before. The public listing (`/api/public/maps`) carries it.
- **Why.** High Wycombe has a whole-town map and a town-centre close-up, and each needs a sentence pointing at the other. An organisation's `blurb` is shared by every map it owns and cannot do it.
- **Test.** `npm run test:map-description` covers the cleaner, a database that predates the column gaining it on open, the round trip and the wiring. It was seen to fail with the migration removed.
- **Not deployed by this change.** A deploy runs `npm run deploy` after the merge; the two High Wycombe sentences are then entered in the editor.
