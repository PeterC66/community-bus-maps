---
date: 2026-09-21
title: "OA-039 C3/C4 — which document wins, and whether a second operator could run this"
---

Documentation only; no code, no schema, no deploy.

- **C3 — [H1 §7a](docs/H1-operations-handbook.md#7a-which-document-wins-when-two-disagree).** §7's index says where a document lives; §7a says which one is right when two of them disagree about the same question, and states the standing rule the estate already practised without naming: the later dated document wins, and says what it replaced, rather than leaving the older text to quietly disagree — the pattern H1 §2's vocabulary correction and H2's own self-deferral line ("they're right and this page is stale") already followed.
- **C4 — [H3, a new document](docs/H3-second-operator-drill.md).** DEPLOY.md already documents the deploy/backup/restore procedure at length; what it cannot answer is whether a second operator could get far enough to run it. H3 separates the two questions, and is honest that the access half — GitHub, the VPS, DNS, the password manager, the `.env` secrets — is written down nowhere, because the service currently has exactly one person who could answer any of it. That is stated as the finding rather than smoothed over: this is **not** a claim that a second operator has been proven, only that the gap is now named rather than assumed away.
- Both items are `technical-audit_2026-08-19`'s C3 and C4, carried forward in `buses-data` OA-039 (the row's O1 (b), a third-party uptime-monitor signup, remains Peter's and is untouched).
