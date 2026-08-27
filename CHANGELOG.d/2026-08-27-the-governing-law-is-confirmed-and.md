---
date: 2026-08-27
title: "The governing law is confirmed, and the placeholder comes off the live page"
---

- **`public/terms.html` no longer renders `[To confirm.]` next to its governing-law clause.** Peter confirmed on 2026-08-27 that the law of England and Wales is right, so the bracketed editorial note has been removed. The clause itself is unchanged — only the note goes. It had been published since the page was written on 2026-07-25 and visible to search engines since indexing was split from pilot mode on 2026-08-21.
- **It was the last one.** Every `*.html` in `public/` was swept for `[To confirm.`, `[TBC` and `[TODO` before and after: this was the only bracketed placeholder in the shopfront, and there are now none.
- **The page-level caveat deliberately stays.** `terms.html:35` still reads *"Working draft — last reviewed 25 July 2026; to be confirmed before the service opens publicly"*, because the other half of the gate is still open: the customer agreement is a non-lawyer draft and has never had a legal review. The "last reviewed" date is also left alone — no review has happened, and moving that date would say one had.
- **`OA-138` in `buses-data` stays open** for the legal review, narrowed to that. It is still what has to close before `docs/DOCUMENTATION-PLAN.md` can be archived.
