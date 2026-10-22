---
date: 2026-10-22
title: "The pilot banner says replies may be slower until late November"
---

- **A temporary line in the pilot banner, on every page: "Replies may be slower than usual until late November."** Peter is away from 25 October to 22 November 2026 and will read email only occasionally (buses-data OA-494 (a), his wording of 22 October). The words live in a new `PILOT.notice` field in `src/config.js`, and `/js/site-banner.js` shows them beside the headline rather than inside `.pilot-more`, which phones hide, so a phone reader sees them too.
- **What a customer sees.** One extra sentence in the amber banner. No route, schema or form changes; the contact form and map-page forms still deliver as before.
- **Taking it off.** Set `PILOT.notice` to an empty string and the banner returns to what it was; OA-494 (d) does that by a pull request on 22 November. `scripts/test-public-plugin.mjs` checks the notice is served outside `.pilot-more` whenever one is set.
