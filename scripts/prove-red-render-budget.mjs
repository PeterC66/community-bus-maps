// prove-red-render-budget.mjs — falsify the per-user render budget (buses-data OA-039).
//
// Run from the repository root (`C:\Claude\community-bus-maps`, no placeholders):
//     npm run test:prove-red-render-budget
//
// WHY. Every failure this guards against is SILENT and looks exactly like
// success. A budget keyed on the wrong subject still refuses somebody, a budget
// per route still refuses eventually, and a budget in front of the ownership
// check still refuses only people who are asking for too much. Nothing 500s and
// no page breaks in any of them. O7 itself survived a month as "done" because
// its limit half had shipped for the public POSTs and nothing asked which routes
// were left — so the way to know these assertions bite is to build each wrong
// version on purpose and watch its own case go red.
//
//   0  control: the tree unmutated                     -> the suite exits 0
//   1  the budget check on /preview deleted            -> NO LIMIT, the state before this change
//   2  keyed on the caller's ADDRESS, not their id     -> THE NAIVE FIX
//   3  a counter per ROUTE instead of one per user     -> the walk-around
//   4  the check moved IN FRONT of the ownership guard -> a stranger spends the owner's budget
//
// CASE 2 IS THE ONE THIS FILE IS REALLY FOR. `rateLimited(req.ip, 20)` is the
// obvious fix, it is one character shorter than the right one, and it passes any
// test that only counts to twenty-one. It reddens three assertions here for
// three different reasons — one office shares a bucket, the public per-address
// limit is consumed by rendering, and a stranger's requests spend the owner's
// allowance — and none of the three is visible from a single caller.
//
// Nothing in the working tree is touched: the repository is copied to a temp
// directory, one file is edited there, and the copy's suite is run.
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

/* The suite reaches for its subjects relative to its own location, so a copy of
 * it runs the copied, damaged code. `node_modules/` and `engine/` are linked
 * rather than copied — they are large, and nothing here damages them. */
const TREE = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-render-budget-'));
for (const dir of ['scripts', 'src', 'views', 'public']) {
  cpSync(path.join(ROOT, dir), path.join(TREE, dir), { recursive: true });
}
for (const dir of ['node_modules', 'engine']) {
  const from = path.join(ROOT, dir), to = path.join(TREE, dir);
  try { symlinkSync(from, to, 'junction'); }
  catch { cpSync(from, to, { recursive: true }); }
}
writeFileSync(path.join(TREE, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));

function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [path.join(TREE, 'scripts', 'test-render-budget.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** Apply one or more anchored edits in the scratch tree, run the suite, restore. */
function mutate({ label, edits, expect }) {
  const originals = new Map();
  for (const { file, find, to, count = 1 } of edits) {
    const p = path.join(TREE, file);
    const before = readFileSync(p, 'utf8');
    if (!originals.has(p)) originals.set(p, before);
    const n = before.split(find).length - 1;
    // A mutation whose anchor no longer matches is a STALE harness, not a pass.
    if (n !== count) {
      for (const [q, text] of originals) writeFileSync(q, text);
      fail(`${label}: anchor matched ${n} times in ${file}, not ${count} — the mutation did not do what it says`);
      return;
    }
    writeFileSync(p, before.split(find).join(to));
  }
  const r = run();
  for (const [p, text] of originals) writeFileSync(p, text);
  if (r.status === 0) { fail(`${label}: SURVIVED — the suite passed against broken code`); return; }
  // "it went red" and "it went red for this reason" are different claims, and
  // only the second one says the assertion you think is guarding this is.
  for (const want of [].concat(expect)) {
    if (!r.out.includes(want)) { fail(`${label}: went red, but not on the assertion that names it (wanted "${want}")`); return; }
  }
  ok(`${label} -> ${[].concat(expect).map((e) => `"${e}"`).join(' + ')}`);
}

const BUDGET_CALL = 'if (renderBudgetSpent(user)) return reply.code(429).send({ ok: false, error: RENDER_BUDGET_MESSAGE });';
const PREVIEW_CALL = `    // AFTER the ownership check, so a caller hammering somebody else's map is
    // refused by the guard and spends none of their own budget on it.
    ${BUDGET_CALL}
`;

console.log('control — the tree as committed:');
{
  const r = run();
  if (r.status === 0) ok('test-render-budget.mjs passes unmutated');
  else fail(`the suite is ALREADY red — every case below would be meaningless:\n${r.out}`);
}

console.log('\nno limit at all — the state this change found:');
mutate({
  label: '1  the budget check deleted from POST /api/maps/:id/preview',
  edits: [{ file: 'src/routes/editor.js', find: PREVIEW_CALL, to: '' }],
  expect: 'Alice is refused on render',
});

console.log('\nthe subject the budget is keyed on:');
mutate({
  label: '2  keyed on the ADDRESS rather than the user — rateLimited(req.ip), the naive fix',
  edits: [
    {
      file: 'src/http/helpers.js',
      find: '  return rateLimited(`render:${user.id}`, RENDER_BUDGET, RENDER_WINDOW_MS);',
      to: '  return rateLimited(user.__ip, RENDER_BUDGET, RENDER_WINDOW_MS);',
    },
    { file: 'src/routes/editor.js', find: 'renderBudgetSpent(user)', to: 'renderBudgetSpent({ ...user, __ip: req.ip })', count: 2 },
  ],
  // Three assertions, three separate consequences of one wrong key.
  expect: [
    'Bob is served from the SAME address',
    'a public POST from that address is still served',
    "a stranger's requests spent the owner's budget",
  ],
});

console.log('\none budget or one each:');
mutate({
  label: '3  a counter per ROUTE — /preview and /save stop sharing',
  edits: [{ file: 'src/routes/editor.js', find: PREVIEW_CALL, to: `    if (renderBudgetSpent({ ...user, id: \`preview-\${user.id}\` })) return reply.code(429).send({ ok: false, error: RENDER_BUDGET_MESSAGE });\n` }],
  expect: 'a save is refused on a budget spent entirely on previews',
});

console.log('\nwhere the check sits relative to the guard:');
mutate({
  label: '4  the check moved IN FRONT of loadOwnedMap',
  edits: [{
    file: 'src/routes/editor.js',
    find: `    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
${PREVIEW_CALL}`,
    to: `    ${BUDGET_CALL}
    const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
    if (!map) return reply.code(code).send({ ok: false, error });
`,
  }],
  expect: 'a non-owner is refused by the guard and never by the budget',
});

console.log(failures ? `\n${failures} case(s) failed` : '\nevery case went red for its own reason');
process.exit(failures ? 1 : 0);
