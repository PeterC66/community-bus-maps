// prove-red-review-plugin.mjs — falsify the review gate's ONE guard (OA-231, Tier 4.4).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-review-plugin
//
// WHY THIS EXISTS. test-review-plugin.mjs asserts a REFUSAL, and a refusal is the
// hardest thing to test green: a guard that has quietly stopped refusing passes
// every "an approver can still reach it" assertion while letting the editor who
// wrote the map approve their own work. That is the separation of duties the
// whole P4 section exists to enforce, so a green run of that suite means nothing
// until it has been watched go red.
//
// Each arm breaks ONE thing and must redden the assertion that CLAIMS to be about
// it. A mutation caught by a different assertion is reported as WRONG CAUSE --
// the suite noticed the damage, but not for the reason it says.
//
// THE THREE ARMS ARE THREE DIFFERENT CLAIMS, on purpose:
//
//   1. The guard admits any signed-in user. This is the fault worth having a
//      guard for, and it reddens the enumerated door assertion.
//   2. The guard admits ADMINS ONLY. Nothing about anonymous or editor changes,
//      so arms that only test negatives stay green -- this is the arm that proves
//      "approver AND admin reach the handler" is load-bearing rather than
//      decorative, and it is why the suite tests both positive roles.
//   3. The refusal keeps its 403 and changes its SENTENCE. Every status code
//      still matches; only the assertion that reads the words can see it. That
//      arm exists because a 403 from the CSRF hook would satisfy a status-code
//      check and prove nothing about the door.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY, the same way prove-red-access-model.mjs
// does, and for the same reason: a harness that restores in a `finally` still
// leaves the repository broken if it is killed between the two.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* The suite reaches for its subjects relative to its own location, so a copy of
 * it runs the copied, damaged code. `node_modules/` and `engine/` are linked
 * rather than copied — they are large, and nothing here damages them. */
function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-review-'));
  for (const dir of ['scripts', 'src', 'views', 'public']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  for (const dir of ['node_modules', 'engine']) {
    const from = path.join(ROOT, dir), to = path.join(tmp, dir);
    try { symlinkSync(from, to, 'junction'); }
    catch { cpSync(from, to, { recursive: true }); }
  }
  writeFileSync(path.join(tmp, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));
  return tmp;
}

/** Edit one file in the scratch copy. A stale anchor is a broken HARNESS, and it
 *  says so rather than quietly reporting a pass. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

function runSuite(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-review-plugin.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/* Matched on the whole line, not split on an em dash: the suite uses one both as
 * its name/detail separator AND inside assertion names, so splitting would
 * truncate every expected name at its first dash. Anchored on the suite's own
 * two-space indent so a nested line cannot be read as a failed assertion. */
const failedLines = (out) => out.split('\n').filter((l) => /^ {2}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

const GUARD = '    if (!requireApprover(req, reply)) return reply;';
const SIGNED_IN_ONLY = "    if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return reply; }";

let problems = 0;
const results = [];

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guard', failedLines(r.out).map((l) => l.trim()).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', '']);
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'the plugin ONE guard accepts any signed-in user, so an editor can approve',
    why: 'the fault the guard exists for: an editor who owns the map reaching the route that publishes it',
    file: 'src/routes/review.js',
    find: GUARD,
    to: SIGNED_IN_ONLY,
    expect: 'anonymous 401, editor 403, approver and admin reach the handler',
  },
  {
    what: 'the guard admits ADMINS ONLY, so an approver is locked out of the gate they own',
    why: 'nothing about anonymous or editor changes, so a suite testing only negatives stays green',
    file: 'src/routes/review.js',
    find: GUARD,
    to: SIGNED_IN_ONLY + "\n    if (req.user.role !== 'admin') { reply.code(403).send({ ok: false, error: 'Approver access only.' }); return reply; }",
    expect: 'anonymous 401, editor 403, approver and admin reach the handler',
  },
  {
    what: 'the refusal keeps its 403 and changes its wording',
    why: 'every status code still matches, so only the assertion that reads the SENTENCE can see it',
    file: 'src/http/helpers.js',
    find: "    reply.code(403).send({ ok: false, error: 'Approver access only.' }); return null;",
    to: "    reply.code(403).send({ ok: false, error: 'Forbidden.' }); return null;",
    expect: 'refusal names the approver guard',
  },
];

for (const m of MUTATIONS) {
  const tmp = scratch();
  let r;
  try {
    damage(tmp, m.file, m.find, m.to);
    r = runSuite(tmp);
  } catch (e) {
    problems++; results.push(['✗ HARNESS', m.what, e.message]); rmSync(tmp, { recursive: true, force: true }); continue;
  }
  if (r.code === 0) { problems++; results.push(['✗ SURVIVED', m.what, 'the suite stayed green']); }
  else if (!caughtBy(r.out, m.expect)) {
    problems++;
    results.push(['✗ WRONG CAUSE', m.what, `expected "${m.expect}" to object; got: ${failedLines(r.out).map((l) => l.trim()).join(' | ').slice(0, 200)}`]);
  } else results.push(['ok caught', m.what, m.expect]);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\nprove-red-review-plugin — the one approver guard on /api/review\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                   ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-review-plugin.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.');
process.exit(problems ? 1 : 0);
