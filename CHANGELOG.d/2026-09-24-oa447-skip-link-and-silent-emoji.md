---
date: 2026-09-24
title: "Every public page has a skip link, and the homepage's emoji are no longer read aloud"
---

- **Every page under `public/`, and the public 404 page, now opens with a *Skip to main content* link.** It is off screen until a keyboard focuses it, and it jumps to `<main id="main" tabindex="-1">`. Before this, a keyboard or screen-reader user had to go through the pilot banner and the whole navigation, which on a phone takes 259px of an 812px screen, before reaching any page's content. The link lives in the shared nav block in `scripts/lib/site-chrome.mjs`, and `npm run chrome:check` now also fails a page that lacks exactly one such `<main>`, so the link cannot point at nothing. The pilot banner is inserted after the skip link rather than above it, so the banner's own link does not come first (buses-data OA-447).
- **The decorative emoji carry `aria-hidden="true"`**: the eleven card icons on the homepage, the others on the opportunity and pricing pages, and the 🚌 in the logo on every page. A screen reader used to say "classical building" or "circus tent" before each card heading. Whether the emoji should be replaced altogether is a separate design question and is not changed here.
