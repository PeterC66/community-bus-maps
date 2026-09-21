// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// The sample band: who gets it, how it comes off again, and whether every
// render path actually asks (buses-data OA-320).
//
//   node scripts/test-sample-band.mjs
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No
// arguments and no placeholders.
//
// FOUR SECTIONS, AND THE THIRD IS THE ONE THAT EARNS ITS KEEP.
//
// 1. THE PREDICATE. isSampleCustomer() decides whether a sheet says "Not
//    published by any organisation". Every way of NOT knowing must answer
//    "sample": a null customer, a row with no such column, a SELECT that forgot
//    to join it. Only an explicit 0/false is a real organisation.
//
// 2. THE ROUND TRIP. unstampPilot(stampPilot(s)) must be byte-identical to s.
//    The reconciler leans on that to take a band off a sheet already in the
//    object store — if the inverse were approximate, reassigning a map would
//    quietly rewrite the artwork an approver signed off.
//
// 3. THE THREADING. `sample` defaults to TRUE, which is the right direction for
//    safety and the wrong one for noticing: a render path that forgets to pass
//    it keeps banding a real customer's sheet and looks exactly like one that
//    asked and got "yes". No test of behaviour can see that, because the
//    behaviour is identical. So this reads the call sites and requires each to
//    have asked — the same reason claude-skills' gate:wiring exists, which is
//    that a claim about coverage is a claim about a JOIN.
//
// 4. THE RECONCILER. Over a throwaway store, both directions, plus the case the
//    live deploy must produce: nothing to do.

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (what, ok, detail = '') => {
  if (ok) { console.log(`  ✓ ${what}`); return; }
  failures += 1;
  console.error(`  ✗ ${what}${detail ? `\n      ${detail}` : ''}`);
};
const eq = (what, got, want) => check(what, Object.is(got, want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// A store of our own, set BEFORE anything that reads db/paths.js at module load.
const STORE = mkdtempSync(path.join(tmpdir(), 'cbm-sample-band-'));
process.env.DATA_DIR = STORE;

const { isSampleCustomer, stampPilot, unstampPilot, hasPilotBand } = await import('../src/render/pilotStamp.js');
const { PILOT } = await import('../src/config.js');

// ---------------------------------------------------------------------------
console.log('\n1. THE PREDICATE — every way of not knowing means "sample"\n');

eq('a null customer is a sample', isSampleCustomer(null), true);
eq('so is undefined', isSampleCustomer(undefined), true);
eq('so is a row with no columns joined', isSampleCustomer({}), true);
eq('so is is_sample undefined — a SELECT that forgot the join', isSampleCustomer({ name: 'x' }), true);
eq('is_sample = 1 is a sample', isSampleCustomer({ is_sample: 1 }), true);
eq('is_sample = 0 is a REAL organisation', isSampleCustomer({ is_sample: 0 }), false);
eq('is_sample = false is too', isSampleCustomer({ is_sample: false }), false);
eq('a demo organisation is a sample whatever is_sample says', isSampleCustomer({ is_sample: 0, is_demo: 1 }), true);
eq('...and that is the rule docs/PILOT.md states about demo data', isSampleCustomer({ is_sample: false, is_demo: true }), true);
eq('a string is not an organisation', isSampleCustomer('busmaps-uk-pilot'), true);

// ---------------------------------------------------------------------------
console.log('\n2. THE ROUND TRIP — the inverse is exact, not approximate\n');

const SHEET = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="297mm" height="210mm">'
  + '<rect x="0" y="0" width="297" height="210" fill="#ffffff"/><text x="10" y="20">a sheet</text></svg>';

check('the pilot is ON in this process, or sections 2 and 4 prove nothing', PILOT.on,
  'PILOT_MODE=0 is set — unset it to run this test meaningfully');

const banded = stampPilot(SHEET);
check('stampPilot adds a band', hasPilotBand(banded));
check('...and the plain sheet has none', !hasPilotBand(SHEET));
eq('unstampPilot(stampPilot(s)) === s, byte for byte', unstampPilot(banded), SHEET);
eq('stamping twice is a no-op', stampPilot(banded), banded);
eq('unstamping an unbanded sheet is a no-op', unstampPilot(SHEET), SHEET);
check('a document with no viewBox is declined rather than mangled',
  stampPilot('<svg xmlns="http://www.w3.org/2000/svg"></svg>') === '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
check('the band carries the sentence this whole change is about',
  banded.includes('Not published by any organisation'),
  'if this wording moved, docs/PILOT.md and OA-320 describe a band that no longer exists');

// ---------------------------------------------------------------------------
console.log('\n2b. THE GATE ITSELF — generateSvg(), end to end, on a stub generator\n');

// The whole mechanism turns on one line in renderMap.js, and section 3 can only
// see whether callers ASKED, not whether asking does anything. A real map pack
// is 30 MB and gitignored, so CI has none — but generateSvg() only spawns `node
// <generator>` with cwd set to the data dir and then reads the file it wrote, so
// a four-line stub generator exercises the real function for real.
const { generateSvg } = await import('../src/render/renderMap.js');
const GEN_DIR = path.join(STORE, 'stub');
mkdirSync(GEN_DIR, { recursive: true });
writeFileSync(path.join(GEN_DIR, 'gen_internal.js'),
  `require('node:fs').writeFileSync(require('node:path').join(__dirname, 'internal.svg'), ${JSON.stringify(SHEET)});\n`);

{
  const { svgPath } = generateSvg({ dataDir: GEN_DIR, generator: 'gen_internal.js', sample: true });
  check('sample: true bands the generator output', hasPilotBand(readFileSync(svgPath, 'utf8')));
}
{
  const { svgPath } = generateSvg({ dataDir: GEN_DIR, generator: 'gen_internal.js', sample: false });
  check('sample: false leaves it alone — this is the line the whole change turns on',
    !hasPilotBand(readFileSync(svgPath, 'utf8')),
    'generateSvg stamped a sheet it was told was a real organisation’s');
}
{
  const { svgPath } = generateSvg({ dataDir: GEN_DIR, generator: 'gen_internal.js' });
  check('...and omitting it bands, because the default is the honest one',
    hasPilotBand(readFileSync(svgPath, 'utf8')));
}
{
  const { svgPath } = generateSvg({ dataDir: GEN_DIR, generator: 'gen_internal.js', stamp: false, sample: true });
  check('stamp: false still beats sample: true — the reproduce gates are untouched',
    !hasPilotBand(readFileSync(svgPath, 'utf8')));
}

// ---------------------------------------------------------------------------
console.log('\n3. THE THREADING — every render path asked, because a default of true is invisible\n');

// generateSvg() is the real boundary — it is the function that decides whether
// stampPilot() runs — so the sweep asks of it and of the two wrappers that carry
// the answer to it. A call SATISFIES the rule by passing `sample:`, or by passing
// `stamp: false`, which turns off every post-generation fix and is what the
// byte-identical reproduce gates do on purpose.
//
// Each exemption names a reason, in the shape scripts/run-tests.mjs uses for its
// own exclusions, and is keyed on a snippet unique to that call rather than on
// the file: src/maps/engine.js holds both a call that must ask and one that must
// not, and a file-level exemption would have covered them both.
const EXEMPT = [
  { file: 'src/maps/engine.js', match: 'editorKeys: true',
    why: 'enumeratePoisFromDir — renders only to read its own data-key tags; nobody sees this SVG' },
  { file: 'src/expert/index.js', match: 'DIAGRAM_GEN',
    why: 'the diagram-tuning sandbox: an admin positioning pins, never a shippable sheet (and the diagram is parked)' },
  { file: 'scripts/seed-demo.mjs', match: 'renderVersion(',
    why: 'every organisation it invents is is_demo, and isSampleCustomer() bands those whatever else is set' },
  { file: 'src/maps/engine.js', match: 'outputsConfig, collect, opts',
    why: 'the one-line forwarder: preview() hands the opts it was given, sample included, straight to previewFrom()' },
];
const used = new Set();

const CALL = /\b(generateSvg|renderVersion|previewFrom|preview)\s*\(/g;

/** The balanced argument text of a call whose `(` is at `open`. */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open, open + 400); // unbalanced — judge it on what there is
}

const files = [];
for (const dir of ['src', 'scripts']) {
  const walk = (d) => {
    for (const e of readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(e.name)) files.push(rel);
    }
  };
  walk(dir);
}

let sites = 0;
for (const rel of files) {
  if (rel.startsWith('scripts/test-') || rel.startsWith('scripts/prove-red-')) continue;
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  CALL.lastIndex = 0;
  let m;
  while ((m = CALL.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index));
    // Skip prose, imports and the declarations of the functions themselves.
    if (/^\s*(\/\/|\*|import\b|export (async )?function\b|function\b)/.test(line)) continue;
    if (/^\s*export (async )?function/.test(line)) continue;

    const open = m.index + m[0].length - 1;
    const args = argsAt(src, open);
    const lineNo = src.slice(0, m.index).split('\n').length;
    sites += 1;

    const asked = /\bsample\b\s*[,:}]/.test(args) || args.includes('sample:');
    const optedOut = /\bstamp\s*:\s*false/.test(args);
    // Match against the call LINE as well as its arguments: a snippet a reader
    // would pick out is as often the callee's own name as something inside the
    // parentheses, and argsAt() returns only what is between them.
    const ex = EXEMPT.find((e) => e.file === rel && (args.includes(e.match) || line.includes(e.match)));
    if (ex) used.add(ex);

    const verdict = asked ? 'passes sample:'
      : optedOut ? 'passes stamp: false — no post-generation fixes at all'
        : ex ? `exempt — ${ex.why}`
          : 'MUST pass sample:';
    check(`${rel}:${lineNo} ${m[1]}() ${verdict}`, asked || optedOut || !!ex,
      `${line.trim().slice(0, 110)}\n      a render path that does not ask keeps banding a real customer's sheet, and looks identical to one that asked`);
  }
}
check(`the sweep actually found call sites (${sites})`, sites >= 12,
  'if this collapses the section is green over an empty population, which is the failure it exists to prevent');

