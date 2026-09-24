// What scripts/rotate-secret.mjs REFUSES, asserted by running it.
//
//   node scripts/test-rotate-secret.mjs      (part of `npm test`)
//
// WHY THIS EXISTS. Rotating a credential is the kind of job that gets done by
// hand, from a set of instructions, once every few months — which is to say it
// is right the first time and drifts every time after. The script exists to stop
// that. But a rotation script is also the worst thing to debug in anger, because
// the moment it goes wrong the service is holding a token nothing else knows,
// so its refusals matter more than its happy path.
//
// Everything asserted here runs WITHOUT touching a host: each case either fails
// in preflight or uses --dry-run, which exits before the first ssh. The host-side
// half — generate, restart, fingerprint, probe — cannot be tested from CI at all,
// for the same reason test-caddyfile.mjs cannot run Caddy: the only thing that
// can answer those questions is the VPS. That half is falsified by running it,
// and its own controls are inside the remote script (file == process, both !=
// old, and the old value exercised against the live route).
//
// THE PROVE-RED ARM IS AT THE BOTTOM and is not a separate file. The other
// prove-red-*.mjs scripts here drive a matrix of source edits; this one has a
// single mutation — remove the variable's line from compose.yaml — so a second
// file would be ceremony rather than coverage. It is labelled where it starts.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BEFORE_MARKER, GENERATE_MARKER, rotationScript } from './lib/rotate-host-script.mjs';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/* Run the script with a controlled environment. The real DEPLOY_* values are
 * never used: these are dummies, and every case below stops before ssh. */
