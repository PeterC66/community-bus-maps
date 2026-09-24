---
date: 2026-09-24
title: "rotate-secret.mjs records the old secret the way Compose reads it"
---

- **The `1. before` fingerprint that `npm run rotate:secret` prints is now taken from the value Compose actually loads.** The script keeps no backup of the host's `.env`, so that fingerprint is the only record of the secret it replaces. It used to read the key with `grep | head -1` and keep any quotes, while Compose takes the last line for a repeated key and strips one pair of quotes. On a duplicated or hand-quoted key, the record described a value that was never live. Both reads of `.env` in the host script now go through `hostEnvProbe()` in `scripts/lib/host-env.mjs`, the reader the deploy already uses (buses-data OA-425).
- The host-side script moved into `scripts/lib/rotate-host-script.mjs` unchanged apart from those two reads, so a test can run it. `npm run test:rotate-secret` runs its read of the old value under a real `sh` against four fixture `.env` files and compares the fingerprint with the Compose value worked out in JavaScript. With the old read put back, the repeated, quoted fixture goes red. Nothing on the live site changes: the script runs from the laptop.
