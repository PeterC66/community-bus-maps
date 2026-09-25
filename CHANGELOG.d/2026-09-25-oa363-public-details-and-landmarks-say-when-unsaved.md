---
date: 2026-09-25
title: "Public details and the landmark chooser say when something is not saved"
---

- **Each panel on the customer's Public details page now enables its Save only when something in it has changed**, and a reload or a closed tab asks first while either panel has changes that are not saved. Before this, both Save buttons were always enabled and nothing guarded the exit, so a new public name or a changed download setting could be walked away from in silence. It is the same shape the admin console's grids and the pin editor already follow (buses-data OA-363, item 1).
- **The landmark chooser asks before a reload or a closed tab throws its answers away.** It already said *Not saved yet*; unlike the map editor and the pin editor, it still let the page go (buses-data OA-363, item 2).
- `npm run test:branding-unsaved-edits` runs the real `branding.js` behind a small fake DOM and a stubbed server through load, edit, revert, a good save and a refused save, and checks the landmark chooser's guard. Seven broken copies must each fail, one of them the missing unload guard this change was made for.
