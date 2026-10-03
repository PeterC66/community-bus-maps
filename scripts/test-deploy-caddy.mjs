// test-deploy-caddy.mjs — deploy-caddy.mjs's --dry-run connects to nothing and
// says what it would run (buses-data OA-228, 2026-09-27).
//
//   node scripts/test-deploy-caddy.mjs   (or: npm run test:deploy-caddy)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments and there are no placeholders. It never reaches the real VPS: the
// child's DEPLOY_HOST is a name under `.invalid`, which RFC 2606 guarantees no
// resolver will answer, and DEPLOY_SSH_KEY is removed from its environment.
//
// deploy-caddy.mjs copies the Caddyfile to the host with scp, installs and
// reloads it over ssh, then reads the live headers back with curl. It now takes
// cli.mjs's confirm('remote'): the default is still to do all of that, and
// --dry-run prints the commands and connects to nothing.
//
// THE PROPERTY IS "NOTHING CONNECTED", NOT "EXIT 0". The real run is the
// control: a script that never connected at all would pass every dry-run case
// perfectly. Two signals, because Windows cannot run the stronger one:
//   - the step line "1. scp Caddyfile ->", which the script prints only on the
//     way into scp, on every platform;
//   - off Windows, shim `scp`, `ssh` and `curl` put first on the child's PATH
//     that record every call to a log and fail. Windows looks up only .exe and
//     .com without a shell, so there the real scp is what the control reaches,
//     and it fails at the name lookup.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPTS, 'deploy-caddy.mjs');
const ROOT = path.join(SCRIPTS, '..');
const HOST = 'nobody@deploy-caddy-test.invalid';
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-deploy-caddy-'));
const LOG = path.join(scratch, 'calls.log');
const SHIMS = process.platform !== 'win32';

const baseEnv = { ...process.env };
delete baseEnv.DEPLOY_HOST;
delete baseEnv.DEPLOY_SSH_KEY;
// The behind-origin guard has its own section below; every other case is about
// the scp path and must not depend on what origin/main holds today.
baseEnv.DEPLOY_CADDY_ALLOW_BEHIND = '1';
if (SHIMS) {
  for (const cmd of ['scp', 'ssh', 'curl']) {
    const p = path.join(scratch, cmd);
    writeFileSync(p, `#!/bin/sh\necho "${cmd} $*" >> "${LOG}"\nexit 1\n`);
    chmodSync(p, 0o755);
  }
  baseEnv.PATH = scratch + path.delimiter + (process.env.PATH || '');
}

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : []);
const run = (args, extraEnv = { DEPLOY_HOST: HOST }) => {
  rmSync(LOG, { force: true });
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env: { ...baseEnv, ...extraEnv }, encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: calls() };
};
const STEP = /1\. scp Caddyfile ->/;

try {
  console.log('the control: a real run tries to connect');
  const real = run([]);
  check('it takes the scp step', STEP.test(real.out), real.out.slice(0, 300));
  check('and fails, because the host does not exist', real.status !== 0, `exit ${real.status}`);
  if (SHIMS) check('the scp shim was called', real.calls.some((c) => c.startsWith('scp ')), JSON.stringify(real.calls));

  for (const args of [['--dry-run'], ['--dry-run', '--yes'], ['--print']]) {
    console.log(`\n${args.join(' ')}`);
    const r = run(args);
    check('exits 0', r.status === 0, `exit ${r.status}: ${r.out.slice(0, 300)}`);
    check('says it is a dry run', /Dry run:/.test(r.out));
    check('prints the scp it would run, naming the host', r.out.includes(`scp Caddyfile ${HOST}:`), r.out.slice(0, 300));
    check('prints the ssh install/validate/reload', /ssh .*caddy validate.*systemctl reload caddy/.test(r.out));
    check('never takes the scp step', !STEP.test(r.out));
    if (SHIMS) check('calls no scp, ssh or curl', r.calls.length === 0, JSON.stringify(r.calls));
  }

  console.log('\n--dry-run carries the key it would use');
  const keyed = run(['--dry-run'], { DEPLOY_HOST: HOST, DEPLOY_SSH_KEY: 'test-key-path' });
  check('the plan passes -i with the key', keyed.out.includes('scp -i test-key-path Caddyfile'), keyed.out.slice(0, 300));

  console.log('\n--yes alone still deploys');
  const yes = run(['--yes']);
  check('it takes the scp step', STEP.test(yes.out), yes.out.slice(0, 300));
  if (SHIMS) check('the scp shim was called', yes.calls.some((c) => c.startsWith('scp ')), JSON.stringify(yes.calls));

  console.log('\n--dry-run still refuses without DEPLOY_HOST');
  const nohost = run(['--dry-run'], {});
  check('exits 1', nohost.status === 1, `exit ${nohost.status}`);
  check('names DEPLOY_HOST', /DEPLOY_HOST must be set/.test(nohost.out));
  check('prints no plan', !/Dry run:/.test(nohost.out));

  console.log('\na checkout behind origin/main refuses before it connects');
  const g = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd, encoding: 'utf8' });
  const origin = path.join(scratch, 'origin.git');
  const mine = path.join(scratch, 'mine');
  const other = path.join(scratch, 'other');
  g(scratch, 'init', '--bare', '-b', 'main', origin);
  g(scratch, 'clone', '-q', origin, mine);
  writeFileSync(path.join(mine, 'Caddyfile'), readFileSync(path.join(ROOT, 'Caddyfile')));
  g(mine, 'add', 'Caddyfile'); g(mine, 'commit', '-q', '-m', 'one'); g(mine, 'push', '-q', 'origin', 'HEAD:main');
  g(scratch, 'clone', '-q', origin, other);
  g(other, 'commit', '-q', '--allow-empty', '-m', 'two'); g(other, 'push', '-q', 'origin', 'HEAD:main');
  const guarded = (args) => {
    const env = { ...baseEnv, DEPLOY_HOST: HOST };
    delete env.DEPLOY_CADDY_ALLOW_BEHIND;
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: mine, env, encoding: 'utf8', timeout: 60_000 });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const behind = guarded([]);
  check('exits 1', behind.status === 1, `exit ${behind.status}: ${behind.out.slice(0, 300)}`);
  check('says it is behind', /1 commit\(s\) behind origin\/main/.test(behind.out), behind.out.slice(0, 300));
  check('never takes the scp step', !STEP.test(behind.out));
  check('--dry-run is not stopped by it', guarded(['--dry-run']).status === 0);
  const allowed = guarded(['--allow-behind']);
  check('--allow-behind goes on to the scp step', STEP.test(allowed.out), allowed.out.slice(0, 300));
  g(mine, 'pull', '-q', '--ff-only', 'origin', 'main');
  const current = guarded([]);
  check('once up to date it goes on to the scp step', STEP.test(current.out), current.out.slice(0, 300));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks pass');
process.exit(failures ? 1 : 0);
