---
date: 2026-08-29
title: "Hiding an operator is refused before the save, not during it"
---

- **A customer who hid an operator on a map carrying a boarding plan got a hard render failure, by design (OA-011).** `gen_boarding.js` cannot honour `hiddenOperators`: the stand a destination is boarded at was decided by `boarding_index.py` across **every** route serving that stand, so filtering routes inside the generator drops destinations that are still perfectly reachable from another stand. Since 2026-08-23 it refuses under `STRICT_GUARDS` rather than half-apply it — which is the right call, and it meant the customer's save died with a generator error.
- **Rebuilding the index is a Python step the portal does not have, so the two edits are mutually exclusive — and the honest place to say so is the safe subset.** `sanitizeOverrides()` is the one gate both preview and save go through, so the customer is told while they are still looking at the map, in the `rejected` channel that already exists, instead of finding out when they press save.
- **The rejection is specific.** A recolour posted in the same save still goes through; only the operator edit is dropped, and there is one rejection rather than two. Breaking that in the harness turns the recolour assertion red.
- **It is checked AFTER the permission gate, deliberately.** A customer with the feature enabled is told the real reason — the boarding sheet — and never told they lack a permission they in fact have. Moving the check earlier makes four assertions red on exactly that confusion.
- **The editor now disables the controls and prints the reason beside them,** rather than leaving a live tick-box that cannot work. The sentence is exported from `safeSubset.js` and used in both places, so the control and the rejection cannot drift apart.
- **Read from `effectiveOutputs()`, not from the stored config.** A map can have `boarding_plan: true` on a payload with no stand register, in which case nothing renders and there is nothing to conflict with. The staged half of a monthly refresh is asked the same question about its own payload.
