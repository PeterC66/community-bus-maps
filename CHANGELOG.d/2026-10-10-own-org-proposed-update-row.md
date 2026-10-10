---
date: 2026-10-10
title: "A proposed update to one of our own maps is now the operator's move on the To-do list"
---

- **The `awaiting-customer` row knows when the customer is us.** When a pending proposed update belongs to a map whose organisation has **Sample maps** on (`customer.is_sample`, read through `isSampleCustomer()`, the same "are this organisation's maps ours" rule the sheet band uses), the row now ranks 5 in *Your move*, carries `own: true`, and reads "Accept or decline your own proposed update to "<map>"". Its steps go Admin → Refreshes (the map link previews old against new, then Accept or Decline), the map page to send the accepted draft for review, and `/app/review` to approve it. It is never "Nothing for you to do", and it does not wait two weeks to become a nudge. Every other customer's row is unchanged.
- **Why.** Proposed update #171 to St Ives Bus Station (map #14) belonged to the BusMaps.uk pilot organisation and read "Waiting on BusMaps.uk pilot … Nothing for you to do unless it sits" on 2026-10-10, so it sat. The operator is that customer.
- **What stays the same, on purpose.** The row's `type` is still `awaiting-customer` and the map name is still quoted in the title, because claude-skills' bus-work reads the row back by both (`stage_refresh.mjs`) and routes it by type (`concurrency.mjs`). `listPendingProposedUpdates()` now also returns `c.is_demo` and `c.is_sample`; its other callers ignore them.
- **A real organisation left with Sample maps on** would now have its updates listed as ours to accept. That is already wrong for it today, because its sheets carry the "Not published by any organisation" band, and the flag fails towards the operator looking.
- **What a customer sees.** Nothing: the To-do list is admin-only.
