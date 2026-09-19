#!/usr/bin/env node
/*
 * test-deploy-env-probe.mjs — the deploy's read of the host's `.env`, and the
 * fault it is named after.
 *
 *     node scripts/test-deploy-env-probe.mjs
 *
 * `deploy.mjs` step 5 reads `METRICS_TOKEN` off the host so its
 * `/health?deep=1` read-back carries `gitSha`, `builtAt` and `checks{}` — the
 * three fields `opsAuthorised()` gates, and the only evidence a deploy has of
 * WHICH COMMIT went live. Until 2026-09-19 it got the value by sourcing the
 * file, which aborts at line 3 of the real one, and then printed that the host
 * had no such token. It had one, 48 characters, in both the file and the
 * container.
 *
 * WHAT MAKES THIS TEST WORTH ANYTHING IS ARM 1. A probe that reads a tidy
 * fixture proves nothing: the OLD probe read a tidy fixture too. So the fixture
 * here is the host's real shape, `EMAIL_FROM` and all, and the test requires
 * the LEGACY sourcing form to come back empty on it. That is this file's own
 * falsification — delete the new probe and restore the old one and arm 2 goes
 * red, which is the day this fault would have been caught.
 *
 * The fragments are run under a real `sh`, not asserted as strings. A shell
 * fragment that is only ever compared to an expected string is tested against
 * the author's belief about the shell, which is precisely the belief that was
 * wrong here.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { hostEnvDiagnosis, hostEnvProbe, legacySourcingProbe } from './lib/host-env.mjs';

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!cond) {
    failures += 1;
    if (extra !== undefined) console.log(`        ${extra}`);
  }
};

/** A POSIX shell has to exist for this test to mean anything. */
const probeShell = spawnSync('sh', ['-c', 'printf ok'], { encoding: 'utf8' });
if (probeShell.error || probeShell.stdout !== 'ok') {
  console.error('✗ no POSIX `sh` on PATH — this test cannot run, and a test that cannot run');
  console.error('  must not report clear. Install Git for Windows (laptop) or use a Linux runner.');
  process.exit(2);
}

