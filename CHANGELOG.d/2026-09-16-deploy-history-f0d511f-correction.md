---
date: 2026-09-16
title: "Deploy history: the second entry for f0d511f, because the read-back contradicted a claim in the first"
---

- **Everything the entry predicted held except its stated remainder.** The stamp moved to `0.10.0-pilot+f0d511f`, `check:live-routes` read 102 unchanged, and all seven zero readings went non-zero — the St Neots sheet answers `?q=Tilbrook` and `?q=Boxworth`, a shared `?q=` link now carries its own spelling correction, the no-result block says *yet* and offers a door a resident can use, and the directory rows open in a new tab as *Open their map page ↗*.

- **What was wrong: `?q=Eynesbury` returns two maps, not none.** `buildPlacesFromDir()` has two branches — an area map's `external[]` and a place map's `destinations[]` — and the entry was written from the first. St Neots Co-op and St Neots Town Centre both name Eynesbury as a destination, so the back-fill made them findable by it. The narrow claim was true (`href="/m/st-neots"` really is absent) and the entry generalised it to the whole page.

- Corrected in `docs/DEPLOY.md` rather than edited away, because a later reader using *Eynesbury returns nothing* as a control would be misled by it. What survives is the smaller statement: nothing indexes a map's **internal** sheet, so a name appearing only in `internalDesc` reaches the search only if some other pack carries it as a destination.
