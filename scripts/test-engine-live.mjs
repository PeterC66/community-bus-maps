#!/usr/bin/env node
// A MAP IS NOT DELIVERED TO A HOST WHOSE ENGINE LAGS ORIGIN/MAIN.
//
//   node scripts/test-engine-live.mjs     (or: npm run test:engine-live)
//
// WHY IT EXISTS. On 2026-10-01 every St Neots delivery died at step 2 with
// `Cannot find module '/app/engine/legend_key.js'`: the host was at a96a758 and
// origin/main f5d1d91 had re-vendored that file and place_pointer.js (#452,
// #455). deliver-map.mjs step 0d now asks first, through
// scripts/lib/engine-live.mjs; see that file's header for the incident.
//
// Section 1 replays the incident against this repository's own history — the
// two commits are on main for good, and test.yml checks out with fetch-depth 0.
// Section 2 is the control: an engine-identical pair, including a later commit
// that touched no engine file, reads `current`. Section 3 is every way of not
// knowing, each `cannot-tell` and never `current`. Section 4 holds
// deliver-map.mjs's wiring, because a gate that is never called ships green.
//
// It takes an optional tree root, which is how prove-red-engine-live.mjs runs it
// against a mutated copy without touching the repository. Git is always asked
// of THIS clone, whose history the mutated copy does not carry.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TREE = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); failures++; }
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { checkEngineLive } = await import(pathToFileURL(path.join(TREE, 'scripts', 'lib', 'engine-live.mjs')).href);
const sha = (ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

// The incident's two commits, and a later one that touched no engine file.
const LIVE = sha('a96a758');     // the host on 2026-10-01
const WANTED = sha('f5d1d91');   // origin/main that morning
const LATER = sha('6a57b4b');    // deploy-history only
if (!LIVE || !WANTED || !LATER) {
  console.error('✗ this clone does not hold a96a758, f5d1d91 and 6a57b4b — a shallow checkout? test.yml uses fetch-depth 0.');
  process.exit(1);
}

console.log('1. the real incident: host a96a758, origin/main f5d1d91');
{
  const r = checkEngineLive({ hostHead: LIVE, wanted: WANTED, cwd: ROOT });
  eq('real incident -> behind', r.verdict, 'behind');
  const added = (r.files || []).filter((f) => f.status === 'A').map((f) => f.path);
  check('names engine/legend_key.js as missing on the host', added.includes('engine/legend_key.js'), JSON.stringify(r.files));
  check('names engine/place_pointer.js as missing on the host', added.includes('engine/place_pointer.js'), JSON.stringify(r.files));
  check('reports only files under engine/', (r.files || []).every((f) => f.path.startsWith('engine/')), JSON.stringify(r.files));
}

console.log('\n2. control: the same engine reads current');
eq('host = origin/main -> current', checkEngineLive({ hostHead: WANTED, wanted: WANTED, cwd: ROOT }).verdict, 'current');
eq('a later commit that touched no engine file -> current', checkEngineLive({ hostHead: WANTED, wanted: LATER, cwd: ROOT }).verdict, 'current');

console.log('\n3. every way of not knowing is cannot-tell');
eq('empty HEAD', checkEngineLive({ hostHead: '', wanted: WANTED, cwd: ROOT }).verdict, 'cannot-tell');
eq('an ssh banner instead of a sha', checkEngineLive({ hostHead: 'fatal: not a git repository', wanted: WANTED, cwd: ROOT }).verdict, 'cannot-tell');
eq('an unknown commit', checkEngineLive({ hostHead: '0123456789abcdef0123456789abcdef01234567', wanted: WANTED, cwd: ROOT }).verdict, 'cannot-tell');
eq('a wanted ref that does not exist', checkEngineLive({ hostHead: WANTED, wanted: 'origin/no-such-branch', cwd: ROOT }).verdict, 'cannot-tell');

console.log('\n4. deliver-map.mjs wiring');
{
  const src = readFileSync(path.join(TREE, 'scripts', 'deliver-map.mjs'), 'utf8');
  const call = src.indexOf('\n  gateEngineLive();');
  const scp = src.indexOf("-- 1. scp");
  check('deliver-map.mjs calls gateEngineLive()', call !== -1);
  check('…before the scp', call !== -1 && scp !== -1 && call < scp);
  check('…outside any --dry-run guard, so a rehearsal asks too', call !== -1 && !/if \(!DRY_RUN\)[^\n]*\n[^\n]*gateEngineLive\(\);/.test(src));
  check('--engine-unchecked is stripped from the args forwarded to the host',
    src.includes("if (a === '--engine-unchecked') return false;") && src.includes("if (all[i - 1] === '--engine-unchecked') return false;"));
  check('the refusal names npm run deploy', /REFUSED \(HOST BEHIND\)[\s\S]*npm run deploy/.test(src));
}

console.log(failures ? `\n✗ ${failures} failure(s)` : '\n✓ all passed');
process.exit(failures ? 1 : 0);
