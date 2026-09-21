---
date: 2026-09-10
title: "Read a commit back by content, not by its stat line — the conventions gain the half that was missing"
---

Documentation only; no code, no schema, no deploy. Third of three conventions pages to carry this rule, after `buses-data` (`d471fbe`) and `claude-skills` (`c6fef9a`), each in its own repository's words.

- **`docs/CONVENTIONS.md`, the Git section.** `git commit -- <paths>` guarantees WHICH files land and guarantees nothing about what is in them: it takes the working-tree content of those paths at COMMIT time, so anything that rewrites one of them between the review and the commit is what gets committed. The standing rule — read the staged diff as its own command — is necessary and cannot help, because it cannot see a write that happens after it runs.
- **What it cost, measured rather than argued.** In `buses-data` on 2026-09-09, commit `6c3eb15` reviewed `git diff HEAD -- <the two paths>` as its own command and read 8 insertions, 4 deletions; seventeen seconds later the commit of those exact paths printed 6 insertions, 4 deletions, and the two table rows its message describes at length are absent from the tree it made. Nothing went red — hook passed, every documentation checker green on the working tree, exit 0. The sibling JSON half DID land, so that repository's `main` named two failure shapes its own document lacked for five hours; meanwhile the orphaned file turned the shared-tree gate red and five consecutive scheduled ticks did no work at all.
- **This repository has the rewriter.** The one that ate the rows was the docstamp Stop hook, which runs at the end of a turn and rewrites a document wholesale. `stamp-policy.json` carries this repository as its `portal` root, so the hazard here is live rather than borrowed — which is why the entry says so, where the `claude-skills` one says the opposite and names the plainer hazard it does have.
- **The fix is one command after the commit**, not a new tool: `git show HEAD:<file>` grepped for the phrase the message promises. A stat line is a claim about a diff, not about a commit.
