// prove-red-editor-plugin.mjs — falsify the editor spine's guards (OA-231, Tier 4.4).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-editor-plugin
//
// WHY THIS EXISTS. /api/admin and /api/review are guarded entirely by a
// plugin-level preHandler, so breaking that hook breaks everything and any
// assertion notices. The editor spine is the other shape, and the larger one:
// its hook is only `requireUser`, and the decisions that matter are in the
// handlers because they need the map — `loadOwnedMap()` on eleven routes and
// `loadReadableMap()` on two.
//
// THE SECOND ARM IS THE WHOLE POINT, and arms four and five are the half that is
// new here. Two guards that differ by one role are the easiest thing in this file
// to get wrong in either direction, and NEITHER direction is visible from an
// anonymous request: widen the read guard's rule to the owned routes and every
// approver can edit eleven maps they do not own; narrow the owned guard's rule
// onto the read routes and the publish gate stops working, because an approver
// can no longer open the sheets they are being asked to review.
//
// Each arm must redden the assertion that CLAIMS to be about it. A mutation caught
// by a different assertion is reported as WRONG CAUSE — the suite noticed the
// damage, but not for the reason it says.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY, the same way prove-red-proposed-plugin.mjs
// does: a harness that restores in a `finally` still leaves the repository broken
// if it is killed between the two.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-editor-'));
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-editor-plugin.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
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

const OWNED_RULE = "  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {";
const READ_RULE = "  if (user.role === 'admin' || user.role === 'approver' || owner) return { map: m };";

const MUTATIONS = [
  {
    what: 'the plugin hook stops requiring a session, so all 14 routes go anonymous',
    why: 'the cheap half of the pair, and the only half a plugin-level hook can be',
    file: 'src/routes/editor.js',
    find: '    if (!requireUser(req, reply)) return reply;',
    to: '    if (false) return reply;',
    expect: 'anonymous is refused by the plugin hook',
  },
  {
    what: 'loadOwnedMap stops comparing customers, so ANY signed-in user reaches another organisation\'s map',
    why: 'THE ARM THAT EARNS THIS SUITE. The plugin door is untouched and every anonymous assertion stays green, while save would write a new version into a map its caller does not own and PATCH /public would take somebody else\'s map off the public site',
    file: 'src/maps/detail.js',
    find: OWNED_RULE,
    to: '  if (false) {',
    expect: "another customer's editor is refused by the per-map guard",
  },
  {
    what: 'loadOwnedMap refuses EVERYBODY, so the owner is locked out of their own map',
    why: 'the paired control: a suite that only asserts refusals passes just as well when the route is broken for everyone, and this is what makes the positive rows load-bearing',
    file: 'src/maps/detail.js',
    find: OWNED_RULE,
    to: '  if (true) {',
    expect: "the owning customer's editor gets past both guards",
  },
  {
    what: 'loadOwnedMap admits approvers too, so the two guards collapse into the wider one',
    why: 'the guard-swap in the dangerous direction: every approver can now edit, publish and unlist eleven routes\' worth of maps they do not own, and no anonymous or cross-customer assertion moves',
    file: 'src/maps/detail.js',
    find: OWNED_RULE,
    to: "  if (user.role !== 'admin' && user.role !== 'approver' && (user.customer_id == null || m.customer_id !== user.customer_id)) {",
    expect: 'an approver is refused — loadOwnedMap, because reviewing is not editing',
  },
  {
    what: 'loadReadableMap drops approvers, so the two guards collapse into the narrower one',
    why: 'the same swap the other way, and it breaks the publish gate rather than opening it: an approver can no longer open the map detail or download the print-ready files of the version they have been asked to review',
    file: 'src/maps/detail.js',
    find: READ_RULE,
    to: "  if (user.role === 'admin' || owner) return { map: m };",
    expect: 'an approver reaches it — loadReadableMap',
  },
  {
    what: 'GET /api/maps stops scoping its answer, so every customer sees the whole estate',
    why: 'the one route with no :id, where the same decision is made by a SQL scope rather than by a guard — a hole here leaks the list of every organisation\'s maps to any signed-in editor',
    file: 'src/routes/editor.js',
    find: '  const scope = isAdmin ? {} : { customerId: user.customer_id };',
    to: '  const scope = {};',
    expect: 'the other customer sees only its own map',
  },
  {
    what: "the prefix's trailing-slash twin comes back",
    why: "Fastify's default for a route path of '/' inside a prefixed plugin registers /api/maps/ as well — a route the unsplit server never had, and the one way this cut could silently ADD to the route table. Measured: the twin arrives as HEAD /api/maps/ and not as GET /api/maps/, which is why the assertion asks about the path rather than the method",
    file: 'src/routes/editor.js',
    find: "app.get('/', { prefixTrailingSlash: 'no-slash', config: { operatorRead: true } }, async (req, reply) => {",
    to: "app.get('/', { config: { operatorRead: true } }, async (req, reply) => {",
    expect: 'the prefix did not add a trailing-slash twin',
  },
  {
    what: 'the route the cut left behind loses its guard',
    why: 'GET /api/poi-glyphs stayed in server.js because it is outside the subtree, and a route nobody moved is a route nobody is now responsible for',
    file: 'src/server.js',
    find: "app.get('/api/poi-glyphs', async (req, reply) => {\n  const user = requireUser(req, reply); if (!user) return;",
    to: "app.get('/api/poi-glyphs', async (req, reply) => {\n  const user = req.user;",
    expect: 'still refuses an anonymous caller by its own guard',
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
    results.push(['✗ WRONG CAUSE', m.what, `expected "${m.expect}" to object; got: ${failedLines(r.out).map((l) => l.trim()).join(' | ').slice(0, 240)}`]);
  } else results.push(['ok caught', m.what, m.expect]);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\nprove-red-editor-plugin — the door, and the two per-map guards behind it\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                   ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-editor-plugin.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.');
process.exit(problems ? 1 : 0);
