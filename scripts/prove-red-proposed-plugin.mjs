// prove-red-proposed-plugin.mjs — falsify the monthly-acceptance guards (OA-231, Tier 4.4).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-proposed-plugin
//
// WHY THIS EXISTS, and it is a different reason from the other two route plugins.
// /api/admin and /api/review are guarded entirely by a plugin-level preHandler, so
// breaking that hook breaks everything and any assertion notices. Here the hook is
// only `requireUser`, and the decision that matters — `loadOwnedMap()`, the map's
// own customer or an admin — is in the handlers, because it needs the map.
//
// THE SECOND ARM IS THE WHOLE POINT. A cut that hoisted the cheap guard and lost
// the ownership check would pass every "anonymous is refused" assertion while
// letting any signed-in customer preview, accept or decline another organisation's
// monthly refresh. That is not a theoretical tidy-up: accept writes a new major
// version into the map. The arm below is what says test-proposed-plugin.mjs can
// see that, rather than only seeing the door.
//
// Each arm must redden the assertion that CLAIMS to be about it. A mutation caught
// by a different assertion is reported as WRONG CAUSE — the suite noticed the
// damage, but not for the reason it says.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY, the same way prove-red-access-model.mjs
// does: a harness that restores in a `finally` still leaves the repository broken
// if it is killed between the two.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-proposed-'));
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-proposed-plugin.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const failedLines = (out) => out.split('\n').filter((l) => /^ {2}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

let problems = 0;
const results = [];

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guards', failedLines(r.out).map((l) => l.trim()).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', '']);
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'the plugin hook stops requiring a session, so the three routes go anonymous',
    why: 'the cheap half of the pair, and the only half a plugin-level hook can be',
    file: 'src/routes/proposed.js',
    find: '    if (!requireUser(req, reply)) return reply;',
    to: '    if (false) return reply;',
    expect: 'anonymous is refused by the plugin hook',
  },
  {
    what: 'loadOwnedMap stops comparing customers, so ANY signed-in user reaches another organisation\'s refresh',
    why: 'THE ARM THAT EARNS THIS SUITE. The plugin door is untouched and every anonymous assertion stays green, while accept would write a new major version into a map its caller does not own',
    file: 'src/maps/detail.js',
    find: "  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {",
    to: '  if (false) {',
    expect: "another customer's editor is refused by loadOwnedMap",
  },
  {
    what: 'loadOwnedMap refuses EVERYBODY, so the owner is locked out of their own map',
    why: 'the paired control: a suite that only asserts refusals passes just as well when the route is broken for everyone, and this is what makes the two positive rows load-bearing',
    file: 'src/maps/detail.js',
    find: "  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {",
    to: '  if (true) {',
    expect: "the owning customer's editor gets past both guards",
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

console.log('\nprove-red-proposed-plugin — the door, and the ownership check behind it\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                   ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-proposed-plugin.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.');
process.exit(problems ? 1 : 0);
