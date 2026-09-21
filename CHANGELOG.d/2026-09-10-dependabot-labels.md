---
date: 2026-09-10
title: "Dependabot asked for two labels that did not exist, so every PR it raised led with an error — and one of them was the sharp fix"
---

Repository configuration and one routine bump. No application code changed.

- **`dependabot.yml` named `dependencies` and `needs-rebaseline`, and the repository had neither.** Dependabot does not create a label it is asked for — it opens the PR anyway and its **first comment is a configuration error** saying the label could not be found. So every PR that file has ever raised led with an error instead of a diff, and not one was labelled. Both labels now exist, and a note at the top of `dependabot.yml` says they have to.
- **It cost a real one.** PR #173, *"Bump sharp from 0.35.3 to 0.35.4"*, was opened on 2026-08-31 and sat unlabelled and unread for ten days, until this morning's manual upgrade auto-closed it with *"Looks like sharp is updatable in another way, so this is no longer needed."* [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) was published inside that window and turned `main` red. **The fix was on offer before the problem existed.** The detector worked perfectly and nothing brought it to a reader — the same shape as a warning written into a channel nobody opens.
- **`needs-rebaseline` was the worse of the two to be missing**, because its whole job is to stop a base-image bump looking routine in a list, and it has never once been applied. It is now on #64, along with `dependencies`.
- **#261 merged** — `fastify` 5.12.1 → 5.12.3, the routine group, six checks green. Unusually its own checks were worth reading: Dependabot cut it from `6ed3c7f`, the tip at the time, so it was behind `main` by nothing and carried `sharp@^0.35.4` already. That is the exception rather than the rule, and the standing advice to read the post-merge run is unchanged.
- **#64 stays open and is not close to mergeable.** It bumps the Dockerfile to `node:26-slim`, and `test-node-pin.mjs` fails it five ways: `package.json` `engines.node` still says `>=24`, and `audit.yml`, `render-parity.yml` and `test.yml` each install Node 24 while the image would be node:26. A base-image bump is a multi-file change and Dependabot can only do one file of it. That reasoning is now in `dependabot.yml` beside the label, so nobody has to re-derive it from a red check on a PR three weeks old.
