#!/usr/bin/env node
// A MAP IS NOT DELIVERED WHILE ONE OF ITS BLOCKING LOCAL QUESTIONS IS OPEN.
//
//   node scripts/test-local-decisions.mjs     (or: npm run test:local-decisions)
//
// WHY IT EXISTS (buses-data OA-083). Every map build writes the questions only
// somebody local can answer into the map folder's local-decisions.json, marking
// `blocking` the ones where our printed guess could misdirect a passenger. On
// the day this gate landed three maps held such a question with no answer, one
// of them never put to anyone, and nothing between the build and the live site
// read the mark. deliver-map.mjs step 0c now does, through
// scripts/lib/local-decisions.mjs.
//
// Section 1 is every answer state: only `answered` and `dont-know` clear, and a
// state the gate has not learned must refuse rather than pass. Advisory
// questions never block, whatever their state — the control that shows the gate
// is reading severity and not refusing everything. Section 2 is every way of not
// knowing, each its own verdict. Section 3 is the waivers: per DECISION, never
// per map, and expiring. Section 4 reads the shipped waiver file. Section 5
// holds deliver-map.mjs's wiring, because a gate that is never called ships
// green.
//
// It takes an optional tree root, which is how prove-red-local-decisions.mjs
// runs it against a mutated copy without touching the repository.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const { checkLocalDecisions, findDecisionWaiver } = await import(
  new URL(`file://${path.join(TREE, 'scripts', 'lib', 'local-decisions.mjs').replace(/\\/g, '/')}`).href
);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-local-decisions-'));
let n = 0;
/** A map folder with a manifest, a render dir, and (unless undefined) a local-decisions.json. */
function mapWith(decisions, { raw, manifest = true } = {}) {
  const d = path.join(scratch, `map${++n}`);
  const src = path.join(d, 'S5-render', 'v1.0');
  mkdirSync(src, { recursive: true });
  if (manifest) writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ town: `Town ${n}` }));
  if (raw !== undefined) writeFileSync(path.join(d, 'local-decisions.json'), raw);
  else if (decisions !== undefined) writeFileSync(path.join(d, 'local-decisions.json'), JSON.stringify({ decisions }));
  return src;
}
const dec = (id, severity, answer) => ({ id, severity, question: `Q ${id}?`, answer });

console.log('1. answer states');
const stateCase = (label, answer, want) => {
  const r = checkLocalDecisions({ srcDir: mapWith([dec('q', 'blocking', answer)]) });
  eq(`blocking, ${label} -> ${want}`, r.verdict, want);
};
stateCase('never asked (answer null)', null, 'outstanding');
stateCase('never asked (state null)', { state: null }, 'outstanding');
stateCase('asked', { state: 'asked' }, 'outstanding');
stateCase('open', { state: 'open' }, 'outstanding');
stateCase('partly-answered', { state: 'partly-answered' }, 'outstanding');
stateCase('a state the gate has not learned', { state: 'resolved-ish' }, 'outstanding');
stateCase('answered', { state: 'answered', value: 'x' }, 'clear');
stateCase('dont-know', { state: 'dont-know' }, 'clear');
eq('advisory, never asked -> clear (severity is read, not everything refused)',
  checkLocalDecisions({ srcDir: mapWith([dec('a', 'advisory', null)]) }).verdict, 'clear');
{
  const r = checkLocalDecisions({ srcDir: mapWith([dec('a', 'advisory', null), dec('b', 'blocking', { state: 'asked' }), dec('c', 'blocking', { state: 'answered' })]) });
  eq('a mix names exactly the open blocking one', r.outstanding.map((o) => o.id).join(','), 'b');
  eq('…with its state', r.outstanding[0] && r.outstanding[0].state, 'asked');
  check('…and the map by its manifest name', /^Town \d+$/.test(r.map), r.map);
}

console.log('\n2. every way of not knowing is its own verdict');
eq('no local-decisions.json -> no-file', checkLocalDecisions({ srcDir: mapWith(undefined) }).verdict, 'no-file');
eq('unparseable JSON -> unreadable', checkLocalDecisions({ srcDir: mapWith(undefined, { raw: '{ not json' }) }).verdict, 'unreadable');
eq('no decisions array -> unreadable', checkLocalDecisions({ srcDir: mapWith(undefined, { raw: '{"questions":[]}' }) }).verdict, 'unreadable');
eq('no manifest above --src -> no-manifest', checkLocalDecisions({ srcDir: mapWith([], { manifest: false }) }).verdict, 'no-manifest');

console.log('\n3. waivers are per decision and expire');
const now = new Date('2026-10-01T12:00:00Z');
const waivers = { waive: [{ map: 'Ramsey', decision: 'q1', until: '2026-10-31', why: 'w', removeBy: 'r' },
  { map: 'Ramsey', decision: 'old', until: '2026-09-01', why: 'w', removeBy: 'r' }] };
check('a live waiver is found for its map and decision', findDecisionWaiver(waivers, 'ramsey', 'q1', { now })?.expired === false);
eq('a waiver does NOT cover another decision on the same map', findDecisionWaiver(waivers, 'Ramsey', 'q2', { now }), null);
eq('a waiver does NOT cover the same decision id on another map', findDecisionWaiver(waivers, 'Soham', 'q1', { now }), null);
eq('a waiver past its until is expired', findDecisionWaiver(waivers, 'Ramsey', 'old', { now })?.expired, true);

console.log('\n4. the shipped waiver file');
let shipped = null;
try { shipped = JSON.parse(readFileSync(path.join(TREE, 'scripts', 'local-decision-waivers.json'), 'utf8')); } catch (e) { check('local-decision-waivers.json parses', false, e.message); }
if (shipped) {
  check('local-decision-waivers.json parses, with a waive array', Array.isArray(shipped.waive));
  for (const w of shipped.waive || []) {
    check(`${w.map} / ${w.decision}: map, decision, a dated until, why and removeBy`,
      Boolean(w.map && w.decision && /^\d{4}-\d{2}-\d{2}$/.test(w.until || '') && w.why && w.removeBy));
  }
}

console.log('\n5. deliver-map.mjs wiring');
const dm = readFileSync(path.join(TREE, 'scripts', 'deliver-map.mjs'), 'utf8');
check('imports the predicate from lib/local-decisions.mjs', /import \{[^}]*checkLocalDecisions[^}]*\} from '\.\/lib\/local-decisions\.mjs'/.test(dm));
const call = dm.search(/^\s*gateLocalDecisions\(\);/m);
const scp = dm.indexOf("console.log(`-- 1. scp");
check('calls gateLocalDecisions()', call !== -1);
check('…BEFORE the scp', call !== -1 && scp !== -1 && call < scp, `call at ${call}, scp at ${scp}`);
const body = dm.slice(dm.indexOf('function gateLocalDecisions'), dm.indexOf('if (LOCAL_DECISIONS_UNCHECKED)'));
check('the refusal exits non-zero', /REFUSED[\s\S]*process\.exit\(1\);\s*\}\s*$/.test(body));
check('--local-decisions-unchecked is stripped from the forwarded args',
  /a === '--local-decisions-unchecked'\) return false/.test(dm) && /all\[i - 1\] === '--local-decisions-unchecked'\) return false/.test(dm));

console.log(failures ? `\n✗ ${failures} failure(s)` : '\n✓ all local-decisions checks pass');
process.exit(failures ? 1 : 0);
