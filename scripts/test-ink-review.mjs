#!/usr/bin/env node
// A REFRESH IS NOT DELIVERED UNLESS THE MONTH'S INK REVIEW LETS THIS BUILD THROUGH.
//
//   node scripts/test-ink-review.mjs     (or: npm run test:ink-review)
//
// WHY IT EXISTS (buses-data OA-658). On 2026-10-20 two place maps were delivered by
// hand under accepts for the build before, because only stage_refresh.mjs asked the
// ink review and deliver-map.mjs did not. Step 0e now does, through
// scripts/lib/ink-review.mjs, and records the staging afterwards.
//
// Section 1 is every verdict, each beside the case that flips it. Section 2 is the
// render-to-build join. Section 3 is which review judges a map that two list.
// Section 4 is the record command. Section 5 holds deliver-map.mjs's wiring,
// because a gate that is never called ships green.
//
// It takes an optional tree root, which is how prove-red-ink-review.mjs runs it
// against a mutated copy without touching the repository.

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
const verdictIs = (name, r, want) => check(name, r.verdict === want, `got ${r.verdict}: ${r.message}`);

const { checkInkReview, buildOf, proposalFrom, recordArgs } = await import(
  new URL(`file://${path.join(TREE, 'scripts', 'lib', 'ink-review.mjs').replace(/\\/g, '/')}`).href
);

const B1 = 'v1.45_2026-10-13_1950', B2 = 'v1.46_2026-10-19_2006';
const PLACE = 'Areas/Beaconsfield/Places/Beaconsfield Simpson Centre';
let n = 0;

/**
 * A buses tree: `reviews` maps a scan to its maps (or to raw text), and one map folder
 * at `dir` whose manifest has S4 builds `builds` and S5 renders `renders` (an S5 entry
 * is an id, or an object to spread). Returns the S5 folder of `deliver`.
 */
function tree({ reviews = {}, dir = PLACE, builds = [B1, B2], renders = [B1, B2], deliver = B2, manifestRaw, gtfs = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), `cbm-ink-review-${++n}-`));
  if (gtfs) mkdirSync(path.join(root, '_gtfs'), { recursive: true });
  for (const [scan, maps] of Object.entries(reviews)) {
    writeFileSync(path.join(root, '_gtfs', `ink-review_${scan}.json`), typeof maps === 'string' ? maps : JSON.stringify({ schema: 1, scan, maps }));
  }
  const mapDir = path.join(root, dir);
  const s5 = renders.map((r) => (typeof r === 'string' ? { id: r, dir: `S5-render/${r}`, version: r.slice(1).split('_')[0] } : r));
  const manifest = { stages: { S4: { runs: builds.map((id) => ({ id, dir: `S4-generate/${id}`, version: id.slice(1).split('_')[0], outputs: ['internal.svg'] })) }, S5: { runs: s5 } } };
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(path.join(mapDir, 'manifest.json'), manifestRaw ?? JSON.stringify(manifest));
  const src = path.join(mapDir, 'S5-render', deliver);
  mkdirSync(src, { recursive: true });
  return src;
}
const entry = (extra = {}) => ({ map: 'Beaconsfield Simpson Centre', kind: 'place', dir: PLACE, status: 'ink-moved', before: 'v1.30_2026-09-20_1000', after: B2, answer: { verdict: 'accept', by: 'peter', at: 'T', after: B2 }, ...extra });
const one = (e, extra = {}) => checkInkReview({ srcDir: tree({ reviews: { '2026-10-01': [e] }, ...extra }) });

console.log('1. every verdict, beside the case that flips it');
verdictIs('an accept of this build is covered', one(entry()), 'covered');
verdictIs('ink moved and no answer is uncovered', one(entry({ answer: null })), 'uncovered');
verdictIs('a hold is uncovered', one(entry({ answer: { verdict: 'hold', by: 'peter', at: 'T', after: B2, note: 'icon doubled' } })), 'uncovered');
check('  and says his reason', /held .* \(icon doubled\)/.test(one(entry({ answer: { verdict: 'hold', by: 'p', at: 'T', after: B2, note: 'icon doubled' } })).message));
verdictIs('an accept of another build is uncovered', one(entry({ answer: { verdict: 'accept', by: 'p', at: 'T', after: B1 } })), 'uncovered');
/* The case itself: the review compared and accepted v1.45, and the render delivered is v1.46. */
const stale = one(entry({ after: B1, answer: { verdict: 'accept', by: 'peter', at: 'T', after: B1 } }));
verdictIs('THE 2026-10-20 CASE: an accept of v1.45 does not cover a render of v1.46', stale, 'uncovered');
check('  and names both builds and the re-collection', /compared .*v1\.45.*render is of v1\.46.*Re-collect/.test(stale.message), stale.message);
verdictIs('  and delivering v1.45 itself IS covered', one(entry({ after: B1, answer: { verdict: 'accept', by: 'p', at: 'T', after: B1 } }), { deliver: B1 }), 'covered');
verdictIs('no ink moved on this build is covered', one(entry({ status: 'no-ink', answer: null })), 'covered');
verdictIs('  and no ink moved on ANOTHER build is not', one(entry({ status: 'no-ink', answer: null, after: B1 })), 'uncovered');
verdictIs('a map the review could not read is uncovered', one(entry({ status: 'unreadable', answer: null })), 'uncovered');
verdictIs('this build already staged is already-staged', one(entry({ staged: { after: B2, by: 's6winddown', at: '2026-10-20', proposal: 186 } })), 'already-staged');
verdictIs('  and an older build staged is not', one(entry({ staged: { after: B1, by: 'x', at: 'T' } })), 'covered');
verdictIs('a map no review lists is not-in-review', one({ ...entry(), dir: 'Areas/Elsewhere', map: 'Elsewhere' }), 'not-in-review');
verdictIs('a tree with no _gtfs folder is not-in-review', checkInkReview({ srcDir: tree({ gtfs: false }) }), 'not-in-review');
verdictIs('a review file that will not parse is cannot-tell — it may hold this map', checkInkReview({ srcDir: tree({ reviews: { '2026-10-01': [entry()], '2026-11-01': '{ not json' } }) }), 'cannot-tell');
verdictIs('a manifest that will not parse is cannot-tell', one(entry(), { manifestRaw: '{ nope' }), 'cannot-tell');
verdictIs('a --src the manifest does not list is cannot-tell', one(entry(), { renders: [B1] }), 'cannot-tell');
verdictIs('no manifest above --src at all is cannot-tell', checkInkReview({ srcDir: mkdtempSync(path.join(os.tmpdir(), 'cbm-ink-none-')) }), 'cannot-tell');
verdictIs('an area entry with no dir is found under Areas/<map>', checkInkReview({ srcDir: tree({ reviews: { '2026-10-01': [{ map: 'March', status: 'no-ink', after: B2 }] }, dir: 'Areas/March' }) }), 'covered');

