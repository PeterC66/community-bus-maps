---
date: 2026-09-12
title: "The only thing between a real customer and \"Not published by any organisation\" was an operator remembering"
---

`0b13aed` gave the sample band a per-customer switch (buses-data OA-320), so the red band saying **Not published by any organisation** can finally come off a real organisation's sheets. It did not add the step that turns it off, and **R2 — the runbook an operator follows to accept a customer — did not mention it**.

Approve creates the customer with `is_sample` and `watermark_enabled` both defaulting to 1 and sets neither, which is right: each defaults towards the honest state rather than the confident one. The consequence is that the first genuine external organisation would have published sheets carrying that sentence directly above their own badge, and the only guard against it was an operator knowing to flip a checkbox nothing told them about. A switch with no step in the runbook is the same gap as no switch, one layer up.

**Step 2a** now says to turn *Sample maps* off, and separates the two toggles that sit side by side: the sample band is a **correctness** question and not the customer's to choose, while **Watermark downloads** is a genuine customer preference to settle with them. They are flipped at the same moment, which is not a reason to treat them as one decision.

**Two things the draft got wrong, both found by reading the code rather than the prose.**

It sent the operator to "Admin → reassign the map's owner" for sheets that already exist. There is no such control: `grep -rn "/owner" public/` returns nothing, and reassignment is an admin **API** call (`POST /api/admin/maps/<id>/owner`) documented in R1's *What-if / rollback*. A runbook naming a button that does not exist fails at the moment someone is depending on it. It also said the reconciliation "reports a failure rather than swallowing one" — true of the route, which returns `restamped: {error: true}`, but nothing renders it, so the step now says to read that object in the reply and what its error means.

**And the host path in the command was wrong in the two places that already had it.** `docs/PILOT.md` and the header of `scripts/restamp-renders.mjs` both told an operator to run the restamp from `/srv/busmaps`. That directory is not on the host and appears nowhere else in the estate: `DEPLOY.md` names `/opt/community-bus-maps` as `DEPLOY_APP_DIR` throughout, down to the systemd `WorkingDirectory`. Both are corrected here, and R2's own copy is written in the one-line `npm run ssh -- "cd … && …"` form the sibling command for `rerasterize-stored.mjs` already uses, so it is a single paste rather than an instruction plus a command.
