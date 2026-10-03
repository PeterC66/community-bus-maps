---
date: 2026-10-03
title: "The map description says when it is unsaved, and a URL in it is a link"
---

- **The description panel on a map's editor page now says when it is not saved.** Save waits until the text differs from what was saved, Clear waits until there is something to clear, and leaving the page with an unsaved description asks first — the shape the Public details page already had (buses-data OA-550).
- **Save's result is shown beside the buttons, not only at the top of the page.** The panel's count line reads *Not saved yet*, *Saving…*, *Saved · n of 400*, *Cleared* or *Not saved — try again*, because the page-top notice is out of sight when the panel is far below it.
- **A URL in the description is a link on the public page.** `busmaps.uk/m/high-wycombe-town-centre` and any `https://` address become anchors; other sites get `rel="nofollow noopener"`. The text is escaped first, so a description cannot put markup on the page, and the search-result description stays plain text. The behaviour is tested by `test:description-unsaved` (run against five deliberately broken copies, each of which must go red) and by a new section of `test:map-description`.
