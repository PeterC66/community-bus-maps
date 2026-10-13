---
date: 2026-10-13
title: "Choosing a route colour keeps every other route's colour in view, and warns when two are too alike"
---

- **The colour picker opens in the page.** The swatch beside each route in the map editor used to open the browser's own colour dialog, which sits over the routes list and cannot be moved, so a new colour was chosen without sight of the colours it had to differ from. It now opens a small picker directly under that route's row, with hue, strength and lightness sliders and a box for a hex code, and repeats every other route's badge underneath so they stay visible however the list is scrolled.
- **Too-close colours are flagged before saving.** Every pair of routes is compared with CIEDE2000, the standard measure of how different two colours look; a pair closer than 10 is outlined on both rows with "Close in colour to …", the picker says which routes it is too near, and Save asks once more if a colour you changed is one of them. The picker also says when the route number would be hard to read on the chosen colour.
- **Why.** Recolouring March's ZIP2, which had been too close to the 33A, was guesswork with the other colours hidden (buses-data OA-619, reported 2026-10-10).
- **A new check.** `npm run test:colour-distance` runs the editor's colour arithmetic against the published CIEDE2000 test pairs, known Lab values and the HSL round trip the sliders use, and breaks the formula six ways in copies to prove each break is caught.
- **What stays the same.** What is saved is unchanged: a route colour is still a hex value in the map's overrides, and the reset link and the server's checks work as before.
