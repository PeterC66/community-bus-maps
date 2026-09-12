---
date: 2026-09-12
title: "Sign out on the adviser page signed nobody out — and looked like it had"
---

Found by Peter, using the page as the adviser: he clicked **Sign out**, landed on the home page, went back, and was still signed in.

`views/app/adviser.html` was the only one of ten app shells not loading `/js/csrf.js`, the shim that echoes the CSRF cookie back as a header on every mutating request. Without it the logout `POST` was refused `403` by the CSRF hook — and the click handler did `await fetch(...)` and then navigated away **without reading the answer**, so the button behaved exactly like a working one. Somebody on a shared computer would have believed they had signed out.

**Why the page was written without it, which is the part worth keeping.** `scripts/test-access-model.mjs` already asserted that *every app shell loads `/js/account-guard.js`* — with a comment saying, correctly, that a list of script tags is exactly the kind of list that is right only on the day it is written. There were two such tags and only one of them was an invariant. The new shell carried the guard, because the guard was checked, and not the shim, because the shim was remembered. **An invariant beside an un-asserted twin will be met, and the twin will not.**

Both are now one loop over a list, so a third file added to that list is covered for free. Pointed at the broken shell it names it — `got ["adviser.html"]` — which is the check being seen to fail on the real fault rather than on a fixture.

The handler now reads the response and says so when a sign-out fails, rather than navigating regardless. Its failure message deliberately does **not** say "close the browser": the sign-in cookie is persistent with a seven-day sliding life, so closing the browser leaves the session open, and advice that is untrue is worse than none.

`test-adviser-seat.mjs` gains the round trip an adviser actually makes — sign out, and the session is *really* gone, with the sheet refused afterwards — plus the failure from the other side: no header, `403`, session survives. That second one is why the fix is a script tag and not a wording change.
