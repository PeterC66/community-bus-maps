---
date: 2026-09-13
title: "Searching \"station\" returned ten maps, and eight of them for a stop called Bus Station"
---

**A name that names no place now answers only to itself.** Eight of the estate's twenty sheets carry a stop called simply *Bus Station*, so a one-word search for *station* returned ten maps — and the name says nothing about which town, so it cannot be what anybody meant. *Bus Station*, *Railway Station* and *Business Park* are now full-match-only, the same treatment `src/search/index.js` already gives a street name: typing the whole name still finds them, typing one word of it no longer does.

**The rule this replaces was specified, measured and thrown away, and that is the useful half.** buses-data OA-311 left a residual asking for a generic-WORD rule — *hill, park, station, green, common, cross, end* match only a whole name. Run over the estate's own 363 indexed names, those seven words reach 23 distinct names and **twenty of them are genuine places**: Bar Hill, Gerrards Cross, Lane End, Bourne End, Seer Green & Jordans, Farnham Common, Austenwood Common, Science Park, Orchard Park, Axis Park, Wood Green Animal Shelter. Four of the seven — *green*, *common*, *cross*, *end* — return **nothing but** genuine places, and those four had never been measured: the rule was written from the three that had. It would have suppressed nineteen real names to remove four noisy ones, one of them a town of 8,000 people.

**So the five checks that matter in `test-search.mjs` assert a silence** — that a one-word generic query still finds a real place — and `prove-red-search.mjs` arm 7 implements the falsified rule on purpose and requires every one of them to notice. A control that asserts silence is exactly the shape that can be green for ever without ever being able to fail.

**Building that arm found a hole in the proposed rule that shipping it would have hidden.** Written where the residual describes it — in the exact pass alone — three of the four controls stayed green: the exact pass then returns nothing, `searchPlaces` falls through to the **fuzzy pass**, and the query word matches the same names at edit distance 0. The rule would have done nothing whenever no other map happened to match exactly.

**And the list is of NAMES, not of words, deliberately.** Each entry is a name a person has looked at and judged to name no place; the derivable version is the one just falsified. Arm 8 adds *Science Park* to it and requires the Science Park check to go red, which is the action's own warning — *do not demote Science Park or Heathrow Central Bus Station, which are places* — held as a test.