function run(args, env = {}) {
  const r = spawnSync(process.execPath, ['scripts/rotate-secret.mjs', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_HOST: 'nobody@example.invalid',
      DEPLOY_APP_DIR: '/nonexistent',
      DEPLOY_SSH_KEY: '',
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

console.log('it refuses what it cannot safely rotate:');

let r = run([]);
check('no variable named is an error', r.status === 1, `exit ${r.status}`);
check('  and it lists what may be rotated', /METRICS_TOKEN, OPERATOR_TOKEN, STATUS_TOKEN/.test(r.out));

r = run(['RESEND_API_KEY']);
check('a key it cannot generate is refused', r.status === 1, `exit ${r.status}`);
// The specific one that matters: 48 random hex would authenticate to nothing at
// Resend, and the failure mode is sign-in emails that silently stop arriving.
check('  by name, so the reason is legible', /RESEND_API_KEY is not a self-generated token/.test(r.out));

r = run(['METRICS_TOKEN'], { DEPLOY_HOST: '', DEPLOY_APP_DIR: '' });
check('missing deploy config is refused before anything else', r.status === 1, `exit ${r.status}`);

console.log('\n--dry-run changes nothing and says what would happen:');

r = run(['METRICS_TOKEN', '--dry-run']);
check('a rotatable variable passes preflight', r.status === 0, `exit ${r.status}: ${r.out.slice(-200)}`);
check('  it says nothing changed', /dry run: nothing changed/.test(r.out));
check('  METRICS_TOKEN is held nowhere but the host', /nothing outside the host holds a copy/.test(r.out));

/* The warning that has to come FIRST rather than at the final step. Rotating
 * either of these breaks a laptop-side tool until its copy is updated, and
 * being told that after the switch is being told too late. */
r = run(['OPERATOR_TOKEN', '--dry-run']);
check('OPERATOR_TOKEN warns that something else holds it', /also held elsewhere/.test(r.out));
check('  and names the tool', /BUSMAPS_TOKEN|worklist\.mjs/.test(r.out));

r = run(['STATUS_TOKEN', '--dry-run']);
check('STATUS_TOKEN warns that something else holds it', /also held elsewhere/.test(r.out));
// Deliberately absent, and said to be absent. The only route this token opens is
// a POST that writes the status snapshot, so exercising a revoked copy of it
// would either change state or prove nothing. Reporting "revoked" off a config
// read would be the lie this whole script exists to avoid.
check('  and admits revocation will be UNPROVED for it', /revocation will be reported as UNPROVED/.test(r.out));

r = run(['METRICS_TOKEN', '--dry-run']);
check('a token WITH a probe makes no such admission', !/UNPROVED/.test(r.out));

/* ------------------------------------------------------------------ *
 * PROVE RED — the compose.yaml preflight, broken on purpose.
 *
 * The trap this guards has been sprung four times here (DEPLOY.md §2): a value
 * set in .env that is not also named under `environment:` in compose.yaml never
 * reaches the container. A rotation into that hole looks perfectly correct and
 * changes nothing the app can see. The control matters as much as the break —
 * the check must be green on the real file, or it is just noise.
 * ------------------------------------------------------------------ */
console.log('\nprove-red — the compose.yaml preflight:');

const COMPOSE = 'compose.yaml';
const original = readFileSync(COMPOSE, 'utf8');
try {
  const broken = original
    .split('\n')
    .filter((l) => !/^\s*METRICS_TOKEN:\s*\$\{METRICS_TOKEN/.test(l))
    .join('\n');
  check('the fixture really removes the line', broken !== original && !/METRICS_TOKEN:\s*\$\{/.test(broken));

  writeFileSync(COMPOSE, broken);
  const red = run(['METRICS_TOKEN', '--dry-run']);
  check('an unwired variable is REFUSED', red.status === 1, `exit ${red.status}`);
  check('  and the message names compose.yaml', /not named under `environment:` in compose\.yaml/.test(red.out));
  check('  and points at the check that owns the rule', /check:compose-env/.test(red.out));
} finally {
  writeFileSync(COMPOSE, original);
}

const control = run(['METRICS_TOKEN', '--dry-run']);
check('CONTROL: the restored file passes again', control.status === 0, `exit ${control.status}`);
check('CONTROL: compose.yaml is byte-identical to how it was found',
  readFileSync(COMPOSE, 'utf8') === original);

/* ------------------------------------------------------------------ *
 * THE OLD VALUE'S FINGERPRINT (buses-data OA-425).
 *
 * The script keeps no backup of .env, so the `1. before` fingerprint is the
 * only record of the secret it replaces. Until 2026-09-24 it read the value
 * with `grep | head -1` and no quote-stripping, while Compose — and
 * lib/host-env.mjs, which the deploy uses — take the LAST line for a repeated
 * key and strip one pair of quotes. On a duplicated or quoted key the record
 * described a value that was never live.
 *
 * This runs the real host script, up to the line that generates the new value,
 * under a real `sh` in a scratch folder, and compares what it prints with the
 * value Compose would load, worked out HERE in JavaScript rather than by the
 * shell under test. Nothing below the generate line runs: it writes .env and
 * restarts a container, and only the VPS can answer that half.
 * ------------------------------------------------------------------ */
console.log('\nthe old value\'s fingerprint describes the value Compose loads:');

/** Compose's reading of one key: the last `NAME=` line, CR dropped, one
 *  matching pair of surrounding quotes stripped. */
function composeValue(envText, name) {
  let value = null;
  for (const raw of envText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith(`${name}=`)) value = line.slice(name.length + 1);
  }
  if (value === null) return '';
  const m = /^"(.*)"$/.exec(value) || /^'(.*)'$/.exec(value);
  return m ? m[1] : value;
}
const fp12 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

const shOk = spawnSync('sh', ['-c', 'printf ok | sha256sum'], { encoding: 'utf8' });
if (shOk.error || shOk.status !== 0) {
  // A check that cannot run must not report clear.
  check('a POSIX sh with sha256sum is on PATH', false, 'install Git for Windows, or run on Linux');
} else {
  const LEGACY_READ = `OLD=$(grep "^$V=" .env | head -1 | cut -d= -f2- | tr -d '\\r\\n' || true)`;

  /** Run the script's head against `envText` and return what `1. before` printed. */
  const before = (envText, { mutate } = {}) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rotate-fp-'));
    try {
      writeFileSync(path.join(dir, '.env'), envText);
      const full = rotationScript({ name: 'METRICS_TOKEN', appDir: dir.replace(/\\/g, '/'), probeBlock: '' });
      let head = full.slice(0, full.indexOf(GENERATE_MARKER));
      if (mutate) head = mutate(head);
      const r = spawnSync('sh', ['-s'], { input: head, encoding: 'utf8' });
      const m = new RegExp(`${BEFORE_MARKER.replace('.', '\\.')}\\s*: len=(\\d+) fp=([0-9a-f]{12})`).exec(r.stdout || '');
      return m ? { len: Number(m[1]), fp: m[2] } : { len: -1, fp: `(no fingerprint; exit ${r.status}: ${(r.stderr || '').trim()})` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const STALE = 'a'.repeat(48);
  const LIVE = 'b'.repeat(48);
  const FIXTURES = [
    ['a single unquoted line', `METRICS_TOKEN=${LIVE}\n`],
    ['a duplicated, double-quoted key', `METRICS_TOKEN=${STALE}\nEMAIL_FROM=Peter Cooper - BusMaps.uk <info@busmaps.uk>\nMETRICS_TOKEN="${LIVE}"\n`],
    ['a single-quoted key', `METRICS_TOKEN='${LIVE}'\n`],
    ['a CRLF file with the key repeated', `METRICS_TOKEN=${STALE}\r\nMETRICS_TOKEN=${LIVE}\r\n`],
  ];
  for (const [what, envText] of FIXTURES) {
    const want = composeValue(envText, 'METRICS_TOKEN');
    const got = before(envText);
    check(`${what}: fingerprint is the live value's`, got.fp === fp12(want), `got ${got.fp}, want ${fp12(want)}`);
    check(`  and its length is ${want.length}`, got.len === want.length, `got ${got.len}`);
  }

  /* PROVE RED — put the pre-2026-09-24 read back into the script and the
   * duplicated, quoted fixture must describe the wrong value. */
  const dupQuoted = FIXTURES[1][1];
  let replaced = 0;
  const legacy = before(dupQuoted, {
    mutate: (head) => head.replace(/^OLD=.*$/m, () => { replaced++; return LEGACY_READ; }),
  });
  check('prove-red: the mutation replaced exactly one read', replaced === 1, `replaced ${replaced}`);
  check('prove-red: the old read fingerprints a value that was never live',
    legacy.fp !== fp12(composeValue(dupQuoted, 'METRICS_TOKEN')) && /^[0-9a-f]{12}$/.test(legacy.fp),
    `got ${legacy.fp}`);
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nrotate-secret: all checks passed.');
