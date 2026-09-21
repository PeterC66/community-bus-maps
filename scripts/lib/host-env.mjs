#!/usr/bin/env node
/*
 * host-env.mjs — read ONE variable out of the deploy host's `.env` from inside
 * a remote shell, WITHOUT sourcing the file.
 *
 * WHY THIS EXISTS, measured on 2026-09-19 against the live host.
 *
 * `deploy.mjs` step 5 needs `METRICS_TOKEN` on the host so its `/health?deep=1`
 * read-back can carry `gitSha`, `builtAt` and `checks{}` — the three fields
 * `opsAuthorised()` gates, and the only evidence the deploy has of WHICH COMMIT
 * it just put live. It got the value with:
 *
 *     { set -a; . ./.env 2>/dev/null; set +a; }
 *
 * and that aborts. Line 3 of the host's `.env` is
 *
 *     EMAIL_FROM=Peter Cooper - BusMaps.uk <info@busmaps.uk>
 *
 * which is a perfectly good value for Compose — it reads `.env` as a key/value
 * file and never executes it — and is a syntax error for a shell, because `<`
 * is a redirection operator and there is a newline where the shell wants a
 * filename. `bash` gives up at line 3. `METRICS_TOKEN` is on line 11, so it was
 * never set, and the `2>/dev/null` swallowed the message that said so. The
 * script then printed
 *
 *     (the HOST .env has no METRICS_TOKEN - ... gated OUT ...)
 *
 * about a variable that was present and 48 characters long, in both the file
 * and the running container. Every deploy since `EMAIL_FROM` took that form has
 * ended with the four-field anonymous answer under a wrong explanation of why —
 * the instrument could not run, and it reported a finding about its subject
 * instead of about itself.
 *
 * SO: no sourcing, and no shell semantics applied to a file that does not have
 * them. `sed` addresses one line and hands back its value; a `<`, a space, a
 * `$` or a backtick anywhere else in the file is just bytes. That is the same
 * reading Compose does, which is the point — the two halves of the deploy now
 * agree about what `.env` means.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE. The value never crosses the wire and is
 * never printed: it is assigned to a shell variable INSIDE the remote shell and
 * read from there by `curl`. An argument to `ssh` is visible in `ps` on the
 * host for the life of the call and lands in shell history at both ends, which
 * is why the `?token=` URL form was removed on 2026-08-25 (technical-audit
 * 2026-08-25 N7) and why it is not coming back as an argv either.
 *
 * THE GRAMMAR IS COMPOSE'S, not the shell's: `NAME=value` at the start of a
 * line, optionally wrapped in one matching pair of quotes, no `export` prefix,
 * no leading whitespace. That is what `docker compose` itself accepts in an
 * env file, so a line this cannot read is a line Compose cannot read either.
 * The LAST match wins, matching Compose's own last-one-wins for a repeated key.
 *
 * Exercised by `scripts/test-deploy-env-probe.mjs`, which runs these fragments
 * under a real `sh` against a fixture `.env` carrying the very `EMAIL_FROM`
 * line above — and requires the old sourcing form to FAIL on the same file, so
 * the test would have caught the fault it is named after.
 */

/**
 * Compose env-file names: what `docker compose` will substitute from.
 * Anything else is a programming error here, not a runtime condition — and it
 * is checked because the name is interpolated into a `sed` script below.
 */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertName(name) {
  if (!NAME_RE.test(name)) {
    throw new Error(`host-env: ${JSON.stringify(name)} is not a usable env-file key`);
  }
}

/**
 * A POSIX `sh` fragment that assigns the value of `name` from `file` to the
 * shell variable `outVar`, or to the empty string when there is no such line.
 * It prints nothing.
 *
 * The two trailing `sed` expressions strip ONE matching pair of surrounding
 * quotes and nothing else, so a quote inside a value survives. `tr -d` drops a
 * CR, because a `.env` edited on Windows and copied up reaches the host with
 * CRLF line endings and the token would otherwise carry a trailing carriage
 * return into the `Authorization` header — a failure that looks exactly like a
 * wrong token.
 */
export function hostEnvProbe({ name, outVar = 'CBM_VALUE', file = './.env' } = {}) {
  assertName(name);
  assertName(outVar);
  return (
    `${outVar}=$(sed -n 's/^${name}=//p' ${file} 2>/dev/null` +
    ` | tail -n 1 | tr -d '\\r'` +
    ` | sed -e 's/^"\\(.*\\)"$/\\1/' -e "s/^'\\(.*\\)'\$/\\1/")`
  );
}

/**
 * A POSIX `sh` fragment that says why `outVar` came back empty, in the two
 * cases that are genuinely different, and never asserts the stronger one.
 *
 * "has no METRICS_TOKEN" was the sentence that was wrong for weeks, so this
 * distinguishes *the line is not there* from *the line is there and read as
 * empty*, and says which file it looked in. A reader who sees the second one
 * knows to look at the file rather than at the deploy.
 */
export function hostEnvDiagnosis({ name, file = './.env', gated = '' } = {}) {
  assertName(name);
  const tail = gated ? ` - ${gated}` : '';
  return (
    `if grep -q '^${name}=' ${file} 2>/dev/null; then ` +
    `echo "(${name} IS present in ${file} on the host but read back empty${tail})"; ` +
    `else ` +
    `echo "(${file} on the host has no ${name}= line${tail})"; ` +
    `fi;`
  );
}

/**
 * The sourcing form this module replaced, kept ONLY so the test can require it
 * to fail on the fixture that broke it. Nothing in the deploy path calls this,
 * and nothing should: a check that has never been seen to go red proves
 * nothing, and this is what makes the new probe's green meaningful.
 */
export function legacySourcingProbe({ outVar = 'CBM_VALUE', file = './.env' } = {}) {
  assertName(outVar);
  return `{ set -a; . ${file} 2>/dev/null; set +a; }; ${outVar}="$METRICS_TOKEN"`;
}
