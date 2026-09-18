---
date: 2026-09-18
title: "The document stamp is written at commit time by the pre-commit hook, so a committed stamp describes its committed content"
---

- **`.githooks/pre-commit` now stamps the documents in the commit in front of it before it audits them** (buses-data OA-397, R4 of the process review of 2026-09-17). `docstamp.py --staged` writes the version and date into the staged copy — and into the disk copy when it matches — so the stamp that lands in git describes exactly the content that lands with it. Until now the stamp was written by a Stop hook after each Claude turn, and a document committed mid-turn went in with its previous stamp: this repository's own commit `#149` of 2026-08-29 was three documents' worth of exactly that, and *expect a stamp-only PR after editing a document* was a written rule here.

- **The audit stays, as the control that must never fire.** `check_committed_stamps.py --staged` still runs after the stamper, and a refusal from it now means the stamper did not run — the hook prints a WARNING saying why — never that somebody forgot a step, because there is no step.

- **A new `.githooks/post-commit` keeps `git status` truthful afterwards.** For a pathspec commit git writes the real index from a snapshot taken before the pre-commit hook ran, so a stamped document would otherwise read `MM` until re-added. The hook resets the committed documents' index entries to `HEAD` and touches nothing else. It is installed by the same `git config core.hooksPath .githooks` as the pre-commit hook, which every clone and worktree still opts into once.

- **Where the scripts come from.** `hooks.stampDocsPath` names the stamp-docs scripts folder and defaults to the skill tree on the machine this was written on; `hooks.stampPolicy` names a policy file for a repository the configured roots do not cover. The `--staged` mode lands with claude-skills' OA-397 branch, so this hook stamps nothing — and says so — on a machine whose engine checkout predates that merge, and the audit alone runs, exactly as before.

- **Proved, not assumed:** the mechanism in claude-skills (`stamp-docs/scripts/prove_staged.py`, 31 assertions through real hooks and real commits, with a mutation arm that removes the stamper and watches the audit refuse) and the wiring in buses-data (`.github/scripts/prove-red-stamp-at-commit.mjs`, 17 assertions against the same hook text as this one).
