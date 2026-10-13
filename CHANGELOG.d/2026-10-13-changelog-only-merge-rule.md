---
date: 2026-10-13
title: "Claude may merge its own CHANGELOG.d-only pull requests on green CI"
---

- **A standing permission in `CLAUDE.md`'s House rules, granted by Peter on 2026-10-13:** a Claude session may merge a pull request it opened when the diff touches only `CHANGELOG.d/` and every required check is green. It merges explicitly with `gh pr merge <n> --squash`, never `--auto`, and the grant covers the merge only; `docs/DEPLOY.md` still decides the deploy. Every other pull request still waits for Peter. It follows #499, #500 and #501, three round trips in one day spent waiting for a merge, the last of which changed one history fragment and nothing else. Documentation only: no code, route or schema change.
