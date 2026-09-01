#!/usr/bin/env node
// rotate-secret.mjs — rotate one self-generated token in the host's .env, and
// PROVE the rotation rather than report it.
//
// WHY THIS EXISTS. METRICS_TOKEN leaked into a Claude transcript twice in ten
// days — 2026-08-22 by a `sed` that tried to redact `printenv` output and got
// the pattern wrong, and 2026-09-01 by a `grep -rn` over the repository root,
// which reaches `.env` because .gitignore governs git and not the filesystem.
// Both rotations were then done by hand from a set of instructions, which is
// exactly the kind of thing that is right the first time and drifts the second.
//
// THE THREE RULES IT ENCODES, each of which cost something to learn:
//
//   1. GENERATE ON THE HOST. The new value is created by `openssl rand -hex 24`
//      inside the remote shell and written by a `printf` BUILTIN, so it is never
//      a process argument visible in `ps`, never echoed, never in shell history
//      at either end, and never returns to the laptop. This script never sees
//      the value it installs. That is the point of it.
//
//   2. VERIFY BY FINGERPRINT, NOT BY READING. A rotation is done when the file
//      and the RUNNING PROCESS agree on a value that is not the old one. All
//      three facts are established from sha256 prefixes, so the check is total
//      and the output is safe to paste anywhere. `docker compose up -d`, never
//      `restart` — restart does not re-evaluate the `${VAR}` substitution.
//
//   3. PROVE THE OLD VALUE IS DEAD. A config read cannot tell you a credential
//      was revoked; only using it can. Where a safe READ-ONLY probe exists the
//      old value is exercised against the live service after the switch and the
//      refusal is asserted. Where no such probe exists this says so plainly
//      instead of implying a check it did not run.
//
// IT KEEPS NO BACKUP OF .env, DELIBERATELY. The obvious `cp .env .env.bak-$(date)`
// leaves a cleartext duplicate of every OTHER live secret in the file sitting
// beside it for ever — two such files were found on the host on 2026-09-01, one
// of them five weeks old, holding a live RESEND_API_KEY. The only thing a backup
// would preserve here is a value being retired on purpose, so the old
// FINGERPRINT is printed instead and the file is left alone.
//
// Run from the repository root (the folder holding package.json). The argument
// is the variable name and there are no placeholders in it:
//
//     npm run rotate:secret -- METRICS_TOKEN
//
// Add --dry-run to print the plan and the preflight checks and change nothing.
//
// Same config as deploy.mjs: DEPLOY_HOST (user@host), DEPLOY_SSH_KEY (path,
// optional), DEPLOY_APP_DIR (the host dir holding compose.yaml). Zero npm
// dependencies (Node core + the system ssh binary).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ *
 * What may be rotated, and what else in the world holds a copy.
 *
 * A variable is listed here ONLY if this script can generate a valid
 * replacement for it. RESEND_API_KEY is deliberately absent: it is issued by
 * Resend, so a random 48 hex characters would authenticate to nothing and the
 * failure would show up as silently undelivered sign-in emails.
 *
 * `alsoHeldBy` is printed BEFORE anything is changed. Rotating a token that
 * something else authenticates with breaks that thing until its copy is
 * updated, and being told so at the final step is being told too late.
 * ------------------------------------------------------------------ */
