#!/usr/bin/env node
/*
 * test-deploy-track-engine.mjs — deploy.mjs step 5b, which brings the live
 * store's map packs up to the engine a deploy just shipped (docs/DEPLOY.md §4a,
 * scripts/lib/track-live.mjs).
 *
 *     node scripts/test-deploy-track-engine.mjs
 *
 * The step's whole claim is a JOIN: that `track-engine.mjs`'s report form exits
 * 0 exactly when every tracked pack matches the vendored engine and no `?` row
 * exists, and that the deploy reads THAT exit code as its verdict. So the first
 * half of this test runs the REAL track-engine.mjs against scratch stores —
 * through an `ssh` stand-in that checks the remote command's shape and then runs
 * it here with DATA_DIR pointed at the scratch store — rather than asserting
 * against the author's belief about what the script returns.
 *
 * WHAT MAKES IT WORTH ANYTHING IS ARM S2: `--apply` succeeds and the read-back
 * still says behind. A step that trusted the write's exit code instead of reading
 * the store back goes green there, and that is the shape this whole repository
 * keeps paying for (a stateful action is done when a READ says so).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackLiveStore, TRACK_APPLY, TRACK_REPORT } from './lib/track-live.mjs';
import { hashOf } from './lib/vendored.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = '/opt/community-bus-maps';

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!cond) {
    failures += 1;
    if (extra !== undefined) console.log(`        ${extra}`);
  }
};

const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-track-live-'));

/** A scratch DATA_DIR holding one map per entry: { id: { file: contents } }. */
function store(maps) {
  const dataDir = mkdtempSync(path.join(tmp, 'data-'));
  for (const [id, files] of Object.entries(maps)) {
    const d = path.join(dataDir, 'maps', id, 'data');
    mkdirSync(d, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(d, name), body);
  }
  return dataDir;
}

/** An `ssh` stand-in: refuses any command not of the shape the host needs, then
 *  runs the track-engine invocation here against `dataDir`. */
function localSsh(dataDir, calls) {
  const prefix = `cd ${APP_DIR} && docker compose exec -T portal `;
  return (remote) => {
    calls.push(remote);
    if (!remote.startsWith(prefix)) return 99;
    const cmd = remote.slice(prefix.length);
    if (cmd !== TRACK_APPLY && cmd !== TRACK_REPORT) return 98;
    const args = cmd.split(' ').slice(1);
    const r = spawnSync(process.execPath, args, {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir },
    });
    return r.status;
  };
}

/** An `ssh` stand-in returning scripted statuses in order. */
function scripted(statuses, calls) {
  return (remote) => { calls.push(remote); return statuses.shift(); };
}

const VENDORED_INTERNAL = readFileSync(path.join(ROOT, 'engine/place/gen_internal.js'));
const RADIAL = 'area/gen_external_radial.js';
const declares = (rel) => JSON.stringify({ recorded: 'import', generators: { 'gen_external.js': rel } });

// --- the real track-engine.mjs, through the stand-in -----------------------

{
  // R1: two packs behind, one unambiguous and one declared — both brought forward.
  const dataDir = store({
    1: { 'gen_internal.js': '// frozen at import\n' },
    2: { 'gen_external.js': '// frozen at import\n', 'engine-source.json': declares(RADIAL) },
  });
  const calls = [];
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: localSsh(dataDir, calls) });
  check('ARM R1: packs behind are brought forward and the read-back passes', r.ok, r.message);
  check('ARM R1: apply runs first, then the report form', calls.length === 2
    && calls[0].endsWith(TRACK_APPLY) && calls[1].endsWith(TRACK_REPORT), JSON.stringify(calls));
  check('ARM R1: the pack now equals the vendored generator',
    readFileSync(path.join(dataDir, 'maps/1/data/gen_internal.js')).equals(VENDORED_INTERNAL));
  check('ARM R1: the declared external pack now equals the radial generator',
    hashOf(path.join(dataDir, 'maps/2/data/gen_external.js')) === hashOf(path.join(ROOT, 'engine', RADIAL)));
}
{
  // R2: a pack declaring a generator this engine no longer vendors — `?`, and --apply cannot fix it.
  const dataDir = store({ 3: { 'gen_external.js': '// busway\n', 'engine-source.json': declares('area/gen_external_busway.js') } });
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: localSsh(dataDir, []) });
  check('ARM R2: a pack naming an unvendored generator fails the step', !r.ok && r.reportStatus === 1, JSON.stringify(r));
}
{
  // R3: a declaration that will not parse — answered, but unheard.
  const dataDir = store({ 4: { 'gen_external.js': '// ?\n', 'engine-source.json': '{ not json' } });
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: localSsh(dataDir, []) });
  check('ARM R3: an unparseable engine-source.json fails the step', !r.ok, JSON.stringify(r));
}
{
  // R4: an undeclared external — the benign `·` skip: left alone, and not a failure.
  const dataDir = store({ 5: { 'gen_external.js': '// undeclared\n' } });
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: localSsh(dataDir, []) });
  check('ARM R4: an undeclared external pack is skipped, not failed', r.ok, r.message);
  check('ARM R4: and it is not overwritten',
    readFileSync(path.join(dataDir, 'maps/5/data/gen_external.js'), 'utf8') === '// undeclared\n');
}
{
  // R5: an empty store — the deploy of a portal with no maps.
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: localSsh(store({}), []) });
  check('ARM R5: a store with nothing in it passes', r.ok, r.message);
}

// --- the verdict, from scripted exit codes ---------------------------------

{
  // S1: the host was never reached.
  const calls = [];
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: scripted([255], calls) });
  check('ARM S1: an ssh failure fails the step and does not read back a store it never reached',
    !r.ok && calls.length === 1 && /not reached/.test(r.message), JSON.stringify({ r, calls }));
}
{
  // S2: THE FALSIFYING ARM — the write says 0, the read says behind.
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: scripted([0, 1], []) });
  check('ARM S2: a clean --apply followed by a behind read-back FAILS the step', !r.ok, JSON.stringify(r));
}
{
  // S3: the read-back itself did not run.
  const r = trackLiveStore({ appDir: APP_DIR, sshRun: scripted([0, 255], []) });
  check('ARM S3: a read-back that could not run fails the step', !r.ok && /unconfirmed/.test(r.message), JSON.stringify(r));
}

// --- the wiring: deploy.mjs calls it and does not swallow the verdict ------

{
  const src = readFileSync(path.join(ROOT, 'scripts/deploy.mjs'), 'utf8');
  check('ARM W1: deploy.mjs calls trackLiveStore with its own sshRun',
    /trackLiveStore\(\{\s*appDir:\s*APP_DIR,\s*sshRun\s*\}\)/.test(src));
  check('ARM W2: deploy.mjs exits non-zero when tracking failed',
    /if \(tracking && !tracking\.ok\) \{[\s\S]*?process\.exit\(1\);/.test(src));
  check('ARM W3: step 5b runs after the switch (step 4) and before the sign-in test (step 6)',
    src.indexOf('-- 4. docker compose up') < src.indexOf('-- 5b.')
    && src.indexOf('-- 5b.') < src.indexOf('-- 6. sign-in'));
}

rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures) {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ the deploy tracks the live store to the engine it shipped, and reads the store back to say so.');
