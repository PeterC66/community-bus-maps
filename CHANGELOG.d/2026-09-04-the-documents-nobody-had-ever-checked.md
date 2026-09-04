### The documents nobody had ever checked

Two checkers that had been widened eight times inside the other two repositories now read this one. `check-tables.mjs` was green on the first run — 303 rows across 17 documents in `docs/`, 11 at the root, 8 under `engine/`, and no table at all in `CHANGELOG.d/`. `check-doc-links.mjs` reported 49 findings and **19 of them were real**.

Four had rotted in place. `docs/ACCESSIBILITY.md` still pointed at `runbook-incident-response.md` and `runbook-review-and-publish.md`, renamed to `R6-` and `R3-` long enough ago that nobody remembered. `README.md` and `docs/DUMMIES_GUIDE.md` both linked to `CHANGELOG.md`, which became a generated, gitignored page **the day before** — so the two documents most likely to be read first each ended at a file that exists only on the machine that built it.

Three resolved on one laptop and nowhere else: links from the vetting policy, the onboarding runbook and the incident runbook into `../../community-bus-maps-ops/`, a tree that is not in this repository and is not meant to be. They now name the file and the folder in prose, which is what the house rule asks for.

Eleven command blocks never said which folder they run from — including the quick command reference in `docs/H1-operations-handbook.md` and five of the six blocks in `docs/R1-create-map.md`, the runbook a new operator follows first.

The other 30 findings were the checker's own and were fixed in `buses-data` (OA-227), the most interesting being a rule that read "the private ops folder is `C:\Claude\community-bus-maps-ops\`" as an instruction to run something there. `.doc-links.json` at the root is new: it declares that `CHANGELOG.d/` renders from the repository root, which is why a fragment's links resolve at all.

The checks run as their own `docs` job rather than inside `test`, because the checkers are in a private repository and the job therefore needs `CROSS_REPO_PAT2` — `test` stays in the secret-free tier it was put in on 2026-09-04. Moving the two checkers to `claude-skills`, as the hygiene checker already moved, removes the token from all three repositories; that is `buses-data` OA-246.
