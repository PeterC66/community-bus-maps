// The periodic sweep of the public rate-limit counter — codebase review
// 2026-09-28 R4 G8 (buses-data OA-504, Tier 1.1), as assertions.
//
//   node scripts/test-hits-sweep.mjs        (or: npm run test:hits-sweep)
//
// WHY THIS FILE EXISTS. The per-address counter in src/http/helpers.js has two
// bounds: a hard cap inside rateLimited() and a sweep every five minutes that
// evicts entries whose window has closed. The cut that moved the counter out of
// server.js on 2026-09-03 exported rateLimited and not sweepHits, and server.js
// went on calling `sweepHits()` inside `try {} catch {}`. ESM is strict, so every
// sweep was a ReferenceError that the empty catch swallowed, for twenty-five
// days, and nothing could see it: the test suite builds the app with
// CBM_NO_LISTEN=1, which skips the block the timer lives in.
//
// SO THIS ASKS TWO THINGS, and neither covers the other:
//
//   1. The sweep itself: an entry whose window has closed is evicted, and one
//      still inside its window is kept. Driven through startHitsSweep's own
//      sweepNow(), which is the guarded function the timer runs.
//   2. The WIRING, read from server.js's source because the listen block cannot
//      run here: it imports startHitsSweep from ./http/helpers.js, calls it, and
//      keeps no empty catch anywhere. Half 1 alone stays green if server.js
//      stops calling the sweep again, which is exactly the fault it replaces.
//
// Runs against a throwaway DATA_DIR; no network, no email, no real portal data.

import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-hits-sweep-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const helpers = await import('../src/http/helpers.js');

console.log('the sweep evicts a closed window and keeps an open one');
check('helpers.js exports startHitsSweep', typeof helpers.startHitsSweep === 'function');
if (typeof helpers.startHitsSweep === 'function') {
  const logged = [];
  const log = { error: (...a) => logged.push(a) };
  const { timer, sweepNow } = helpers.startHitsSweep(log, 3_600_000);
  clearInterval(timer);

  const realNow = Date.now;
  try {
    const t0 = realNow();
    Date.now = () => t0;
    helpers.rateLimited('203.0.113.1');           // will be expired at the sweep
    Date.now = () => t0 + 50_000;
    helpers.rateLimited('203.0.113.2');           // still inside its window
    Date.now = () => t0 + 61_000;
    eq('the first sweep evicts exactly the expired entry', sweepNow(), 1);
    eq('a second sweep finds nothing left to evict', sweepNow(), 0);
    Date.now = () => t0 + 111_000;
    eq('the kept entry is evicted once its own window closes', sweepNow(), 1);
  } finally {
    Date.now = realNow;
  }
  eq('no sweep logged an error', logged.length, 0);
}

console.log('server.js starts the sweep and swallows nothing');
const serverSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js'), 'utf8');
const importLine = serverSrc.split('\n').find((l) => /from '\.\/http\/helpers\.js'/.test(l)) || '';
check('server.js imports startHitsSweep from ./http/helpers.js', /\bstartHitsSweep\b/.test(importLine), importLine.slice(0, 120));
check('server.js calls startHitsSweep(app.log)', /\bstartHitsSweep\(app\.log\b/.test(serverSrc));
check('server.js names no bare sweepHits', !/\bsweepHits\b/.test(serverSrc));
check('server.js has no empty catch', !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(serverSrc));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall hits-sweep checks passed');
