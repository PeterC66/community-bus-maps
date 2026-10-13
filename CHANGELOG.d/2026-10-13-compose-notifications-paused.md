---
date: 2026-10-13
title: "NOTIFICATIONS_PAUSED reaches the container, and the compose-env check now sees reads through an env parameter"
---

- **The pause switch from #499 now reaches the portal.** The portal service has no `env_file`, so a variable in the host `.env` reaches the container only if `compose.yaml` names it. #499 added `NOTIFICATIONS_PAUSED` to `.env.example` and `src/config.js` but not to `compose.yaml`, so setting it on the host would have changed nothing while looking correct. It was caught before the deploy, on 2026-10-13, and `compose.yaml` now names it.
- **Why the check missed it, and how it is fixed.** `scripts/check-compose-env.mjs` looked only for `process.env.X`, and `src/config.js` reads through an `(env = process.env)` parameter as `env.NOTIFICATIONS_PAUSED`. The pattern now matches `env.X` with or without the `process.` prefix and skips assignments (`src/render/renderMap.js` writes `env.X = …` into the engine child's environment, which compose has no part in). A new self-test covers both. The widened check was seen red on this variable before the compose line was added.
