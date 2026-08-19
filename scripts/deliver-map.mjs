#!/usr/bin/env node
// deliver-map.mjs — laptop -> host map delivery (GO-LIVE.md §2.1, Phase 1).
//
// scripts/import-map.mjs and scripts/propose-update.mjs write straight to
// DATA_DIR and SQLite with the server stopped ("one writer"); neither speaks
// HTTP. Once the portal runs on a host, /bus-work has no way to get a built
// map into it. This is that way — one laptop command, ssh-based, consistent
// with the fool-proofing plan's "laptop = one command":
//
// NEW map (import-map.mjs):
//   npm run deliver -- --src "<S5-render dir>" --name "St Ives" \
//        --slug st-ives --kind area --subject "St Ives, Cambridgeshire"
//
//   npm run deliver -- --src "<place S5-render dir>" \
//        --name "High Wycombe Aldi" --slug highwycombe-aldi --kind place \
//        --subject "Aldi, Tannery Road, High Wycombe"
//
// All import-map.mjs flags are accepted and forwarded as-is (--customer,
// --customer-type, --request N, --disagreements, etc.) — see that script's
// own header for the full set.
//
// EXISTING map refresh (propose-update.mjs) — pass --map instead of --name/
// --slug/--subject, and this runs propose-update.mjs instead of import-map.mjs.
// This is the routine monthly-refresh case (2026-08-10: until now the only way
// to get a fresh render onto the live map was to SSH in and run propose-update.mjs
// by hand — this closes that gap the same way §2.1 Phase 1 closed it for imports):
//
//   npm run deliver -- --src "<fresh S5-render dir>" --map st-ives --kind area \
//        --note "BODS 2026-08-01 refresh"
//
// --kind is still required in this mode too — it only picks which verify gate
// (verify:area vs verify:place) runs in step 2; it is not forwarded to
// propose-update.mjs, which infers kind from the map row itself.
//
// Sequence, matching GO-LIVE.md §2.1/§2.5:
//   1. scp --src up to a scratch dir on the host (rsync isn't reliably
//      available on Windows/Git Bash laptops, so this uses scp instead).
//   2. PRE-FLIGHT VERIFY there, inside a throwaway container, BEFORE touching
//      the running service — compares SVGs only (never JPGs), reusing
//      scripts/verify-reproduce(.mjs|-place.mjs) exactly as `npm run verify`
//      does locally. §2.5 settled that JPG parity is a laptop/host font
//      difference, not a bug, and that a JPG check here would be a permanent
//      false alarm — so this step, like `npm run verify`, never looks at the
//      JPG for its pass/fail verdict.
//   3. docker compose stop portal (only once the pre-flight above passed).
//   4. import-map.mjs OR propose-update.mjs (whichever this call is for), run
//      inside a throwaway container against the staged dir.
//   5. docker compose up -d portal.
//   6. curl /health?deep=1 on the host and check it reports ok.
//   7. Clean up the scratch dir on the host.
//
// propose-update.mjs never touches the live-serving version (it only stages a
// proposed update for the customer to accept/decline), so steps 3/5 look
// heavier-handed here than the risk warrants — but it still does a SQLite
// write, and GO-LIVE.md §2.1's "one writer" rule doesn't carve out an
// exception for it, so this stays on the same stop/run/restart discipline as
// import-map.mjs rather than inventing a second, less-tested code path.
//
// A failure at step 2 leaves the live service completely untouched. A failure
// at step 4 leaves the service stopped — this script does NOT auto-restart on
// an import failure, because "the site is down" is a much louder, safer
// failure mode than "the site is silently serving whatever import-map.mjs
// left half-written". Re-run `docker compose up -d portal` on the host by
// hand once the import problem is understood.
//
// Config lives in .env (see .env.example): DEPLOY_HOST (user@host),
// DEPLOY_SSH_KEY (path, optional — falls back to ssh's own default identity),
// DEPLOY_APP_DIR (directory on the host holding compose.yaml, e.g.
// /opt/community-bus-maps). Run it as `npm run deliver -- --src …`, not with
// inline `DEPLOY_APP_DIR=/opt/... node …` — on Windows Git Bash, MSYS silently
// mangles a leading `/` in an inline-assigned env var into a Windows path
// (confirmed 2026-08-09: DEPLOY_APP_DIR=/opt/community-bus-maps arrived as
// C:/Users/.../Git/opt/community-bus-maps). Reading it from .env via
// --env-file-if-exists sidesteps that entirely.
//
// Zero npm dependencies (Node core + the system `ssh`/`scp` binaries),
// matching the other laptop-side scripts (push-status.mjs, worklist.mjs).

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const SRC = arg('src');
const KIND = arg('kind', 'area');
const DRY_RUN = has('dry-run');
const MAP = arg('map');
const MODE = MAP ? 'propose' : 'import';

