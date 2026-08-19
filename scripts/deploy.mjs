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
if (!DRY_RUN) {
  const gitSha = sshCapture(`cd ${APP_DIR} && git rev-parse --short HEAD`).stdout;
  const builtAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
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

// 5. Smoke test.
console.log('\n-- 5. /health?deep=1');
if (!DRY_RUN) {
  sshRun('sleep 3 && curl -fsS localhost:5180/health?deep=1');
}

console.log('\n✓ deploy sequence complete — read the /health output above: gitSha, builtAt, and all four checks green.');
