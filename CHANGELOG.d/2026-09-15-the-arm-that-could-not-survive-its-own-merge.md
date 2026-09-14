---
date: 2026-09-15
title: "The arm that could not survive its own merge"
---

- **A falsification arm read `origin/main`, so merging the fix it was about turned `main` red.** `prove-red-delete-map.mjs` arm 1 proves the adviser-grant fix is a fix by fetching `scripts/delete-map.mjs` *as it was before the fix* and requiring the test to refuse it. Reading that file from `origin/main` was right on the pull request, where `main` was still the pre-fix file, and wrong eleven minutes later: the merge made `origin/main` the **fixed** file, and the arm's own guard fired — *this arm is no longer about the bug*. 90 run, 1 failed, and the one failure was the harness correctly refusing to prove nothing.

- **The guard was right and the design was wrong.** An arm asserting something about the PAST must not read a ref that moves with the present. It is now pinned to `0e08bf0`, the commit immediately before the fix landed, which is a fact about a moment and cannot move. The guard stays, inverted: if the pinned file turns out to handle grants then the pin itself is wrong, and the harness says so rather than going quietly green. `fetch-depth: 0` in `test.yml` — there since the schema-compat gate needed history — is what lets CI read an old SHA at all, and the failure message now names that dependency instead of reporting a bare git error.

- **Worth keeping beyond this harness.** A check that cannot survive its own success looks identical to a check that works, right up to the merge button; the PR was green on all four required checks. The same shape as a gate that has never been seen to go red, one turn later in the cycle.