console.log('\n2. the render is joined to its build through the manifest, never the folder name');
{
  const skew = { id: 'v1.46_2026-10-19_2007', dir: 'S5-render/v1.46_2026-10-19_2007', version: '1.46' };
  verdictIs('a render named a minute after its build is that build', one(entry(), { renders: [B1, skew], deliver: skew.id }), 'covered');
  const declared = { id: 'x', dir: 'S5-render/x', basedOn: { S4: B1 } };
  verdictIs('a render that declares its build is taken at its word, against the accept of another', one(entry(), { renders: [declared], deliver: 'x' }), 'uncovered');
  check('buildOf reads basedOn first, then the version', buildOf({ stages: { S4: { runs: [{ id: B2, version: '1.46' }] } } }, { id: 'v1.46_x' }) === B2 && buildOf({}, { basedOn: { S4: 'q' } }) === 'q');
}

console.log('\n3. the current review, the newest scan\'s, is the one that judges');
{
  const older = { ...entry(), answer: { verdict: 'accept', by: 'p', at: 'T', after: B2 } };
  const newer = { ...entry(), answer: null };
  verdictIs('an accept in an OLDER review does not cover a map the current one leaves unanswered', checkInkReview({ srcDir: tree({ reviews: { '2026-10-01': [older], '2026-11-01': [newer] } }) }), 'uncovered');
  verdictIs('  and the other way round it is covered', checkInkReview({ srcDir: tree({ reviews: { '2026-10-01': [newer], '2026-11-01': [older] } }) }), 'covered');
  const r = checkInkReview({ srcDir: tree({ reviews: { '2026-10-01': [{ ...entry(), answer: null }], '2026-11-01': [{ map: 'Other', dir: 'Areas/Other', status: 'no-ink', after: B2 }] } }) });
  check('a map only an older review lists is not in the current review — that review decides nothing now', r.verdict === 'not-in-review' && /2026-11-01/.test(r.message), `${r.verdict}: ${r.message}`);
  verdictIs('a broken OLDER review does not block a map the current one covers', checkInkReview({ srcDir: tree({ reviews: { '2026-09-01': '{ nope', '2026-10-01': [older] } }) }), 'covered');
}

console.log('\n4. the staging is recorded by the tool that owns the record');
check('the proposal number is read from propose-update\'s success line', proposalFrom('...\n✓ proposed update #186 staged for "Beaconsfield Simpson Centre" (#12)\n') === 186);
check('  and nothing else is taken for it', proposalFrom('dry run — a proposed update for "X" (#12)\n· would supersede still-pending proposed update #9') === null);
{
  const a = recordArgs({ inkReviewJs: 'IR', root: 'R', scan: '2026-10-01', map: 'Beaconsfield Simpson Centre', slug: 'beaconsfield-simpson-centre', proposal: 186, by: 'deliver-map', notify: 'digest' });
  check('the record command is ink_review.mjs --staged with the map, slug, proposal and who', a.join(' ') === 'IR --buses R --scan 2026-10-01 --staged --town Beaconsfield Simpson Centre --map beaconsfield-simpson-centre --proposal 186 --by deliver-map --notify digest', a.join(' '));
  check('  and owes no digest when the delivery emailed its customer itself', !recordArgs({ inkReviewJs: 'IR', root: 'R', scan: 's', map: 'm', slug: 'm', proposal: 1, by: 'b', notify: null }).includes('--notify'));
}

console.log('\n5. deliver-map.mjs calls the gate and records the staging');
{
  const src = readFileSync(path.join(TREE, 'scripts', 'deliver-map.mjs'), 'utf8');
  check('it calls gateInkReview in refresh mode', /if \(MODE === 'propose'\) \{[\s\S]{0,400}INK = gateInkReview\(\);/.test(src));
  check('--ink-unchecked is stripped from the args forwarded to the host', src.includes("if (a === '--ink-unchecked') return false;") && src.includes("if (all[i - 1] === '--ink-unchecked') return false;"));
  check('--by is stripped too, since propose-update would reject it', src.includes("if (a === '--by') return false;"));
  check('it records with recordArgs after a covered, healthy staging', /INK\.verdict === 'covered' && !DRY_RUN[\s\S]{0,1500}run\(process\.execPath, argv\)/.test(src));
  check('  owing the digest exactly when it went with --no-notify', src.includes("notify: has('no-notify') ? 'digest' : null"));
  check('  and reads the proposal number from step 4\'s own output', src.includes('proposalFrom(importOut)') && src.includes('importOut = res.out;'));
}

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all checks passed');
process.exit(failures ? 1 : 0);
