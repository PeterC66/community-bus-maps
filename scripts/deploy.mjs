#!/usr/bin/env node
// deploy.mjs — run the documented upgrade recipe (docs/DEPLOY.md §9 "Running
// the upgrade, as actually done") as one laptop command, the same way
// deliver-map.mjs turned the map-delivery recipe into one command.
//
// Four steps, in the order DEPLOY.md's own write-up insists matters —
// "back up first, build second, switch third":
//   1. docker compose run --rm backup   (a release-time backup, not cron's 03:15 one)
//   2. git pull, then READ the new HEAD rather than assuming the pull got what
//      you expect (docs/DEPLOY.md §9 names this exact mistake)
//   3. export GIT_SHA/BUILT_AT && docker compose build portal — the old
//      container keeps serving throughout, so a failed build costs nothing
//   4. docker compose up -d portal — the only step the public notices (a few
//      seconds of 502 while the container is recreated)
// Then curl /health?deep=1 and print it for a human to read the gitSha/status
// off — this script does not itself decide the deploy "worked", it surfaces
// the same evidence DEPLOY.md says to trust over any document.
//
// Same config as deliver-map.mjs: DEPLOY_HOST (user@host), DEPLOY_SSH_KEY
// (path, optional), DEPLOY_APP_DIR (dir on the host holding compose.yaml).
// Run as `npm run deploy`, not with an inline env prefix — see
// deliver-map.mjs's own header for why (MSYS mangles a leading `/`).
//
// Zero npm dependencies (Node core + the system ssh/scp binaries), matching
// the other laptop-side scripts.

import { spawnSync } from 'node:child_process';

const has = (name) => process.argv.includes(`--${name}`);
const DRY_RUN = has('dry-run');
const SKIP_BACKUP = has('skip-backup');

const HOST = process.env.DEPLOY_HOST;
const SSH_KEY = process.env.DEPLOY_SSH_KEY; // optional
const APP_DIR = process.env.DEPLOY_APP_DIR;
if (!HOST || !APP_DIR) {
  console.error('✗ DEPLOY_HOST and DEPLOY_APP_DIR must be set (env, or in .env).');
  process.exit(1);
}

const sshBaseArgs = SSH_KEY ? ['-i', SSH_KEY] : [];
const SSH = ['ssh', ...sshBaseArgs, '-o', 'BatchMode=yes', HOST];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status;
}
function sshCapture(remoteCmd) {
  console.log(`$ ssh ${HOST} ${remoteCmd}`);
  const r = spawnSync(SSH[0], [...SSH.slice(1), remoteCmd], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.error) throw r.error;
  return { status: r.status, stdout: (r.stdout || '').trim() };
}
function sshRun(remoteCmd) {
  return run(SSH[0], [...SSH.slice(1), remoteCmd]);
}

console.log('== deploy ==');
console.log(`  host   : ${HOST}`);
console.log(`  appDir : ${APP_DIR}`);
console.log('');

// 1. Backup, immediately before the release — not cron's 03:15 one.
if (!SKIP_BACKUP) {
  console.log('-- 1. docker compose run --rm backup');
  if (!DRY_RUN) {
    const rc = sshRun(`cd ${APP_DIR} && docker compose run --rm backup`);
    if (rc !== 0) { console.error('✗ backup failed — aborting before touching anything live.'); process.exit(1); }
  }
} else {
  console.log('-- 1. backup SKIPPED (--skip-backup)');
}

// 2. Pull, and read the new HEAD rather than assuming.
console.log('\n-- 2. git pull (and read the new HEAD)');
if (!DRY_RUN) {
  const before = sshCapture(`cd ${APP_DIR} && git rev-parse --short HEAD`).stdout;
  const rc = sshRun(`cd ${APP_DIR} && git pull`);
  if (rc !== 0) { console.error('✗ git pull failed — aborting.'); process.exit(1); }
  const after = sshCapture(`cd ${APP_DIR} && git rev-parse --short HEAD`).stdout;
  console.log(`   HEAD: ${before} -> ${after}${before === after ? '  (unchanged — nothing new to deploy)' : ''}`);
}

// 3. Build — the old container keeps serving throughout.
console.log('\n-- 3. docker compose build portal (stamping GIT_SHA/BUILT_AT)');
// Hoisted out of the block so step 5 can state which commit it actually built.
let gitSha = null, builtAt = null;
if (!DRY_RUN) {
  gitSha = sshCapture(`cd ${APP_DIR} && git rev-parse --short HEAD`).stdout;
  builtAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const rc = sshRun(`cd ${APP_DIR} && export GIT_SHA=${gitSha} BUILT_AT=${builtAt} && docker compose build portal`);
  if (rc !== 0) { console.error('✗ build failed — the old container is still serving, nothing to roll back.'); process.exit(1); }
}

