---
date: 2026-09-26
title: "A place's destination diagram now warns when two spokes are crowded, even with spreading off"
---

- **Re-vendored `engine/place/gen_external_places.js` from the claude-skills pull request for buses-data OA-314.** The warning that two destination spokes are under 18° apart used to print only when a map had `design.spokeSpread` switched on. A map with the key off, which is the map most likely to need it, said nothing. Three Co-op sheets sat at 5° and 6° with clean build warnings. The generator now prints one warning naming the pair either way. It writes to stderr only: no bearing moves and no ink moves. Ely Co-op's external sheet is byte-identical before and after, and `verify:place` passes byte for byte on both portal place fixtures.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries only the re-vendor and this entry. No schema, route or UI changes. Because no ink moves, the delivered maps' pack copies can wait for the next `track-engine` run (the ssh step in `docs/DEPLOY.md`, which is Peter's).