const ROTATABLE = {
  METRICS_TOKEN: {
    what: 'gates /metrics and the gated fields of /health?deep=1',
    alsoHeldBy: [],
    // A read-only probe: the old token should now get the four-field public
    // form. `gitSha` is present only for an authorised caller, so its absence
    // IS the refusal. /health never 401s — it downgrades — so status code
    // cannot answer this and the body has to.
    probe: {
      how: 'GET /health?deep=1 with the OLD token — gitSha must be gone',
      shell: 'curl -fsS -H "Authorization: Bearer $OLD" "localhost:5180/health?deep=1"',
      deadWhen: 'body does NOT contain gitSha',
      test: 'grep -q gitSha && echo STILL_ALIVE || echo DEAD',
    },
  },
  OPERATOR_TOKEN: {
    what: 'lets the laptop worklist READ /api/admin/worklist and /api/maps',
    alsoHeldBy: [
      'the bus-work skill: BUSMAPS_TOKEN in the environment, or --token on',
      'worklist.mjs. Rotating this makes the live worklist 401 until that is updated.',
    ],
    probe: {
      how: 'GET /api/admin/worklist with the OLD token — must be refused',
      shell: 'curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $OLD" "localhost:5180/api/admin/worklist"',
      deadWhen: 'the status code is 401 or 404',
      test: 'grep -qE "^(401|404)$" && echo DEAD || echo STILL_ALIVE',
    },
  },
  STATUS_TOKEN: {
    what: 'gates POST /api/admin/status (the laptop\'s push-status.mjs)',
    alsoHeldBy: [
      'the bus-work skill: push-status.mjs --token, or STATUS_TOKEN in the',
      'environment. Rotating this makes the status push fail until that is updated.',
    ],
    // No probe, and that is a finding rather than an omission: the only route
    // this token opens is a POST that WRITES the status snapshot. Exercising a
    // revoked credential against it would either change state or prove nothing,
    // so revocation is left unproved and said to be unproved.
    probe: null,
  },
};

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VAR = argv.find((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!VAR) {
  console.error('usage: npm run rotate:secret -- <VARIABLE> [--dry-run]');
  console.error(`rotatable: ${Object.keys(ROTATABLE).join(', ')}`);
  die('no variable named.');
}
if (!Object.hasOwn(ROTATABLE, VAR)) {
  console.error(`rotatable: ${Object.keys(ROTATABLE).join(', ')}`);
  die(`${VAR} is not a self-generated token this script may rotate.`);
}
const SPEC = ROTATABLE[VAR];

const HOST = process.env.DEPLOY_HOST;
const SSH_KEY = process.env.DEPLOY_SSH_KEY; // optional
const APP_DIR = process.env.DEPLOY_APP_DIR;
if (!HOST || !APP_DIR) die('DEPLOY_HOST and DEPLOY_APP_DIR must be set (env, or in .env).');

const SSH = ['ssh', ...(SSH_KEY ? ['-i', SSH_KEY] : []), '-o', 'BatchMode=yes', HOST];

/* Run a shell script on the host by piping it to `sh -s` on STDIN. Nothing is
 * passed as an argument, so nothing reaches the host's `ps` or its shell
 * history, and no quoting has to survive two shells. */
function sshScript(script, { inherit = true } = {}) {
  const r = spawnSync(SSH[0], [...SSH.slice(1), 'sh -s'], {
    input: script,
    encoding: 'utf8',
    stdio: inherit ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

console.log(`== rotate ${VAR} ==`);
console.log(`   host : ${HOST}`);
console.log(`   dir  : ${APP_DIR}`);
console.log(`   what : ${SPEC.what}`);

/* ---- preflight 1: is the variable wired into compose.yaml at all? ----
 * The trap that has caught four variables here (DEPLOY.md §2): a value set in
 * .env that is not also named under `environment:` in compose.yaml never
 * reaches the container. Rotating into that hole would look perfectly correct
 * and change nothing, and the fingerprint check below would report the file and
 * the process disagreeing without saying why. Say why first. */
let compose = '';
try {
  compose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8');
} catch {
  die('cannot read compose.yaml — run this from the repository root.');
}
const wired = new RegExp(`^\\s*${VAR}:\\s*\\$\\{${VAR}`, 'm').test(compose);
if (!wired) {
  console.error(`✗ ${VAR} is not named under \`environment:\` in compose.yaml.`);
  console.error('  Compose reads .env only to substitute ${VARS} into that file, so the');
  console.error('  container would never see the new value. Add the line, then rotate.');
  console.error('  `npm run check:compose-env` is the check that owns this rule.');
  process.exit(1);
}
console.log('   ✓ named under environment: in compose.yaml');

/* ---- preflight 2: who else holds a copy ---- */
if (SPEC.alsoHeldBy.length) {
  console.log('\n   !! this token is also held elsewhere:');
  for (const line of SPEC.alsoHeldBy) console.log(`      ${line}`);
  console.log('      Have the replacement ready to install there before you continue.');
} else {
  console.log('   ✓ nothing outside the host holds a copy');
}

if (!SPEC.probe) {
  console.log('\n   !! no safe read-only probe exists for this token, so the OLD value');
  console.log('      will NOT be exercised and revocation will be reported as UNPROVED.');
}

if (DRY_RUN) {
  console.log('\n-- dry run: nothing changed.');
  process.exit(0);
}

/* ---- the rotation, as one host-side script ---- */
const probeBlock = SPEC.probe
  ? `
echo "5. proving the OLD value is dead"
echo "   probe: ${SPEC.probe.how}"
VERDICT=$(${SPEC.probe.shell} 2>/dev/null | ${SPEC.probe.test})
echo "   dead when: ${SPEC.probe.deadWhen}"
echo "   verdict  : $VERDICT"
if [ "$VERDICT" != "DEAD" ]; then
  echo "FAIL: the old value still authenticates"
  exit 1
fi
`
  : `
echo "5. revocation UNPROVED - no safe read-only probe for this token"
`;

const script = `
set -eu
cd ${q(APP_DIR)}
V=${q(VAR)}
test -f .env || { echo "FAIL: no .env in ${APP_DIR}"; exit 1; }

fp() { sha256sum | cut -c1-12; }

OLD=$(grep "^$V=" .env | head -1 | cut -d= -f2- | tr -d '\\r\\n' || true)
OLDFP=$(printf %s "$OLD" | fp)
echo "1. before      : len=\${#OLD} fp=$OLDFP"

NEW=$(openssl rand -hex 24)
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

FILEFP=$(grep "^$V=" .env | head -1 | cut -d= -f2- | tr -d '\\r\\n' | fp)
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

const r = sshScript(script);
if (r.status !== 0) {
  console.error(`\n✗ rotation FAILED (exit ${r.status}). Read the output above.`);
  console.error('  The host .env may already hold the new value while the container does not.');
  console.error('  `docker compose up -d portal` on the host is the usual repair.');
  process.exit(1);
}

console.log(`\n✓ ${VAR} rotated.`);
if (SPEC.alsoHeldBy.length) {
  console.log('  Now install the new value everywhere listed above, or that thing is broken.');
  console.log('  The value was generated on the host and is not printed here by design —');
  console.log(`  read it once from the host's .env when you need to copy it.`);
}
