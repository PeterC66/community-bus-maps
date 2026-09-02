---
date: 2026-09-02
title: "Four fast-uri advisories, two patch bumps, and nothing else in the lockfile"
---

`npm audit --omit=dev` went from clean to **1 high** during the afternoon of 2026-09-02 — `main` was green at 16:06 and the next PR's `audit` job was red — because four advisories were published against `fast-uri`, which arrives here only as a transitive dependency of Fastify and its JSON serialiser. Two are host confusion (skipped IDN canonicalisation on scheme-relative references; percent-encoded scheme normalisation) and two are SSRF (malformed IPv6 normalisation; repeated hostname percent-decoding).

- **`npm audit fix` was the whole fix**: `fast-uri` 3.1.5 → 3.1.7 and the nested copy under `fast-json-stringify` 4.1.2 → 4.1.4. Two patch versions, six lines of `package-lock.json`, and **nothing else in the lockfile** — no `package.json` change, no direct dependency touched, `effects: []` on the advisory so nothing had to be re-resolved around it. `npm audit --omit=dev` now reports 0 vulnerabilities.
- **It is its own PR on purpose.** It was found because it reddened an unrelated refactor's `audit` job, and a dependency bump riding inside a refactor is a change nobody reviews as a dependency bump. This one lands first so that the refactor's post-merge run is green for its own reasons.
- `npm test` 46 run, 0 failed, 2 excluded — unchanged, which is what a patch bump of a URI parser two levels down ought to look like.
