---
date: 2026-10-01
title: "A delivery refuses a host whose engine lags origin/main"
---

- **`npm run deliver` gains step 0d, which refuses when the live host's `engine/` differs from origin/main and names `npm run deploy`.** On 2026-10-01 every St Neots delivery died at step 2 with `Cannot find module '/app/engine/legend_key.js'`: the host was at a96a758 while origin/main f5d1d91 had re-vendored `legend_key.js` and `place_pointer.js` (#452, #455), and step 2 verifies with the host's engine. Deploying first fixed it, and all five deliveries then passed byte-identical; nothing had asked the question before the scp. Step 0d fetches origin/main, reads the host's HEAD with one ssh `git rev-parse HEAD`, and diffs `engine/` between the two in `scripts/lib/engine-live.mjs`, before anything is uploaded. It runs on `--dry-run` too. A HEAD it cannot read refuses as CANNOT TELL; `--engine-unchecked "<reason>"` is the one-off escape hatch.
- **Seen red before relied on.** `scripts/test-engine-live.mjs` replays the incident against this repository's own a96a758 and f5d1d91 and requires `legend_key.js` and `place_pointer.js` to be named; `scripts/prove-red-engine-live.mjs` breaks the gate five ways and each arm goes red for its reason.
- **What a customer sees.** Nothing. The script runs on the laptop; no image, sheet or page changes.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live.