if (!SRC || !existsSync(SRC)) {
  console.error('✗ --src "<S5-render dir>" is required and must exist (same shape import-map.mjs / propose-update.mjs takes).');
  process.exit(1);
}
if (!['area', 'place'].includes(KIND)) {
  console.error(`✗ --kind must be "area" or "place" (got "${KIND}") — picks which verify gate runs.`);
  process.exit(1);
}

const HOST = process.env.DEPLOY_HOST;
const SSH_KEY = process.env.DEPLOY_SSH_KEY; // optional
const APP_DIR = process.env.DEPLOY_APP_DIR;
if (!HOST || !APP_DIR) {
  console.error('✗ DEPLOY_HOST and DEPLOY_APP_DIR must be set (env, or in .env — see .env.example).');
  console.error('  DEPLOY_HOST=user@host   DEPLOY_APP_DIR=/opt/community-bus-maps');
  process.exit(1);
}

const sshBaseArgs = SSH_KEY ? ['-i', SSH_KEY] : [];
// BatchMode: never sit waiting on a password prompt from inside a script.
const SSH = ['ssh', ...sshBaseArgs, '-o', 'BatchMode=yes', HOST];

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  return r.status;
}

function sshRun(remoteCmd) {
  return run(SSH[0], [...SSH.slice(1), remoteCmd]);
}

// import-map.mjs / propose-update.mjs flags this script doesn't itself need to
// inspect are forwarded verbatim, --src rewritten to the remote staging path.
// --kind is deliberately left in for import mode (import-map.mjs reads it
// itself, same value this script used to pick the verify gate); propose mode
// forwards it too but propose-update.mjs simply doesn't look for a --kind flag,
// so it's harmless rather than worth special-casing out.
const passthroughArgs = process.argv.slice(2).filter((a, i, all) => {
  if (a === '--src') return false;
  if (all[i - 1] === '--src') return false;
  if (a === '--dry-run') return false;
  return true;
});

console.log('== deliver-map ==');
console.log(`  mode   : ${MODE}${MODE === 'propose' ? ` (refresh existing map "${MAP}")` : ' (new map)'}`);
console.log(`  src    : ${SRC}`);
console.log(`  kind   : ${KIND}`);
console.log(`  host   : ${HOST}`);
console.log(`  appDir : ${APP_DIR}`);
console.log('');

// 1. Copy the render dir to a timestamped scratch dir on the host.
// scp, not rsync: this repo's laptop side is Windows/Git Bash, which doesn't
// ship rsync (confirmed 2026-08-09 — same reason pull-backups.ps1 uses scp).
// IMPORTANT: remoteStage must NOT already exist when scp -r runs, or SRC lands
// nested one level down (remoteStage/<basename of SRC>/...) instead of
// remoteStage/* — scp -r's target-doesn't-exist-yet form is what makes the
// destination directory itself the copy of SRC's contents.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const remoteStage = `/tmp/deliver-map-${stamp}`;
console.log(`-- 1. scp -> ${HOST}:${remoteStage}`);
if (!DRY_RUN) {
  const scpArgs = SSH_KEY ? ['-i', SSH_KEY, '-o', 'BatchMode=yes'] : ['-o', 'BatchMode=yes'];
  scpArgs.push('-r', SRC, `${HOST}:${remoteStage}`);
  const rc = run('scp', scpArgs);
  if (rc !== 0) { console.error('✗ scp failed — aborting, nothing on the host was touched.'); process.exit(1); }
}

