---
date: 2026-09-06
title: "The customer guide and the update runbook catch up with the landmark work"
---

Documentation only, for buses-data OA-252 and OA-253, both deployed earlier the same day.

- **`C1-customer-user-guide.md`, the landmark paragraph.** The progress counts now sit on the buttons themselves, so the guide says so — and says the thing a customer would otherwise mistake for a fault: once you have been all the way through, *Not looked at yet* reads **0** and stays there. It is not broken, it is empty, and what fills it later is a place OpenStreetMap has added since, which makes it worth a glance after each monthly update.
- **`C1`, the monthly-update section.** A new paragraph, because accepting an update can now quietly put a new symbol on a sheet and the customer should know before they accept rather than after. It says where the new places are waiting, that answering them is a two-minute job worth doing before submitting for review, and that departures need no action at all — whatever they said about a place that has gone is kept in case it comes back.
- **`R4-update-cycle.md`, the staging step.** The diff line gains the landmarks half, and a second bullet tells whoever stages an update to **read the `new places` line before emailing anybody** — that print-out is the first sight of a surprising number, and the last moment anything can be done about it. It also says what `landmarks: NOT compared` means: the staged payload lists no POI candidates at all, which is a fault in the delivery rather than a quiet refresh. All 18 live maps yielded candidates when that was measured on the host on 2026-09-06, so it should not happen.
