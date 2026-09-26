---
date: 2026-09-26
title: "The operator filter says, on hover, that readers will not see the buses it hides"
---

- **The Customers grid's *Operator filter* box now has hover text**, which was grid fault 3 of buses-data OA-363 and the one piece of that action left. It reads *Lets this organisation hide an operator in its map editor. Hiding one hides that operator's buses from their published map - readers will not see them.* It was left unwritten on 2026-09-24 because the wording waited on whether a customer who hides an operator must say so on the sheet. Peter ruled on 2026-09-26 that no note on the sheet is needed until a customer actually hides one, and that the hover text should state the consequence plainly. The box enables a feature per customer rather than hiding anything itself, so its text says what the feature lets them do and what doing it costs.
- **Each operator row in the map editor says the same thing where it happens**: *Untick to hide. Hides this operator's buses from your published map - readers will not see them.* That is Peter's sentence as he ruled it, placed on the control that actually hides an operator, where *this operator* and *your published map* are literally true.
- **No save behaviour changes.** Peter's other ruling of the same day keeps the explicit Save, so a checkbox still does nothing until Save is pressed.
- `npm run test:admin-unsaved-edits` now also checks that both hover texts are present, and both checks were seen to go red with the two source edits stashed.
