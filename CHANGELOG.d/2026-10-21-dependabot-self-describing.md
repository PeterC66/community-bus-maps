---
date: 2026-10-21
title: "A routine Dependabot bump no longer needs its own deploy-history pull request"
---

- **The deploy-history check accepts a Dependabot patch or minor bump as self-describing.** `scripts/check-deploy-history.mjs` used to refuse every commit without a `CHANGELOG.d/` fragment, so each of #261, #333, #483, #497 and #507 cost a hand-written pull request whose only content restated the bump. It now lets a `dependabot[bot]` commit through on its own word when the diff, not Dependabot's message, shows only patch or minor version moves in `package.json`, `package-lock.json` or `.github/workflows/`, and it prints each bump it accepted.
- **sharp, the Dockerfile and any major still need a fragment.** A `sharp` or `@img/*` libvips move anywhere in the lockfile, any Dockerfile change and any major (a minor under 1.0.0 counts, as does a top-level install dragged up a major) is refused with the reason named. Run over the portal's nine real Dependabot commits, it would have accepted five, and refused #483 (it moved sharp's libvips), #333 (a patch that took `content-disposition` from 2 to 3) and the two `actions/*` v4 → v7 bumps.
- **What a customer sees.** Nothing: this changes a pre-deploy check and [DEPLOY §3b](../docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it), and no application code.