// 4. Switch — the only step the public notices.
console.log('\n-- 4. docker compose up -d portal');
if (!DRY_RUN) {
  // GIT_SHA/BUILT_AT are build args (baked in at step 3); `up -d` just
  // recreates the container from the image just built, no re-export needed.
  const rc = sshRun(`cd ${APP_DIR} && docker compose up -d portal`);
  if (rc !== 0) { console.error('✗ could not switch over — check the host by hand.'); process.exit(1); }
}

// 5. Readiness.
//
// The exit code is CAPTURED. It was discarded until 2026-08-20, exactly as
// deliver-map.mjs step 6 was (technical-audit_2026-08-19 O3) — so a deploy that
// left the service unhealthy still printed a tick. `curl -f` returns non-zero on
// the 503 that /health?deep=1 gives when a dependency is down, and that is the
// whole point of asking.
// `gitSha`, `builtAt` and the per-check `checks{}` are GATED behind
// opsAuthorised() — a METRICS_TOKEN Bearer header, or an admin session — so an
// unauthenticated curl gets the short form and none of the three, however green
// everything is. This step used to close by telling the operator to read
// "gitSha, builtAt, and every check green" out of output that structurally could
// not contain any of them, which meant the deploy never once confirmed WHICH
// COMMIT it had just put live. That is the §3a lesson in miniature: nothing
// failed and nothing said so. Send the token when there is one, and either way
// print the sha this script resolved and built with, so there is a real value to
// read back against instead of an absent field.
//
// HOW THE TOKEN GETS THERE, CHANGED 2026-08-25 (technical-audit_2026-08-25 N7).
// It used to go in the URL as `?token=…`, which Caddy's access log then recorded
// in clear; the server no longer accepts that form at all. It is NOT passed on
// this command line either, because an argument to `ssh` is visible in `ps` on
// the host for the life of the call and lands in shell history at both ends.
// Instead the remote shell sources the host's own .env — the same file compose
// substitutes from, so the value is already there — and curl reads it from the
// environment. Note the single-quoted JS string: every `$` below is literal and
// is expanded by the REMOTE shell, not by this script.
console.log('\n-- 5. /health?deep=1');
if (!DRY_RUN) {
  console.log(`   built and deployed: gitSha=${gitSha} builtAt=${builtAt}`);
  if (!process.env.METRICS_TOKEN) {
    console.log('   (no METRICS_TOKEN in this shell — if the host .env has none either,');
    console.log('    gitSha/builtAt/checks are gated OUT of the reply below)');
  }
  // An explicit if/else, NOT `${METRICS_TOKEN:+-H "Authorization: …"}`. The
  // parameter-expansion form looks tidier and is wrong: the quotes it produces
  // are the RESULT of an expansion, so the shell does not honour them and the
  // header word-splits into four arguments. Quoting only works when it is in the
  // script text, which is what this is.
  const url = '"localhost:5180/health?deep=1"';
  const remote = 'sleep 3 && cd ' + APP_DIR + ' && { set -a; . ./.env 2>/dev/null; set +a; }; '
    + 'if [ -n "$METRICS_TOKEN" ]; then '
    + 'curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" ' + url + '; '
    + 'else curl -fsS ' + url + '; fi';
  const rc = sshRun(remote);
  if (rc !== 0) {
    console.error('\n✗ the new container is not READY (curl returned ' + rc + ').');
    console.error('  The deploy has happened. Read the output above, then decide whether to roll back —');
    console.error('  docs/DEPLOY.md §9 has the recipe. Do not walk away from this.');
    process.exit(1);
  }
}

// 6. Can anyone actually get in?
//
// Readiness proves the DB, the store, the rasteriser and the email
// CONFIGURATION. It cannot prove the provider will accept a message today, and
// sign-in is the only door into this system — see scripts/smoke-signin.mjs.
// Skippable with --skip-signin for a deploy where sending a real email is
// unwanted, but the default is to send one, because the alternative is finding
// out from a customer.
console.log('\n-- 6. sign-in smoke test');
if (!DRY_RUN && !has('skip-signin')) {
  const rc = run(process.execPath, ['scripts/smoke-signin.mjs', '--quiet']);
  if (rc !== 0) {
    console.error('\n✗ nobody can sign in to the deployment that was just shipped. Fix before doing anything else.');
    process.exit(1);
  }
} else if (has('skip-signin')) {
  console.log('   SKIPPED (--skip-signin) — nothing has proved a real sign-in email can be sent.');
}

console.log('\n✓ deploy sequence complete.');
console.log(`  Deployed ${gitSha || '(dry run)'} at ${builtAt || '(dry run)'}.`);
console.log('  Read the /health output above — and if it carries no gitSha/checks, that is the');
console.log('  METRICS_TOKEN gate, not a healthy answer. Confirm the commit independently before');
console.log('  calling it done: curl a file that only the new build serves (docs/DEPLOY.md §3a).');
