#!/usr/bin/env node
// A DELIVERY'S --src IS THE RENDER THE MAP CALLS CURRENT.
//
//   node scripts/test-newest-render.mjs     (or: npm run test:newest-render)
//
// WHY IT EXISTS (buses-data OA-368). On 2026-09-15 the first customer's four
// maps were delivered, and the render folder for each was chosen with
// `ls -1 <map>/S5-render | tail -1`. That sorts lexicographically, so `v2.9`
// wins over `v2.32` and `v1.9` over `v1.19`, and three of the four were
// delivered from a render 10, 10 and 23 builds old. The portal's pre-flight
// byte gate refused ONE of the three — its 26 August render regenerates larger
// under the deployed engine — and PASSED the other two, because that engine
// change happens not to alter those two sheets. Both are publicly live and a
// fortnight out of date. The byte gate's silence carried no information about
// staleness at all: it was never asking that question, and nothing was.
//
// THE FIXTURE IS THE FAULT, NOT A MODEL OF IT. Section 2 uses the four real
// maps of that handover with their real run names, read from the table in
// OA-368, and requires the predicate to refuse the three that were wrong and
// pass the one that was right. A check that refused all four would be
// indistinguishable from a check that refuses everything, so the one correct
// delivery is the control that makes the other three mean something.
//
// Section 1 is the primitive: `v1.9` against `v1.19`, both directions, so the
// text-sort fault itself is asserted rather than only its consequences.
// Section 3 is every way of not knowing, each of which must be its OWN verdict
// — "could not check" and "checked and fine" reporting alike is the failure the
// S6 gate beside this one was written for (technical-audit_2026-08-19 V2).
// Section 4 holds deliver-map.mjs's wiring to the predicate, because a gate
// that is never called is the other way this ships green.
//
// It takes an optional tree root, which is how prove-red-newest-render.mjs runs
// it against a mutated copy without touching the repository.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TREE = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); failures++; }
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { checkNewestRender } = await import(
  new URL(`file://${path.join(TREE, 'scripts', 'lib', 'newest-render.mjs').replace(/\\/g, '/')}`).href
);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-newest-render-'));

/**
 * A map tree with the named S5 runs on disk and `latest` naming one of them.
 * `latest` may name a run that is NOT in `onDisk`, which is a real state: the
 * folder is gitignored and prune_runs.py deletes old ones.
 */
function mapTree(town, { onDisk = [], latest = null, runs = null, manifest = 'write' } = {}) {
  const dir = path.join(scratch, town);
  for (const r of onDisk) mkdirSync(path.join(dir, 'S5-render', r), { recursive: true });
  mkdirSync(dir, { recursive: true });
  if (manifest === 'write') {
    const ids = runs === null ? onDisk : runs;
    const stages = { S5: { name: 'render', latest, runs: ids.map((id) => ({ id, dir: `S5-render/${id}`, at: '2026-09-13T20:27' })) } };
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ town, stages }, null, 1));
  } else if (manifest === 'garbage') {
    writeFileSync(path.join(dir, 'manifest.json'), '{ not json');
  }
  return (run) => path.join(dir, 'S5-render', run);
}

// ---------------------------------------------------------------------------
console.log('\n1. the text-sort fault itself, in both the orders that produce it');
// ---------------------------------------------------------------------------
{
  const src = mapTree('Minortown', { onDisk: ['v1.9_2026-08-30_1609', 'v1.19_2026-09-13_2027'], latest: 'v1.19_2026-09-13_2027' });
  eq('v1.9 delivered while the manifest says v1.19 is superseded',
    checkNewestRender(src('v1.9_2026-08-30_1609')).verdict, 'superseded');
  eq('…and v1.19 itself is current', checkNewestRender(src('v1.19_2026-09-13_2027')).verdict, 'current');
  const r = checkNewestRender(src('v1.9_2026-08-30_1609'));
  eq('…the refusal names the run being delivered', r.runId, 'v1.9_2026-08-30_1609');
  eq('…and the one the manifest calls current', r.latest, 'v1.19_2026-09-13_2027');
  check('…and the message names both', /v1\.9_2026-08-30_1609/.test(r.message) && /v1\.19_2026-09-13_2027/.test(r.message));
}
{
  // THE MANIFEST IS THE AUTHORITY, EVEN OVER A RUN THAT IS VERSION-NEWER. A
  // hand-built `v3.1` sitting beside the `v2.32` the manifest calls current is
  // picked by every ordering there is — text or version — and it is still not
  // the run this map records. "Not the current run" is the whole of the claim,
  // so a comparison that had quietly become "is anything newer present?" is red
  // here and green everywhere else.
  const src = mapTree('Majortown', { onDisk: ['v2.32_2026-09-13_2028', 'v3.1_2026-09-14_0900'], latest: 'v2.32_2026-09-13_2028' });
  eq('a run that sorts LATER than the current one is still superseded',
    checkNewestRender(src('v3.1_2026-09-14_0900')).verdict, 'superseded');
  eq('…and the current one is current', checkNewestRender(src('v2.32_2026-09-13_2028')).verdict, 'current');
}

