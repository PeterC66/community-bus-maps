---
date: 2026-09-22
title: "OA-432 — the stale-sibling warning stops firing on the container's filesystem root"
---

- **`warnIfStaleSibling()` now only compares inside a `<town>/S5-render/<run>` folder.** `deliver-map.mjs` mounts a staged area render at `/fixture` in a throwaway container, whose parent is `/` — every real directory under it, `/sys` included, read as "newer" than the fixture, so this printed on every area delivery (`buses-data` OA-432, filed by Peter delivering the Chatteris draft). The guard reuses `newest-render.mjs`'s `versionedRender()`, now exported, rather than a second check for the same shape.
- No map bytes move; the fix is confined to `scripts/lib/fixture-freshness.mjs` and `scripts/lib/newest-render.mjs`'s export.
- New `scripts/test-fixture-freshness.mjs` (`npm run test:fixture-freshness`): asserts a genuine stale S5-render sibling still warns, and that neither the container mount shape nor a committed `_portal-fixture` pack does.
