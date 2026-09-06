// prove-red-landmark-arrivals.mjs — falsify the landmark-arrival suite (OA-253).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-landmark-arrivals
//
// WHY THIS EXISTS. Two of the four things test-landmark-arrivals.mjs asserts are
// SILENCES, and a silence is the hardest thing to test green: a guard that has
// stopped guarding produces exactly the output an intact one does on every happy
// path. The suite's most valuable assertion — "a side with no candidates reports
// no arrivals rather than the whole of the other side" — passes trivially against
// a comparison that has been switched off altogether.
//
// So each behaviour is broken ON PURPOSE and required to go red BY ITSELF, and
// the harness checks WHICH assertion objected rather than that something did: a
// mutation caught by the wrong assertion means the suite is sensitive to the
// damage but not for the reason claimed.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY, the same way its neighbour does —
// `scripts/` and `src/` are copied into a scratch tree and the copy is damaged.
// Nothing is moved aside and restored, because a harness that restores in a
// `finally` still leaves the repository broken if it is killed between the two.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-lm-arrivals-'));
  for (const dir of ['scripts', 'src']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  // public/app only, and copied rather than linked because two mutations damage
  // changes.js. The rest of public/ is megabytes of images nothing here reads.
  cpSync(path.join(ROOT, 'public', 'app'), path.join(tmp, 'public', 'app'), { recursive: true });
  // views/ carries the page shells, and the suite's JOIN assertion reads
  // editor.html to ask whether the page that must call the shared helper loads
  // the file defining it. Left out at first, and the CONTROL is what said so —
  // an intact copy failed with ENOENT rather than every mutation quietly passing.
  cpSync(path.join(ROOT, 'views'), path.join(tmp, 'views'), { recursive: true });
  // Linked, not copied: large, and nothing here damages them. NEVER point
  // damage() at a path under one of these — a junction leads back into the real
  // checkout, so an edit "to the copy" would vandalise the repository. `engine`
  // carries poi_select.js, which is what turns an osm.json into candidates, so
  // without it every case would enumerate nothing and every mutation would
  // "survive" for a reason that is not the guard's fault.
  for (const dir of ['node_modules', 'engine', 'data']) {
    const from = path.join(ROOT, dir); const to = path.join(tmp, dir);
    if (!existsSync(from)) continue;
    try { symlinkSync(from, to, 'junction'); } catch { cpSync(from, to, { recursive: true }); }
  }
  writeFileSync(path.join(tmp, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));
  return tmp;
}

