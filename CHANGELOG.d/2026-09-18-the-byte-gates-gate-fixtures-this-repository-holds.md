---
date: 2026-09-18
title: "The byte gates run against fixtures this repository holds, so verify needs no credential and no second checkout"
---

- **`verify.yml` no longer clones `PeterC66/buses-data`, and names no secret** (buses-data OA-398, R5 of the process review of 2026-09-17). It cloned that private repository with `CROSS_REPO_PAT2` to read two fixture packs. **That token expires on 22 November 2026**, and because this repository requires the `verify` check and does not allow bypassing, its expiry would have blocked every pull request here outright until somebody turned branch protection off. Renewing it bought one more year of the same cliff.

- **The packs are vendored, at [`gate-fixtures/`](../gate-fixtures/README.md)** — one town (St Ives) and two places (High Wycombe Aldi, High Wycombe High Street), 73 files and 4.2 MB. `scripts/lib/fixtures.mjs` looks there FIRST, ahead of `BUSES_DIR` and the side-by-side guesses, so the laptop and CI gate the same bytes; a fallback would have left one command giving two answers, which is a fault this very file already carries a scar of.

- **A verdict here is now about ONE commit.** The fixture checkout named no `ref:`, so `verify` measured whatever `buses-data`'s `main` held the minute it ran. That produced a truthful red on PR #107 and — in the direction that matters — a false GREEN whenever `buses-data` was ahead of what the commit was written against, which is precisely the state a real drift would have had to be noticed through. The step that named two SHAs now names one and says why there is no second.

- **Nothing was dropped to get there, and two checks moved house.** Whether the vendored copy is still in step with `buses-data` is asked by `npm run fixtures:vendor` — read-only by default, `--apply` to re-vendor — from the laptop and from `buses-data`'s own gates workflow, which clones this public repository for nothing. The same is true of `npm run sync:directory -- --check`, which compared the vendored bus-map directory against its source and could only ever run in the one job with a `buses-data` checkout. Both now run in the suite that fires when their SUBJECT changes.

- **Proved, not assumed.** `scripts/prove-red-vendored-fixtures.mjs` runs in `npm test`: it builds both trees in the temp directory and requires the freshness check to go red on a changed byte, an unvendored file and an orphan; to stay GREEN on the two deliberate exclusions — the JPGs and markdown — which is the half that can go wrong quietly; and to exit 2 rather than 1 when there is no source, because *could not look* reported as a finding is one of the estate's named failure shapes.

- **One surprise worth the line.** The first vendoring reported 15 files as `differs` for ever. `core.autocrlf=true` on the laptop means `buses-data`'s working tree holds CRLF where git stores LF, while this repository's `.gitattributes` checks the same bytes out as LF — so a straight byte comparison between two working trees was measuring a newline. The copy is now written as LF and both sides are normalised before the question is asked.