/** Run a fragment in `dir` and report what it left in the named variable. */
function shValue(dir, fragment, varName) {
  const r = spawnSync('sh', ['-c', `${fragment}; printf '%s' "$${varName}"`], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { out: r.stdout ?? '', status: r.status };
}

/** Run a fragment in `dir` purely for what it prints. */
function shOutput(dir, fragment) {
  const r = spawnSync('sh', ['-c', fragment], { cwd: dir, encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-host-env-'));
const dirs = [];
function fixture(lines) {
  const d = mkdtempSync(path.join(tmp, 'env-'));
  writeFileSync(path.join(d, '.env'), lines.join('\n') + '\n', 'utf8');
  dirs.push(d);
  return d;
}

const TOKEN = 'e6a1c0b93f74d25a8e1f0c3b7d49a2f6c8b501e3d7a94f2b';

// The host's real file, in shape: the value on line 3 carries spaces, a hyphen
// and an angle bracket, and the token sits well below it.
const REAL_SHAPE = [
  'HOST=127.0.0.1',
  'PORT=5180',
  'EMAIL_FROM=Peter Cooper - BusMaps.uk <info@busmaps.uk>',
  'PILOT_MODE=1',
  'ALLOW_SELF_APPROVAL=1',
  `METRICS_TOKEN=${TOKEN}`,
];

const probe = hostEnvProbe({ name: 'METRICS_TOKEN', outVar: 'CBM_MT' });
const legacy = legacySourcingProbe({ outVar: 'CBM_MT' });

// --- arm 1: the fault. The old form must FAIL on the real shape. ------------

{
  const d = fixture(REAL_SHAPE);
  const got = shValue(d, legacy, 'CBM_MT');
  check(
    'ARM 1 (prove-red): sourcing the real .env does NOT yield the token',
    got.out !== TOKEN,
    `sourcing returned ${JSON.stringify(got.out)} — if this now equals the token, the shell`
      + ' stopped choking on EMAIL_FROM and this test no longer reproduces the fault it exists for',
  );
}

// --- arm 2: the fix reads the same file ------------------------------------

{
  const d = fixture(REAL_SHAPE);
  const got = shValue(d, probe, 'CBM_MT');
  check('ARM 2: the probe reads the token past an unquoted EMAIL_FROM', got.out === TOKEN,
    `got ${JSON.stringify(got.out)}`);
}

// --- arm 3: values the shell would have mangled -----------------------------

for (const [label, line, expected] of [
  ['a value containing a backtick', 'METRICS_TOKEN=ab`whoami`cd', 'ab`whoami`cd'],
  ['a value containing $(…)', 'METRICS_TOKEN=ab$(id)cd', 'ab$(id)cd'],
  ['a value containing a $VAR', 'METRICS_TOKEN=ab$HOME cd', 'ab$HOME cd'],
  ['a double-quoted value', `METRICS_TOKEN="${TOKEN}"`, TOKEN],
  ['a single-quoted value', `METRICS_TOKEN='${TOKEN}'`, TOKEN],
  ['a quote INSIDE the value', 'METRICS_TOKEN=ab"cd', 'ab"cd'],
]) {
  const d = fixture(['PORT=5180', line, 'PILOT_MODE=1']);
  const got = shValue(d, probe, 'CBM_MT');
  check(`ARM 3: ${label} survives verbatim`, got.out === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got.out)}`);
}

// --- arm 4: a CRLF file, which is how it reaches the host from this laptop --

{
  const d = mkdtempSync(path.join(tmp, 'crlf-'));
  writeFileSync(path.join(d, '.env'), `PORT=5180\r\nMETRICS_TOKEN=${TOKEN}\r\n`, 'utf8');
  dirs.push(d);
  const got = shValue(d, probe, 'CBM_MT');
  check('ARM 4: a CRLF .env yields no trailing carriage return', got.out === TOKEN,
    `got ${JSON.stringify(got.out)} — a CR here reaches the Authorization header and looks`
      + ' exactly like a wrong token');
}

// --- arm 5: last one wins, as Compose does ---------------------------------

{
  const d = fixture([`METRICS_TOKEN=${TOKEN}`, 'PORT=5180', 'METRICS_TOKEN=second']);
  const got = shValue(d, probe, 'CBM_MT');
  check('ARM 5: a repeated key takes the LAST value, as Compose does', got.out === 'second',
    `got ${JSON.stringify(got.out)}`);
}

// --- arm 6: a near-miss key must not match ---------------------------------

{
  const d = fixture(['OLD_METRICS_TOKEN=nope', 'PORT=5180']);
  const got = shValue(d, probe, 'CBM_MT');
  check('ARM 6: OLD_METRICS_TOKEN= does not satisfy METRICS_TOKEN=', got.out === '',
    `got ${JSON.stringify(got.out)}`);
}

// --- arm 7: the diagnosis tells the two empties apart ----------------------

const diagnosis = hostEnvDiagnosis({ name: 'METRICS_TOKEN' });

{
  const d = fixture(['PORT=5180', 'PILOT_MODE=1']);
  const said = shOutput(d, diagnosis);
  check('ARM 7a: no line at all — says the line is absent',
    /has no METRICS_TOKEN= line/.test(said), said);
  check('ARM 7a: and does NOT claim it is present', !/IS present/.test(said), said);
}

{
  const d = fixture(['PORT=5180', 'METRICS_TOKEN=']);
  const said = shOutput(d, diagnosis);
  check('ARM 7b: an empty value — says it is present but read back empty',
    /IS present/.test(said) && /read back empty/.test(said), said);
}

// --- arm 8: the probe prints nothing, ever ---------------------------------

{
  const d = fixture(REAL_SHAPE);
  const printed = shOutput(d, probe);
  check('ARM 8: the probe prints nothing — the value never reaches a log', printed === '',
    `printed ${JSON.stringify(printed)}`);
  check('ARM 8: and the fragment does not carry the value as an argv',
    !probe.includes(TOKEN));
}

// --- arm 9: the name is validated, because it is interpolated into sed ------

for (const bad of ['METRICS TOKEN', 'a/b', '1ABC', '']) {
  let threw = false;
  try { hostEnvProbe({ name: bad }); } catch { threw = true; }
  check(`ARM 9: ${JSON.stringify(bad)} is refused as an env-file key`, threw);
}

// --- done ------------------------------------------------------------------

for (const d of dirs) rmSync(d, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures) {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ the deploy reads the host .env the way Compose does, and says which empty it found.');
