#!/usr/bin/env node
// test-accept-publish-guards.mjs — accept-publish-batch cannot mint a session it
// will never revoke.
//
// WHY THIS EXISTS (buses-data OA-248, 2026-09-05). `--mint` inserts a live admin
// session on the host and, until this landed, revoked it only at the end of the
// happy path. Three exits walked away from it: declining the "Type yes" prompt,
// any thrown error, and a stdin that was not a terminal — the last one silently,
// because readline waited on input that could not come and node exited 0 with
// nothing left to do. That third exit is how the hole was found: running the
// script from a non-interactive shell to SEE the pending list.
//
// WHAT IS ASSERTED, and why each is a real run of the script rather than a
// read of its source:
//
//   1. With stdin not a TTY and no --yes, the script refuses with exit 2 BEFORE
//      it reaches the mint — so it must not get as far as complaining about
//      DEPLOY_HOST, which is the first thing mintSession() checks.
//   2. With --yes the guard steps aside and the run proceeds to the mint, which
//      here fails on the missing DEPLOY_HOST. That proves the ORDER: guard first,
//      mint second, and the guard is not simply refusing everything.
//   3. --dry-run with no cookie and stdin not a TTY is still allowed and still
//      makes no calls — the guard must not take away the one safe mode.
//   4. The revoke is inside a `finally` that wraps everything after the mint,
//      and the old happy-path-only revoke is gone. This one IS a read of the
//      source, because the alternative is an SSH to the host.
//
// The script is spawned with an environment that has NO deploy or admin
// variables, whatever this laptop's .env holds, so nothing here can reach a
// host even by accident.
//
// Run it from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:accept-publish-guards
// It is also discovered by `npm test`.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'accept-publish-batch.mjs');
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

// A clean environment: PATH so node can be found, nothing that names a host.
const cleanEnv = {};
for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[k] !== undefined) cleanEnv[k] = process.env[k];
}

function runScript(args) {
  // stdio 'pipe' for stdin is what makes process.stdin.isTTY false in the child.
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'], input: '', timeout: 30_000,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('test-accept-publish-guards — no prompt that cannot be answered, no mint without a revoke\n');

// 1. Non-TTY stdin, no --yes, --mint: refused before the mint.
{
  const r = runScript(['--mint', '--reviewed-by', 'test']);
  check(r.status === 2, 'non-TTY stdin without --yes is refused with exit 2', `status ${r.status}: ${r.out.slice(0, 300)}`);
  check(/stdin is not a terminal/.test(r.out), 'the refusal says why and names --yes', r.out.slice(0, 300));
  check(!/DEPLOY_HOST/.test(r.out), 'the refusal came BEFORE the mint (no DEPLOY_HOST complaint)', r.out.slice(0, 300));
  check(!/minting/.test(r.out), 'nothing was minted', r.out.slice(0, 300));
}

// 2. --yes: the guard steps aside and the run reaches the mint, which fails on
//    the empty environment. Proves the order, and that the guard discriminates.
{
  const r = runScript(['--mint', '--reviewed-by', 'test', '--yes']);
  check(/DEPLOY_HOST/.test(r.out), 'with --yes the run reaches the mint (fails there on DEPLOY_HOST)', r.out.slice(0, 300));
  check(r.status !== 0, 'and a failed mint is a failed run', `status ${r.status}`);
  check(!/stdin is not a terminal/.test(r.out), 'the TTY guard did not fire under --yes', r.out.slice(0, 300));
}

// 3. --dry-run with no cookie is still allowed on a non-TTY stdin and makes no
//    calls — the safe mode survives the guard.
{
  const r = runScript(['--dry-run', '--reviewed-by', 'test']);
  check(r.status === 0, '--dry-run without a cookie still runs on a non-TTY stdin', `status ${r.status}: ${r.out.slice(0, 300)}`);
  check(/Nothing changed/.test(r.out), 'and reports that nothing changed', r.out.slice(0, 300));
  check(!/stdin is not a terminal/.test(r.out), 'the TTY guard leaves --dry-run alone', r.out.slice(0, 300));
}

// 4. The revoke is in a finally, and nowhere else.
{
  const src = readFileSync(SCRIPT, 'utf8');
  const finallyBlock = /\} finally \{[\s\S]*?revokeSession\(COOKIE\)[\s\S]*?\}/.exec(src);
  check(!!finallyBlock, 'revokeSession(COOKIE) is called inside a finally block', 'no finally block calls revokeSession');
  const calls = (src.match(/revokeSession\(COOKIE\)/g) || []).length;
  check(calls === 1, 'and that is the ONLY call site (one revoke, on every exit)', `${calls} call sites`);
  check(/if \(!YES && !DRY_RUN && !process\.stdin\.isTTY\)/.test(src), 'the TTY guard is the exact three-part condition', 'guard condition not found');
  const guardAt = src.indexOf('!process.stdin.isTTY');
  const mintAt = src.indexOf('COOKIE = mintSession()');
  check(guardAt > 0 && mintAt > guardAt, 'the guard is textually before the mint', `guard at ${guardAt}, mint at ${mintAt}`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
