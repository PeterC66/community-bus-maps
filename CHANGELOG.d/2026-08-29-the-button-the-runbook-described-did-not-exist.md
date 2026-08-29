---
date: 2026-08-29
title: "The button the runbook described did not exist"
---

- **`R3-review-and-publish.md` and `C1-customer-user-guide.md` both told the reader to hit **Submit for publication**, a string that has never appeared anywhere in the app.** The control is **Send ‹version› for review** — the button carries the version, so it reads *Send v11.0 for review* — with **Send for review →** on the map's guidance card. Both documents now quote the real label.
- **It cost a real operator a double-take, which is how it was found.** Publishing St Neots Town Centre v11.0, the operator was handed R3's wording as an instruction, found a button that said something else, and had to work out for himself that the two were the same step. He asked whether the button should be renamed. It should not: the app is consistent about this in five places — the button, the guidance card action, the progress-strip step *Sent for review*, the audit entry *Sent version for review*, and the accept confirmation, which points at the button by name. Only the documentation ever had a second name for it, so the documentation is what changed.
- **Swept the other nine runbooks for the same fault and found none.** Every other control-shaped phrase they quote in bold appears in the client sources. The sweep was a throwaway heuristic rather than a new gate, deliberately: it cannot tell a control from a concept (it flags *Open actions* and *Publish ≠ public*) nor resolve a label the app interpolates, and a checker that reports on prose it cannot parse is one that gets muted in its first week.
- **The durable half is a writing habit, not a tool.** Quote a UI label from the source that renders it, not from another document — the same rule the docs already follow for a command's working folder.