// ---------------------------------------------------------------------------
console.log('\n2. the four maps of the 2026-09-15 handover, with their real run names');
// ---------------------------------------------------------------------------
// Delivered-from and current, exactly as OA-368's own table records them. Three
// were wrong; St Neots (area) was right, by luck of the sort, and it is the
// control — a predicate that refused all four would prove nothing.
const HANDOVER = [
  ['St Neots Co-op', 'v1.9_2026-08-30_1609', 'v1.19_2026-09-13_2027', 'superseded'],
  ['St Neots Tesco Extra', 'v2.9_2026-08-30_1609', 'v2.19_2026-09-13_2028', 'superseded'],
  ['St Neots Town Centre', 'v2.9_2026-08-26_1857', 'v2.32_2026-09-13_2028', 'superseded'],
  ['St Neots', 'v4.2_2026-09-13_2026', 'v4.2_2026-09-13_2026', 'current'],
];
for (const [town, delivered, current, want] of HANDOVER) {
  const runs = delivered === current ? [delivered] : [delivered, current];
  const src = mapTree(town, { onDisk: runs, latest: current });
  eq(`${town}: delivered ${delivered}, manifest says ${current}`, checkNewestRender(src(delivered)).verdict, want);
}
check('…and the one correct delivery is the control: exactly three of the four refuse',
  HANDOVER.filter(([, , , w]) => w === 'superseded').length === 3);

// ---------------------------------------------------------------------------
console.log('\n3. every way of not knowing is its own verdict, and none of them is a pass');
// ---------------------------------------------------------------------------
// Every verdict this section produces is collected, so the closing assertion is
// over the cases actually run rather than over a list typed beside them.
const unknowns = [];
const notKnowing = (name, src) => { const v = checkNewestRender(src).verdict; unknowns.push([name, v]); return v; };
{
  const src = mapTree('Manifestless', { onDisk: ['v1.0_2026-09-13_2027'], latest: null, manifest: 'none' });
  eq('a render folder with no manifest above it is cannot-tell', notKnowing('no manifest', src('v1.0_2026-09-13_2027')), 'cannot-tell');
}
{
  const src = mapTree('Garbagetown', { onDisk: ['v1.0_2026-09-13_2027'], latest: null, manifest: 'garbage' });
  eq('…and an unparseable manifest is too', notKnowing('unparseable manifest', src('v1.0_2026-09-13_2027')), 'cannot-tell');
}
{
  const src = mapTree('Latestless', { onDisk: ['v1.0_2026-09-13_2027'], latest: null });
  eq('…and a manifest naming no current S5 run is too', notKnowing('no stages.S5.latest', src('v1.0_2026-09-13_2027')), 'cannot-tell');
}
{
  // The committed fixture pack. It has no version in its path to go stale, so
  // no manifest claims anything about it and there is nothing to contradict.
  const dir = path.join(scratch, '_portal-fixture', 'Some Place');
  mkdirSync(dir, { recursive: true });
  eq('a --src that is not a versioned render folder at all is not-a-render', notKnowing('not a render folder', dir), 'not-a-render');
}
{
  // prune_runs.py deletes old runs and S5-render is gitignored, so a tree can
  // record a current render it does not hold. That is a reason to go and get
  // it, never a reason to let the older one through.
  const src = mapTree('Prunedtown', { onDisk: ['v1.9_2026-08-30_1609'], runs: ['v1.9_2026-08-30_1609', 'v1.19_2026-09-13_2027'], latest: 'v1.19_2026-09-13_2027' });
  const r = checkNewestRender(src('v1.9_2026-08-30_1609'));
  eq('a current render that is NOT on this disk still supersedes', r.verdict, 'superseded');
  eq('…and the absence is reported rather than silently decisive', r.latestOnDisk, false);
  check('…and the message says so', /NOT on this disk/.test(r.message));
}
check(`none of the ${unknowns.length} ways of not knowing returns "current"`,
  unknowns.length === 4 && !unknowns.some(([, v]) => v === 'current'),
  unknowns.map(([n, v]) => `${n}=${v}`).join(', '));

// ---------------------------------------------------------------------------
console.log('\n4. deliver-map.mjs actually calls it, and refuses on the answer');
// ---------------------------------------------------------------------------
// A predicate nothing calls is how the de-duplication of these two questions
// would ship green: the whole of OA-368 is a check that existed in three places
// and on none of the paths a delivery takes.
{
  const src = readFileSync(path.join(TREE, 'scripts', 'deliver-map.mjs'), 'utf8');
  check('it imports checkNewestRender from lib/newest-render.mjs', /import\s*\{\s*checkNewestRender\s*\}\s*from\s*'\.\/lib\/newest-render\.mjs'/.test(src));
  check('it calls it', /checkNewestRender\(\s*SRC\s*\)/.test(src));
  check('the superseded branch exits non-zero', /REFUSED \(SUPERSEDED\)[\s\S]{0,1600}?process\.exit\(1\)/.test(src));
  check('so does the cannot-tell branch', /0b\. Newest render: CANNOT TELL[\s\S]{0,1600}?process\.exit\(1\)/.test(src));
  check('--render-superseded is the named override', /--render-superseded/.test(src));
  check('…and it is stripped from the args forwarded to the importer',
    /if \(a === '--render-superseded'\) return false;[\s\S]{0,120}?if \(all\[i - 1\] === '--render-superseded'\) return false;/.test(src));
  // The CALL, not the identifier. `function gateNewestRender() {` also contains
  // the name, sits above the scp wherever the call goes, and would keep this
  // assertion green while the gate ran after the upload — which is how a check
  // on a source ordering quietly stops asserting anything.
  const callSite = src.indexOf('gateNewestRender();');
  check('the gate is actually CALLED, not only defined', callSite !== -1);
  check('…and the call runs BEFORE the scp, so a refusal has uploaded nothing',
    callSite !== -1 && callSite < src.indexOf('-- 1. scp'));
}

console.log('');
if (failures) { console.error(`✗ ${failures} failure(s)`); process.exit(1); }
console.log('✓ newest-render: all checks passed');