// 2. Pre-flight verify, in a throwaway container, service untouched.
const verifyScript = KIND === 'place' ? 'scripts/verify-reproduce-place.mjs' : 'scripts/verify-reproduce.mjs';
const verifyEnvVar = KIND === 'place' ? 'PLACE_FIXTURE_DIR' : 'FIXTURE_DIR';
console.log(`\n-- 2. pre-flight verify (${verifyScript}, SVG-only — see §2.5)`);
if (!DRY_RUN) {
  const verifyCmd =
    `cd ${APP_DIR} && docker compose run --rm -v ${remoteStage}:/fixture:ro ` +
    `-e ${verifyEnvVar}=/fixture portal node ${verifyScript}`;
  const rc = sshRun(verifyCmd);
  if (rc !== 0) {
    console.error('✗ pre-flight verify failed — the live service was NOT touched. Fix the mismatch and re-run.');
    sshRun(`rm -rf ${remoteStage}`);
    process.exit(1);
  }
  console.log('✓ pre-flight verify passed (SVG byte-identical).');
}

// 3. Stop the running service — only now, after the pre-flight passed.
console.log('\n-- 3. docker compose stop portal');
if (!DRY_RUN) {
  const rc = sshRun(`cd ${APP_DIR} && docker compose stop portal`);
  if (rc !== 0) { console.error('✗ could not stop the portal — aborting before touching data.'); process.exit(1); }
}

// 4. Run the importer/proposer inside a throwaway container against the staged dir.
const targetScript = MODE === 'propose' ? 'scripts/propose-update.mjs' : 'scripts/import-map.mjs';
const importArgsStr = ['--src', '/import', ...passthroughArgs].map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
console.log(`\n-- 4. ${targetScript} ${importArgsStr}`);
let importOk = true;
if (!DRY_RUN) {
  const importCmd =
    `cd ${APP_DIR} && docker compose run --rm -v ${remoteStage}:/import:ro ` +
    `portal node ${targetScript} ${importArgsStr}`;
  const rc = sshRun(importCmd);
  importOk = rc === 0;
  if (!importOk) {
    console.error(`✗ ${MODE === 'propose' ? 'propose-update' : 'import'} failed. The portal is left STOPPED on purpose — see this file's header before restarting it.`);
  }
}

// 5. Bring the service back up (only attempted if the import succeeded).
let healthOk = true;
if (importOk) {
  console.log('\n-- 5. docker compose up -d portal');
  if (!DRY_RUN) {
    const rc = sshRun(`cd ${APP_DIR} && docker compose up -d portal`);
    if (rc !== 0) { console.error('✗ could not restart the portal — check the host by hand.'); process.exit(1); }
  }

  // 6. Confirm liveness + readiness.
  console.log('\n-- 6. /health?deep=1');
  if (!DRY_RUN) {
    // A few seconds for the container to actually come up before probing it.
    // The return code is the point of this step: `curl -fsS` fails on a 503,
    // which is exactly what readiness returns when a dependency is unhealthy.
    // Until 2026-08-19 the status was discarded, so a delivery that left the
    // service unhealthy still printed "✓ delivered"
    // (technical-audit_2026-08-19 O3).
    const rc = run(SSH[0], [...SSH.slice(1), 'sleep 3 && curl -fsS localhost:5180/health?deep=1']);
    if (rc !== 0) {
      console.error('');
      console.error('FAILED: the portal restarted but is NOT healthy - /health?deep=1 did not return 200.');
      console.error('  The import SUCCEEDED and the container is UP; it is readiness that is failing.');
      console.error(`  Check it by hand:  ssh ${HOST} 'curl -sS localhost:5180/health?deep=1'`);
      console.error(`  and the logs:      ssh ${HOST} 'cd ${APP_DIR} && docker compose logs --tail=50 portal'`);
      healthOk = false;
    }
  }
}

// 7. Clean up the staging dir either way.
console.log(`\n-- 7. cleanup ${remoteStage}`);
if (!DRY_RUN) sshRun(`rm -rf ${remoteStage}`);

if (!importOk) process.exit(1);
if (!healthOk) process.exit(1);
console.log(MODE === 'propose'
  ? '\n✓ staged — see the propose-update output above for the customer review link.'
  : '\n✓ delivered.');
