---
date: 2026-10-13
title: "NOTIFICATIONS_PAUSED: pause the five customer emails without stopping sign-in"
---

- **One setting pauses the customer notifications.** With `NOTIFICATIONS_PAUSED` set in the host `.env` (by convention to the date the pause began, e.g. `2026-10-13`), `notify()` in `src/email/notify.js` sends none of the five: update ready, published, sent back, and the update-ready and published digests. Publishing, sending back and staging carry on exactly as before, and customers see every change when they sign in. Blank or `0` is off.
- **Sign-in is untouched.** Sign-in links, invitations and the adviser letter go through `sendMagicLink()`, not `notify()`. Blanking `EMAIL_PROVIDER`, the only switch there was, would have stopped those too, and with them every sign-in.
- **What was not sent is recorded, not queued.** Each held-back notification is an audit row, action `notify.paused`, with the kind, customer, maps, subject and recipient count (no addresses). Nothing is replayed when the pause lifts, because a "your map was published" email weeks late misleads more than it informs. The person lifting the pause decides who to tell, from that list.
- **It cannot be forgotten.** While it is on, the admin worklist carries a "Customer notifications are paused (since …)" row listing what was held back, and `/health?deep=1` reports `checks.notifications` with `paused` and `since`. It is never a failure there, since that probe drives the uptime alert. `propose-update.mjs` and `notify-update-round.mjs` say so in their output.
- **Why.** Peter asked on 2026-10-13 to pause customer email for some weeks while how BusMaps.uk operates is reviewed, and to keep being able to sign in and out. `scripts/test-notifications-paused.mjs` counts attempted sends offline (a provider with no key throws on each attempt, and the throws are counted), was seen red with the check removed, and proves sign-in and invitations are still attempted while paused.
