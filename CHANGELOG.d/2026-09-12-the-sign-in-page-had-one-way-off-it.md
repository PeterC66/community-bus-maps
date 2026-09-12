---
date: 2026-09-12
title: "The sign-in page offered one way off it, and it was the wrong one for two thirds of the people who land there"
---

`/app/login.html` ended with *Not a customer yet? Apply to join* and nothing else. That serves exactly one of the people who reach it.

A **local adviser** is a member of the public who will never be a customer, and telling them to apply for a bus-map service on behalf of an organisation they do not represent is worse than telling them nothing. Anybody whose sign-in link has expired — which the page itself announces, via `?error=expired` — or who is typing an address the account is not under, had **no route to a person at all**. The one audience the apply link did serve is real, so it stays; it is simply no longer the only door.

*Trouble signing in? Get in touch* now comes first, pointing at `/contact.html?kind=question`, which pre-selects on the contact form the same way the footer's *Report an issue* link already does. The contact page needed no change: its intro has always carried *"If you'd like maps of your own, the interest form is the quickest way in"*, so joining is reachable from the general door rather than the other way round.

Two smaller things in the same spirit. The intro now says **use the address your account or invitation is under**, because `/api/auth/request` answers identically whether or not an address is registered — deliberately, so nobody can probe for accounts — which means a typo is met with silence and no explanation. And the placeholder was `you@organisation.org`, which quietly tells a member of the public that this page is not for them; it is now `you@example.com`.

Deliberately no promise about how quickly anyone replies: this is a pilot, and `docs/PILOT.md`'s copy rule forbids implying a response time.

Suggested by Peter after signing in as the adviser and looking at where the page would have left him.