/** Edit one file in the scratch copy. Fails loudly if the anchor has moved — a
 *  mutation whose anchor no longer matches is a STALE harness, not a pass. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

function runSuite(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-landmark-arrivals.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const failedLines = (out) => out.split('\n').filter((l) => /^ {2}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

const REFRESH = 'src/refresh/index.js';
const PUBLISH = 'src/publish/index.js';
// public/app is COPIED (not linked) because these two mutations damage it.
const CHANGES = 'public/app/changes.js';
const EDITOR = 'public/app/editor.js';

let problems = 0;
const say = (tag, line, detail) => {
  console.log(`${tag.padEnd(14)} ${line}`);
  if (detail) console.log(`               ${detail}`);
};

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) {
    problems++;
    // The TAIL, not only the ✗ lines: a control that fails by CRASHING has no ✗
    // lines at all, and an empty detail is the report that sends somebody hunting
    // the wrong thing.
    const detail = failedLines(r.out).map((l) => l.trim()).join(' | ')
      || r.out.trim().split('\n').slice(-6).map((l) => l.trim()).join(' / ');
    say('✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guards', detail);
  } else say('ok CONTROL', 'an intact copy passes', '');
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'the comparison no longer falls silent when one side lists nothing',
    why: 'a payload with no osm.json, an unloadable selector or a place pack makes the WHOLE of the other side read as arrivals — "145 new places" on a refresh that changed none',
    edits: [[REFRESH, 'const landmarksKnown = oldPois.length > 0 && newPois.length > 0;', 'const landmarksKnown = true;']],
    expect: 'reporting no arrivals rather than two',
  },
  {
    what: 'a landmark change stops moving the `unchanged` verdict',
    why: 'isEmptyDataChange() returns `unchanged` verbatim when present, so every screen goes on calling a refresh identical while a new symbol lands on the sheet',
    edits: [[REFRESH, 'unchanged: summary.unchanged && !lm.added.length && !lm.removed.length,', 'unchanged: summary.unchanged,']],
    expect: 'a landmark-only refresh is NOT unchanged',
  },
  {
    what: 'arrivals are measured against the wrong side',
    why: 'the set difference is the whole of this feature; inverted, a steady map reports its entire landmark list as new every month',
    edits: [[REFRESH, 'added: uniq(list(to).filter((p) => p && !fromKeys.has(String(p.key))).map(pick)).sort(byKey),',
      'added: uniq(list(to).filter((p) => p && !toKeys.has(String(p.key))).map(pick)).sort(byKey),']],
    expect: 'two arrivals, sorted by key',
  },
  {
    what: 'two candidates sharing one key are reported twice',
    why: 'a key really can be shared since OA-234 (two unnamed pharmacies), and one arrival counted twice is a number a customer cannot reconcile with the list',
    edits: [[REFRESH, 'if (seen.has(p.key)) continue; seen.add(p.key); out.push(p);', 'out.push(p);']],
    expect: 'two candidates sharing a key are one arrival',
  },
  {
    what: 'the verdict-less fallback forgets landmarks',
    why: 'a summary from a partial producer carries the fields and no verdict, and the two ways of answering "did anything change" would then disagree',
    // `);` and not `));` — the trailing `))` in the source closes some( and !(,
    // so dropping the call needs one closer, not two. The first draft left a
    // syntax error and the harness reported WRONG CAUSE rather than a pass,
    // which is the report a mutation that never ran should get.
    edits: [[PUBLISH, "|| some('landmarksAdded') || some('landmarksRemoved'));", ');']],
    expect: 'a verdict-less summary carrying an arrival is not empty',
  },
  {
    what: 'the arrival bullet stops being rendered at all',
    why: 'the whole feature is a SENTENCE; the diff can be perfect while the screen that carries it says nothing, which is indistinguishable from the silence this row exists to end',
    edits: [[CHANGES, "if (n('landmarksAdded')) {", 'if (false) {']],
    expect: 'one arrival reads in the singular',
  },
  {
    what: 'the name list loses its cap',
    why: 'landmark churn was never measurable on this laptop, so the one thing the line must survive is a long answer — uncapped, a refresh could print forty shop names into a bullet',
    edits: [[CHANGES, 'const shown = named.slice(0, 6).join(\', \');', "const shown = named.join(', ');"]],
    expect: 'the seventh name is not printed',
  },
  {
    what: 'the editor stops rendering through the shared helper',
    why: 'every other assertion here tests a function that might reach nobody — the JOIN between the helper and the page that must call it is the one thing they all take on trust',
    edits: [[EDITOR, 'PC().landmarkBullets(sum, { chooserHref:', 'PC().nothingAtAll(sum, { chooserHref:']],
    expect: 'its data summary renders through landmarkBullets',
  },
  {
    what: 'the chooser link stops being escaped',
    why: 'it is written straight into an href attribute; built from MAP_ID today, but the one renderer two screens share must not trust its caller',
    edits: [[CHANGES, '<a href="${esc(href)}">Choose the landmarks</a>', '<a href="${href}">Choose the landmarks</a>']],
    expect: 'the chooser link is escaped',
  },
];

for (const m of MUTATIONS) {
  const tmp = scratch();
  let r;
  try {
    for (const [rel, find, replace] of m.edits) damage(tmp, rel, find, replace);
    r = runSuite(tmp);
  } catch (e) {
    problems++;
    say('✗ STALE', m.what, e.message.split('\n')[0]);
    rmSync(tmp, { recursive: true, force: true });
    continue;
  }
  if (r.code === 0) {
    problems++;
    say('✗ SURVIVED', m.what, m.why);
  } else if (!caughtBy(r.out, m.expect)) {
    problems++;
    say('✗ WRONG CAUSE', m.what, `expected "${m.expect}" to object; instead: ${failedLines(r.out).map((l) => l.trim()).join(' | ') || '(no ✗ line — it crashed)'}`);
  } else {
    say('ok caught', m.what, '');
  }
  rmSync(tmp, { recursive: true, force: true });
}

console.log(problems
  ? `\n${problems} problem(s): the suite did not object to something it must object to.`
  : `\nAll ${MUTATIONS.length} mutations were caught by the assertion that names them, and the control passed.`);
process.exit(problems ? 1 : 0);
