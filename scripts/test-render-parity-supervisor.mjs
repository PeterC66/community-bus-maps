#!/usr/bin/env node
// test-render-parity-supervisor.mjs — the render-parity probe's exit is delivered
// by a supervisor, and this proves it in BOTH directions.
//
// WHY THIS EXISTS (buses-data OA-052, 2026-09-05). `render-parity-probe.mjs`
// hung on eight CI runs in a fortnight, always after its work was done and its
// verdict printed. The eighth — the first with a watchdog armed — showed the
// process reaching its 'exit' event and then never returning from native
// teardown, where a JS timer cannot fire. So the probe now runs itself as a
// child under a supervisor that reads a `PROBE VERDICT: exit <n>` line and, if
// the child is still alive a grace period later, kills it and exits <n>.
//
// A guard like that has two ways to be wrong, and a green run shows neither:
//   - it could rescue too EARLY, turning a hang in the work into a pass, or
//   - it could not rescue at all, leaving the step to its timeout as before.
// So the cases below are a pair on purpose. The simulation seams they drive are
// documented at the top of the probe and exist for nothing else. Each case runs
// the real rasterisation (about two seconds here), so the whole file takes
// under fifteen.
//
// Run it from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:render-parity-supervisor
// It is also discovered by `npm test`.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'scripts', 'render-parity-probe.mjs');
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

// Short graces so a rescued hang costs a second, not twenty-five.
const GRACE_MS = 400;

function runProbe(simulate, extraEnv = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [PROBE], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      RENDER_PARITY_PROBE_SIMULATE: simulate,
      PROBE_EXIT_GRACE_MS: String(GRACE_MS),
      PROBE_SUPERVISOR_GRACE_MS: String(GRACE_MS),
      ...extraEnv,
    },
    timeout: 60_000,
  });
  const m = /^PROBE VERDICT: exit (\d+)$/m.exec(r.stdout || '');
  return {
    status: r.status,
    signal: r.signal,
    ms: Date.now() - started,
    verdict: m ? Number(m[1]) : null,
    warned: /::warning::.*did not exit within/.test(r.stdout || ''),
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

console.log('test-render-parity-supervisor — the verdict survives the teardown, and only the teardown\n');

// 1. Control: no simulation. The exit code IS the verdict line, and nothing
//    warned. This is the everyday run.
{
  const r = runProbe('');
  check(r.verdict != null, 'control: the child printed a PROBE VERDICT line', `stdout ends: ${r.stdout.slice(-300)}`);
  check(r.status === r.verdict, 'control: the supervisor exits with the verdict', `status ${r.status}, verdict ${r.verdict}`);
  check(!r.warned, 'control: no hang warning on a clean exit', 'a ::warning:: was printed');
  check(/RESULT: /.test(r.stdout), 'control: the RESULT line still reaches stdout unchanged', 'no RESULT line');
}

// 2. A real non-zero verdict passes through untouched. The supervisor must not
//    launder a failing probe into a pass, and must not need a hang to report.
{
  const r = runProbe('exit:3');
  check(r.verdict === 3, 'non-zero verdict: the child printed exit 3', `verdict ${r.verdict}`);
  check(r.status === 3, 'non-zero verdict: the supervisor exits 3', `status ${r.status}`);
  check(!r.warned, 'non-zero verdict: no hang warning', 'a ::warning:: was printed');
}

// 3. THE EIGHTH HANG'S SHAPE. The child prints its verdict, reaches its 'exit'
//    event, and never returns. The in-process watchdog cannot fire (the thread
//    is blocked). The supervisor must warn, kill it, and exit with the verdict —
//    within a few graces, not the step's five minutes.
{
  const r = runProbe('hang-after-verdict');
  check(r.verdict != null, 'post-verdict hang: the verdict line was printed before the hang', `stdout ends: ${r.stdout.slice(-300)}`);
  check(r.warned, 'post-verdict hang: the supervisor printed the ::warning::', `stdout ends: ${r.stdout.slice(-300)}`);
  check(r.status === r.verdict, 'post-verdict hang: the exit code is the verdict, not a signal death', `status ${r.status}, signal ${r.signal}, verdict ${r.verdict}`);
  check(/exit' event reached/.test(r.stderr), 'post-verdict hang: the child got as far as its exit handler', 'no exit-event breadcrumb on stderr');
  check(!/EXIT DID NOT COMPLETE/.test(r.stderr), 'post-verdict hang: the in-process watchdog could NOT fire (the thread was blocked)', 'the watchdog fired, so this simulation is not the eighth hang\'s shape');
  check(r.ms < 30_000, 'post-verdict hang: rescued in seconds, not minutes', `${r.ms} ms`);
}

// 4. A stall BEFORE the verdict is NOT rescued. The grace is 400 ms and the
//    stall is 2.5 s: if the supervisor armed on anything but the verdict line,
//    the run would end early with a wrong code. It must wait the child out.
{
  const STALL = 2500;
  const r = runProbe(`stall-before-verdict:${STALL}`);
  check(r.verdict != null, 'pre-verdict stall: the child eventually printed its verdict', `stdout ends: ${r.stdout.slice(-300)}`);
  check(r.status === r.verdict, 'pre-verdict stall: exit code is the child\'s own verdict', `status ${r.status}, verdict ${r.verdict}`);
  check(!r.warned, 'pre-verdict stall: NOT treated as the teardown hang (no ::warning::)', 'the supervisor warned before any verdict existed');
  check(r.ms >= STALL, 'pre-verdict stall: the supervisor waited the stall out rather than rescuing early', `${r.ms} ms < ${STALL} ms`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
