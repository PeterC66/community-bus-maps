---
date: 2026-09-12
title: "The adviser's view called a published map a draft — the state nobody tested was the only state that existed"
---

The local adviser's seat shipped and deployed this morning, and the first thing anybody did with it was ask what its first real grantee would actually see. The answer was a lie in bold type.

A map's working head is its **published** version for as long as nobody edits it after publishing. That is true of every map on the live site, and it was true of Ramsey, the map the seat was built for. The page showed that version and said *This is **Draft 8.0** of the bus map for Ramsey*, stamped `DRAFT — not published` diagonally across artwork that is on the public site, and told a member of the public not to pass it on.

**The cause is a function that was only ever total behind a guard.** `draftLabel()` in `src/render/draftStamp.js` fell through to `Draft` for any state it did not name, which was harmless while its one caller was the per-version download route — that route asks it nothing about a published version, because it opens with `if (ver.review_state !== 'published')`. The adviser seat then called it for whatever the head happened to be. The repair is to make the function answer for `published` rather than to add a second guard at the new call site: the next caller would need the same guard and would not know it.

Three assertions of "draft" are fixed together, because they are one bug: the label, the watermark (`BusMaps.uk` on a published version, the same mark the public JPG downloads carry), and the page copy — which now says plainly that **there is no newer draft waiting**, and that when the map is rebuilt the new version will appear there before it goes out. That sentence is the one an adviser looking at a published sheet actually needs.

**Every assertion in `test-adviser-seat.mjs` passed throughout, because every one of them was about a draft.** The suite now drives the published state too, with a control that puts the version back to a draft and requires all four readings to flip — without it, a "fix" that simply deleted the draft marking would have passed. `prove-red-adviser-seat.mjs` gains three mutations, including the original fault put back, and the stale anchor it found in its own watermark mutation is what a harness that refuses to guess looks like.