// An exemption nothing matched is an exemption for a call that has gone — and
// the next reader would take it as cover for a call it was never written about.
for (const e of EXEMPT) {
  check(`the exemption for ${e.file} (${e.match}) still matches a real call`, used.has(e),
    'delete it, or fix the snippet — a stale exemption is cover nobody granted');
}

// ---------------------------------------------------------------------------
console.log('\n4. THE RECONCILER — both directions, over a store of our own\n');

const { reconcileMapRenders, storedMapIds } = await import('../src/render/pilotReconcile.js');

function seedMap(id, svg) {
  const dir = path.join(STORE, 'maps', String(id), 'renders', 'v1.0');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'internal.svg'), svg);
  return path.join(dir, 'internal.svg');
}

const bandedPath = seedMap(1, banded);   // a stored sample sheet
const plainPath = seedMap(2, SHEET);     // a stored real-customer sheet

check('storedMapIds() finds both', storedMapIds().sort().join(',') === '1,2', storedMapIds().join(','));

let r = await reconcileMapRenders(1, true, { apply: false });
eq('a sample sheet under a sample customer needs nothing', r.changed, 0);
r = await reconcileMapRenders(2, false, { apply: false });
eq('a plain sheet under a real customer needs nothing', r.changed, 0);

r = await reconcileMapRenders(1, false, { apply: false });
eq('a sample sheet under a REAL customer would change', r.changed, 1);
check('...and a dry run wrote nothing', hasPilotBand(readFileSync(bandedPath, 'utf8')));

r = await reconcileMapRenders(1, false, { apply: true });
eq('--apply takes the band off', r.changed, 1);
eq('...leaving exactly the bytes the generator wrote', readFileSync(bandedPath, 'utf8'), SHEET);

r = await reconcileMapRenders(2, true, { apply: true });
eq('and it puts one on for a sample customer', r.changed, 1);
check('...which is the band', hasPilotBand(readFileSync(plainPath, 'utf8')));

r = await reconcileMapRenders(2, true, { apply: true });
eq('running it again is a no-op — it is idempotent', r.changed, 0);

// The live deploy's acceptance test, in miniature: every map a sample, nothing
// to do. OA-320 says any other number on the day is the bug.
const stillNothing = (await reconcileMapRenders(2, true, { apply: false })).changed;
eq('the state OA-320 predicts for the live deploy: zero changed', stillNothing, 0);

// ---------------------------------------------------------------------------
if (failures) {
  console.error(`\n✗ ${failures} sample-band check(s) failed`);
  process.exit(1);
}
console.log('\n✓ all sample-band checks passed');
