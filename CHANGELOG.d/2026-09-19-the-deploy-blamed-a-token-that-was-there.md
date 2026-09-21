---
date: 2026-09-19
title: "The deploy blamed a missing token that was there, because it sourced a file that is not shell"
---

- **`npm run deploy` step 5 could not read `gitSha`, and gave the wrong reason.** It got `METRICS_TOKEN` off the host with `{ set -a; . ./.env 2>/dev/null; set +a; }`. That aborts: line 3 of the host's `.env` is `EMAIL_FROM=Peter Cooper - BusMaps.uk <info@busmaps.uk>`, which Compose reads happily and a shell cannot parse at all, because `<` is a redirection operator with a newline where a filename should be. The shell gave up there, `METRICS_TOKEN` on line 11 was never set, the `2>/dev/null` swallowed the syntax error, and the `else` arm announced *"the HOST .env has no METRICS_TOKEN"* — about a value that is present and 48 characters long in both the file and the running container. Measured on the live host on 2026-09-19, after the `503e571` deploy.

- **So the deploy has been ending without the one field it exists to read, under an explanation that was not true.** `gitSha`, `builtAt` and `checks{}` are gated behind `opsAuthorised()`, and confirming WHICH COMMIT went live is the whole purpose of that step. This is the shape the project already names *the warning about the instrument*: a check that could not run, wrapped in a sentence asserting a finding about its subject rather than about itself.

- **The fix reads `.env` with Compose's grammar instead of the shell's.** `scripts/lib/host-env.mjs` addresses the one line with `sed`, strips one matching pair of surrounding quotes and a CR, and takes the last match as Compose's last-one-wins does. A `<`, a `$`, a backtick or a space anywhere else in the file is now just bytes. The value is still assigned inside the remote shell and never becomes an `ssh` argument, which is the 2026-08-25 N7 rule about `?token=` applied to argv.

- **And the `else` arm no longer asserts the stronger of two different facts.** It says *there is no `METRICS_TOKEN=` line in that file* or *the line is there and read back empty*, naming the file either way. "Has no METRICS_TOKEN" was the sentence that was wrong for weeks.

- **Proven red before being trusted.** `npm run test:deploy-env-probe` runs both fragments under a real `sh` — not against an expected string, because a fragment compared only to the author's belief about the shell is tested against exactly the belief that was wrong here. Its first arm requires the OLD sourcing form to come back empty on a fixture carrying that same `EMAIL_FROM` line, so the suite reproduces the fault rather than only avoiding it. Restoring the sourcing probe reddens five arms; the file was restored byte-identically afterwards. 20 checks, and nine arms covering backticks, `$(…)`, `$VAR`, quoted and internally-quoted values, CRLF, a repeated key, the near-miss `OLD_METRICS_TOKEN=`, and a name refused before it reaches `sed`.

- **`docs/DEPLOY.md` §4 now carries the read-back that actually works from this laptop**, which has no `METRICS_TOKEN` of its own on purpose — the local copy was retired on 2026-09-01 after the value leaked twice, and the documented `curl` had quietly required one ever since.
