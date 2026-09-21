// prove-red-adviser-seat.mjs — falsify the local adviser's seat (buses-data OA-154 D1).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-adviser-seat
//
// WHY THIS EXISTS. test-adviser-seat.mjs is nine tenths refusals, and a refusal
// assertion is the cheapest thing in this repository to write and the easiest to
// believe wrongly: it passes just as well when the route is broken for everybody,
// when the guard it names was never reached, and when a second guard further down
// happens to refuse for a different reason. Each mutation below removes ONE rule
// and requires the assertion that CLAIMS to be about that rule to be the one that
// objects — a mutation caught elsewhere is reported as WRONG CAUSE, because the
// suite noticed the damage without noticing the hole.
//
// THE TWO ARMS THAT MATTER MOST ARE THE PAIR. Mutation 2 opens the seat to every
// map; mutation 3 closes it to every map. Only the second can be caught by a
// control, and a suite without one would pass mutation 3 while the one person the
// whole seat was built for sat looking at a 403.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY, the same way the other harnesses
// here do: one that restored in a `finally` would still leave the repository
// broken if it were killed between the two.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-adviser-'));
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-adviser-seat.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const failedLines = (out) => out.split('\n').filter((l) => /^\s*✗ /.test(l));
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
    what: 'the door stops checking the role, so any signed-in customer reaches the seat',
    why: 'the cheap half, and the only half a plugin-level hook can be. An editor reading their own map through a reduced, watermarked, download-less window would believe they were seeing the whole thing',
    file: 'src/http/helpers.js',
    find: "  if (req.user.role !== 'adviser' && req.user.role !== 'admin') {",
    to: '  if (false) {',
    expect: "an editor is refused the adviser's list",
  },
  {
    what: 'loadAdvisedMap stops requiring a grant, so one adviser reaches EVERY map',
    why: 'THE ARM THAT EARNS THIS SUITE. The door is untouched and every anonymous and cross-role assertion stays green, while a member of the public asked about one town can read every unpublished draft in the estate',
    file: 'src/maps/detail.js',
    find: "  if (!grant) return { code: 403, error: 'You have not been asked to look at this map.' };",
    to: '  if (false) return { code: 403 };',
    expect: 'another map of the same organisation is refused',
  },
  {
    what: 'loadAdvisedMap refuses everybody, so the seat is shut to the one person it is for',
    why: 'the paired control. A suite of refusals passes perfectly when the thing is broken for everyone, and this mutation is what makes every positive row above load-bearing',
    file: 'src/maps/detail.js',
    find: '  const grant = getAdviserGrant(m.id, user.id);',
    to: '  const grant = null;',
    expect: 'CONTROL: with the grant, the same request is allowed',
  },
  {
    what: 'a revoked grant keeps working',
    why: 'revocation is the only way to stop showing somebody drafts, and it is one WHERE clause away from being decorative — the row would still be there, the admin list would still say "revoked", and the sheet would still be served',
    file: 'src/db/index.js',
    find: "  return db.prepare('SELECT * FROM map_adviser_grant WHERE map_id = ? AND user_id = ? AND revoked_at IS NULL')",
    to: "  return db.prepare('SELECT * FROM map_adviser_grant WHERE map_id = ? AND user_id = ?')",
    expect: 'and then the same request is refused',
  },
  {
    what: 'the database stops refusing an adviser a customer_id',
    why: 'the architectural trap OA-154 named. loadOwnedMap() grants EDIT to any non-admin whose customer_id matches a map and never consults role, so this one trigger is what stands between a member of the public and an organisation\'s whole estate',
    file: 'src/db/index.js',
    find: '  for (const stmt of adviserGuardSql()) db.exec(stmt);',
    to: '  for (const stmt of []) db.exec(stmt);',
    expect: 'the DATABASE refuses an UPDATE that gives an adviser a customer_id',
  },
  {
    what: 'loadOwnedMap loses its adviser line, leaving only the customer comparison',
    why: 'defence in depth that NOTHING REACHABLE CAN FALSIFY — the trigger above makes the state it guards impossible — which is precisely why the suite asserts it on the function directly. Without that row this mutation survives, and the line rots into a comment',
    file: 'src/maps/detail.js',
    find: "  if (user.role === 'adviser') return { code: 403, error: 'You do not have access to this map.' };\n  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {",
    to: "  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {",
    expect: 'loadOwnedMap refuses an adviser whose customer_id matches the map',
  },
  {
    what: 'the sheet is served without its watermark',
    why: 'there is no file here to forward, so the thing that leaves this page is a SCREENSHOT, and a screenshot carries nothing but its own pixels. An unverified draft reaching a Facebook group is the failure this marking exists for',
    file: 'src/routes/adviser.js',
    find: '    return reply.send(watermarkSvgDocument(svg, adviserWatermark(ver && ver.review_state)));',
    to: '    return reply.send(svg);',
    expect: 'watermarked, so a screenshot of it still says what it is',
  },
  {
    what: 'the sheet is served without its draft stamp',
    why: 'the other marking, answering the other question — WHICH copy is this. The render itself only ever says "Map version 1.0", which is equally true once it is published',
    file: 'src/routes/adviser.js',
    find: '        if (marked) file = marked;',
    to: '        if (marked) file = source;',
    expect: 'with the footer line rewritten to say which copy this is',
  },
  {
    what: 'the draft sheet becomes cacheable',
    why: 'the adviser is looking at the working head, which is re-rendered on every save. A cached copy here is a stale draft shown as a current one — the exact fault the seat was built to remove',
    file: 'src/routes/adviser.js',
    find: "    reply.header('Cache-Control', 'no-store');",
    to: "    reply.header('Cache-Control', 'private, max-age=3600');",
    expect: 'never cached, because the working head moves on every save',
  },
  {
    what: "the adviser's view starts naming the organisation that pays for the map",
    why: 'an adviser was asked about a TOWN. Which organisation, if any, is buying the sheet is somebody else\'s business, and it is one spread-operator away from being on the page',
    file: 'src/routes/adviser.js',
    find: '  subject: m.subject || null,',
    to: '  subject: m.subject || null,\n  customerName: m.customer_name || null,',
    expect: 'and the response says nothing about the paying organisation',
  },
  {
    what: 'draftLabel loses its `published` branch and falls through to "Draft" again',
    why: 'THE FAULT OF 2026-09-12, put back. A map whose working head IS its published version — every map nobody has edited since publishing it, which was the only map this seat was ever granted on — was described to a member of the public as a draft, in bold. It was invisible to the whole suite because every assertion in it was about a draft',
    file: 'src/render/draftStamp.js',
    find: "    : state === 'published' ? 'Published'\n",
    to: '',
    expect: 'and its label says Published, not Draft',
  },
  {
    what: 'the watermark stops asking what state the version is in',
    why: 'the same fault in the marking that travels furthest. A screenshot carries nothing but its own pixels, so "DRAFT — not published" stamped across the sheet that IS on the public site is the one wrong claim nobody can correct afterwards',
    file: 'src/routes/adviser.js',
    find: "  (state === 'published' ? ADVISER_PUBLISHED_WATERMARK : ADVISER_DRAFT_WATERMARK);",
    to: '  ADVISER_DRAFT_WATERMARK;',
    expect: 'and NOT claiming to be unpublished',
  },
  {
    what: 'the watermark goes the other way and never says DRAFT at all',
    why: 'the paired control. A "fix" that simply deleted the draft marking would satisfy every published-version assertion perfectly while removing the thing the whole seat was built to carry',
    file: 'src/routes/adviser.js',
    find: "  (state === 'published' ? ADVISER_PUBLISHED_WATERMARK : ADVISER_DRAFT_WATERMARK);",
    to: '  ADVISER_PUBLISHED_WATERMARK;',
    expect: 'watermarked, so a screenshot of it still says what it is',
  },
  {
    what: 'the admin invite route lets an adviser be given an organisation',
    why: 'the route a person actually travels. The database would still refuse it, so the damage is a 500 instead of a sentence — but a rule enforced only by a crash is one nobody can act on',
    file: 'src/routes/admin.js',
    find: "    if (role === 'adviser' && customerId != null) {",
    to: '    if (false) {',
    expect: 'POST /api/admin/users refuses an adviser WITH an organisation',
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

console.log('\nprove-red-adviser-seat — the door, the grant, and the two markings\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                   ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-adviser-seat.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.');
process.exit(problems ? 1 : 0);
