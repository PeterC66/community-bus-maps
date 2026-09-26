---
date: 2026-09-26
title: "Railway stations can be switched on as a landmark, like pubs"
---

- **Re-vendored `engine/poi_select.js`, `engine/icons.js` and `engine/services_panel.js` from the claude-skills pull request for buses-data OA-453.** No map could mark a railway station, so St Neots East named its station with a hand-pinned note. A map can now carry `poi.include: ["stations"]`: a station or halt (not a miniature park railway) draws as a train-front symbol with its name, and the Key gains a *Railway station* row after the pub's. Like pubs, it is off unless a map asks for it, and a nameless station is offered in the landmark chooser but not drawn. No committed map or portal fixture asks for it, so every sheet is byte-identical.
- **The landmark chooser names the new category** (*Railway stations*, and *railway station* for an unnamed row), and the FAQ lists stations beside pubs and allotments as a category a map can switch on.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It carries only the re-vendor, the chooser's two labels, one FAQ sentence and this entry. No schema or route changes. The deploy's own step 5b tracks the live store to the new engine.
