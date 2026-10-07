---
date: 2026-10-07
title: "R4 describes what the portal does with a staged update, and points at the refresh playbook for the procedure"
---

- **`docs/R4-update-cycle.md` no longer carries the refresh procedure.** The rebuild, the month's ink review and the one gated delivery command are the `refresh` playbook in the `bus-work` skill (buses-data OA-588, A7 of the 2026-10-06 simplification review); R4 keeps the S6 freshness gate, what `propose-update.mjs` stages and its flags, the customer's accept, and housekeeping. `propose-update.mjs` and `npm run deliver` are named as internals of the gated command.
- **What a customer sees.** Nothing; documentation only.
