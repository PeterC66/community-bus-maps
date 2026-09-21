---
date: 2026-09-11
title: "What's New: the place search and the national directory — and a count in a file the copy gate could not see"
---

Two changes to `public/data/whats-new.json`, which is the whole What's New panel on the home page and at `/changelog.html`.

A new entry for the place search and the "Not ours" directory panel (#265, buses-data OA-308 tier 2): the maps page reads the places inside each map rather than only its title, and when nothing of ours matches, a second panel says what the local transport authority publishes instead, from the directory of all 76 in England. The entry says in as many words that those maps are not ours and that the date on each card is all we vouch for, because that is what the panel itself promises.

The 23 August entry introduced the boarding plan as *A fifth output* and now says *A fourth*. #264 had already fixed the two counts on the examples page and the homepage and banned `fifth sheet`, `five outputs`, `Five outputs` and `all five` — but the copy gate in `scripts/test-parked-diagram.mjs` walked `.html`, `.js` and `.css`, and this sentence lives in a `.json` the browser fetches, so it was outside the corpus rather than outside the ban. The gate now reads every hand-written `.json` under `public/data` as well, minus `bus-map-directory.json` with its reason written down: that file is a generated projection describing other people's maps, where *tube map* is a truthful name for one of them rather than a mention of our parked option. `fifth output` and `Fifth output` join the banned list, and `scripts/prove-red-parked-diagram.mjs` gained a third arm that puts the old sentence back into a scratch copy and requires the gate to name the file, the line and the phrase.
