---
date: 2026-09-18
title: "A map is one picture, so the site stops counting sets as maps and stops calling them sheets"
---

- **The site now says what a reader says** (buses-data OA-404, implementing the vocabulary settled that day in that repository's glossary, §1 and §12). Internally a *map* is the whole product for one place — a folder, a version, a row on the board — and a *sheet* is one printable picture. Outside the build nobody uses either word that way. **To anyone reading the site a map is ONE picture, and the several maps for one place are that place's MAP SET.**

- **The organisation page was counting sets and calling them maps.** `orgHead()` printed `${n} bus maps published by …` where `n` is a `COUNT(*)` over map ROWS, and one row is a whole place carrying up to four pictures. So a visitor read *"4 bus maps published by Love's Farm Community Association"*, opened one of the four, and found four more things each of which they would call a map. That sentence is the `<meta name="description">` a search engine indexes, which made it the version of our vocabulary most people ever met. It now names what the number actually counts: **Bus maps for 4 places**. `/m/<slug>`'s own description is plural for the same reason — the page carries the whole set.

- **The map cards said "4 sheets" and now say "4 maps."** `map-card.mjs` and `public-org.js` label each card with its output count, which is the one place on the site where the reader can see the set and its members at once.

- **"Sheet" is gone from the prose, except where it means a piece of paper.** Measured before editing: **89 uses of *sheet* a member of the public could read**, across the sixteen pages in `public/`, counting visible text only. Classified by whether a word about paper — printed, A4, download, wall, glass, laminate, 300 dpi — sat within seventy characters: **61 were our own jargon** (*the destinations sheet*, *the other three sheets*, *every sheet is checked*, *a route is on the sheet but invisible*) and **28 were the ordinary English sense**. The jargon is now *map*; the paper is untouched, because *"every map is produced as a print-ready A4 sheet at 300 dpi"* and *"if the sheet is going outside, put it behind glass"* are both better English than the substitution would have been.

- **That classification is the finding worth keeping.** A blanket `sheet` → `map` was the obvious instrument and it was the wrong one: it would have shipped *"the print map you download"* and *"put a printed map up"*, and it would have broken `<link rel="stylesheet">` on every page. The rule the glossary states is about our OUTPUT NAME, not about the word in every context.

- **The customer emails were the other half.** One of them told a customer, in terms, about *"the print-ready sheets people rely on"*. Those now say maps, the buttons say *Open the page* and *Edit the maps* rather than *the map*, and the editor's listing checkbox — quoted verbatim in one of those emails, so the two move together — says **List this place** rather than *List this map*.

- **Two tests asserted the old wording and were the oracle, so they were changed deliberately rather than relaxed.** `test-sitemap.mjs` required the description to read *One bus map*, and `test-p8a.mjs` required the empty-stand line to read *no bus on this sheet is boarded here*. Each still asserts the same substance — that the count reaches the description, that the empty stand says so in words — against the wording we now mean.

- **What was deliberately left alone.** The ops, expert and admin screens, which are ours and not a customer's; the engine's own vocabulary, where *sheet* is the unit S4 draws and S5 renders and nothing is renamed; and the `sheetBox` / `sheet-box` / `sheetHint` identifiers in `map.html`, which no reader ever sees.
