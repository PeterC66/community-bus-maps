---
date: 2026-10-13
title: "The home page shows High Wycombe's town-centre map beside the town map"
---

- **The "Does it work on a big town?" section now shows both High Wycombe maps.** The area map stays on top, and the town-centre close-up (`/m/high-wycombe-town-centre`, published 2 October) sits under it in the same card, linking to its live page. A new paragraph explains why there are two: one of the remedies that brought the town map from RED to GREEN stops routes at the edge of a town-centre box, and the centre map is what fills that box.
- **A fallback image for it.** `public/examples/highwycombe-towncentre-place-internal.jpg` is the live preview of map version 1.2 as served on 13 October. `live-examples.js` uses it if the live preview cannot be fetched, as it does for the other example images.
- **Why.** Peter asked on 13 October whether the centre map should sit beside the wider map now that it exists (buses-data `adhoc/done/both-high-wycombe.md`).
