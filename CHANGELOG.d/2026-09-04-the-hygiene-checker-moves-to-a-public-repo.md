---
date: 2026-09-04
title: "The hygiene check reaches CI here, because the checker moved to a public repository"
---

buses-data OA-241, the second half. The BOM strip landed this morning with the guard in `.githooks/pre-commit` and **no CI step**, for a reason that was a constraint rather than a preference: `check-file-hygiene.mjs` lived in **buses-data, which is private**, and this repository is public — so a CI step would have needed `CROSS_REPO_PAT2`. Hanging a hygiene check off that token is exactly what buses-data's `docs` job was separated out to avoid, since a token expiry must not take the documentation checks down with the byte gates.

**The checker moved to `claude-skills`, which is public**, as `tools/check-file-hygiene.mjs`. So `test.yml` — already in the secret-free tier — now fetches it with `actions/checkout` and **no token at all**, sparse-checking out `tools/` alone, and runs the falsification harness before the check. All three repositories now run the same checker in CI. The direction is the point: a shared rule belongs in the repository anyone can read.

**The move forced a design change worth more than the move.** A checker three repositories run must not carry one repository's exclusion list — the shape OA-222 named, *a copy is a checker owning someone else's rule*, arrived at from the other side. So **the rule travels and the exemptions stay home**: each repository declares its own in a `.file-hygiene.json` at its root. This repository declares none and needs none — it has no generated corpus and no verbatim records, so the bare rules are right. buses-data declares five path patterns and two named files, and that declaration is load-bearing rather than decorative: measured on the day, **0 findings with it and 2,770 without**.

The harness gained four cases the move made possible, and two of them are the ones that matter — a repository with **no** declaration gets the bare rules rather than a free pass, and a declaration that **does not parse** is a refusal rather than a silent fallback to no exemptions, which would have looked exactly like a clean tree. 24 cases, every exemption class broken in both directions.

**What stays hook-only, and must not be removed for looking idle.** `actions/checkout` builds a uniform tree by construction, and the index normalises to LF the moment a file is staged — so a file with CRLF at the top and LF at the bottom produces a **clean diff** and CI sees nothing. Mixed line endings are a property of a working tree that no commit and no CI run can express. The hook is not a weaker copy of the CI step; for that half it is the only place the question can be asked at all.
