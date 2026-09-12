---
date: 2026-09-12
title: "The local adviser's seat: a fourth role that can look at one draft and do nothing else"
---

A **local adviser** is somebody who knows a town we draw and has agreed to look at a draft before it is published. They are not a customer, they do not work for one, and until now the portal had no way to show them anything: drafts went out as attachments an admin downloaded and emailed by hand. That is what this adds — buses-data OA-154 Phase D1, which was split out of a larger plan on 2026-09-11 precisely because the *looking* half depends on nothing and the *answering* half does.

**What it is.** A fourth `user.role`, `adviser`; a `map_adviser_grant` table, one row per (map, person); sign-in through the magic link that already existed; and one page, `/app/adviser`, which shows that map's **current** version — the working head, not the published one — as inline SVG, watermarked *DRAFT — not published* and with its footer version line rewritten to say which copy it is. There are no downloads of any kind: no SVG file, no JPG, no PDF. There is no form either, because Phase D2 (answering a map's open questions in the portal) waits on the local-decisions panel, and a form that fed nothing would spend the one favour a volunteer was willing to do.

**The architectural point, which the plan named before any of this was written.** `loadOwnedMap()` grants EDIT on a map to any non-admin whose `customer_id` matches it, and never consults `role`. Attaching an adviser to an organisation by that column would therefore hand a member of the public that organisation's whole estate, its branding and its map quota. So an adviser's reach is a **grant** and their `customer_id` is NULL — refused by a database trigger (`src/db/guards.js`), not merely by a convention, because the safety of the whole seat otherwise rests on a fact that has to keep being true across every route, script and hand-run `UPDATE` there will ever be. `user.role` also joins the enum guards in `src/db/enums.js`, so the list of legal roles is now one list the database enforces rather than three copies of it.

**Asking somebody is one action.** The admin console gains an **Advisers** tab: an email address and a map create the account, grant the map and send the sign-in link together. *Stop asking* revokes the grant and keeps the row, because who was shown which draft, and when, is asked months later.

**Two markings, answering two questions.** The draft stamp says *which copy this is*, and is the same machinery an unpublished download has carried since August. The watermark is about the **screenshot**: there is no file here to forward, so the only thing that can leave the page is a picture of it, and a picture carries nothing but its own pixels.

`scripts/test-adviser-seat.mjs` pairs every refusal with a control that is allowed through — including one asserted on `loadOwnedMap()` directly, because the database makes the state that line guards unreachable, and a guard nothing can reach is a guard nothing can falsify. `scripts/prove-red-adviser-seat.mjs` breaks eleven rules one at a time and requires the assertion that claims to be about each to be the one that objects.
