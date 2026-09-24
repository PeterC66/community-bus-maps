/*
 * rotate-host-script.mjs — the shell script `rotate-secret.mjs` pipes to the
 * deploy host, built here rather than inline so it can be RUN by a test.
 *
 * WHY IT IS A SEPARATE FILE (buses-data OA-425). `rotate-secret.mjs` is a
 * command with top-level side effects, so nothing could import the script it
 * sends, and the one line in it that keeps a record — the OLD value's
 * fingerprint, printed because the script deliberately keeps no backup of
 * `.env` — was never executed anywhere but on the VPS. `test-rotate-secret.mjs`
 * now runs the head of this script under a real `sh` against a fixture `.env`
 * and compares the fingerprint it prints with the value Compose would load.
 *
 * BOTH READS OF .env GO THROUGH hostEnvProbe(), the deploy's reader. The old
 * value used to be read with `grep | head -1` and no quote-stripping, while
 * Compose takes the LAST line for a repeated key and strips one pair of
 * quotes, so on a duplicated or hand-quoted key the only record of the
 * replaced secret fingerprinted a value that was never live. The read after
 * the rewrite could not go wrong that way — the file then holds one unquoted
 * line — but it uses the same reader so there is one statement of what `.env`
 * means, not two.
 *
 * Nothing here runs anything. It returns text, and the text holds no secret:
 * the value is generated, read and compared inside the remote shell.
 */

import { hostEnvProbe } from './host-env.mjs';

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The line of the host script that prints the OLD value's fingerprint. A test
 * runs everything before this marker's successor, so it is exported rather
 * than retyped there.
 */
export const BEFORE_MARKER = '1. before';

/**
 * The first line after the read of the old value. Everything above it is safe
 * to run against a fixture: it reads `.env` and prints a fingerprint, and
 * nothing else. Everything from it on generates, writes and restarts.
 */
export const GENERATE_MARKER = 'NEW=$(openssl rand -hex 24)';

export function rotationScript({ name, appDir, probeBlock }) {
  return `
set -eu
cd ${q(appDir)}
V=${q(name)}
test -f .env || { echo "FAIL: no .env in ${appDir}"; exit 1; }

fp() { sha256sum | cut -c1-12; }

${hostEnvProbe({ name, outVar: 'OLD' })}
OLDFP=$(printf %s "$OLD" | fp)
echo "${BEFORE_MARKER}      : len=\${#OLD} fp=$OLDFP"

${GENERATE_MARKER}
if [ \${#NEW} -ne 48 ]; then echo "FAIL: generated \${#NEW} chars, expected 48"; exit 1; fi
echo "2. generated   : 48 hex chars, host-side"

grep -v "^$V=" .env > .env.new
printf '%s=%s\\n' "$V" "$NEW" >> .env.new
chmod --reference=.env .env.new 2>/dev/null || chmod 600 .env.new
mv .env.new .env
NEW=
echo "3. .env written (no backup kept - the old fingerprint above is the record)"

docker compose up -d portal >/dev/null 2>&1
echo "4. container recreated with 'up -d' (not 'restart')"
sleep 6

${hostEnvProbe({ name, outVar: 'FILEVAL' })}
FILEFP=$(printf %s "$FILEVAL" | fp)
CONTRAW=$(docker compose exec -T portal printenv "$V" | tr -d '\\r\\n')
CONTFP=$(printf %s "$CONTRAW" | fp)
echo "   file       : fp=$FILEFP"
echo "   process    : fp=$CONTFP len=\${#CONTRAW}"

if [ -z "$CONTRAW" ]; then
  echo "FAIL: the container has no value - .env is not reaching it"
  exit 1
fi
if [ "$FILEFP" != "$CONTFP" ]; then
  echo "FAIL: the file and the running process disagree"
  exit 1
fi
if [ "$FILEFP" = "$OLDFP" ]; then
  echo "FAIL: the value did not change"
  exit 1
fi
echo "   -> file == process, and both differ from the old value"
${probeBlock}
echo "DONE  $OLDFP -> $FILEFP"
`;
}
