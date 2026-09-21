// prove-red-public-plugin.mjs — falsify the public front's checks (OA-232 Tier 3.2).
//
// Run from the repository root (C:\Claude\community-bus-maps), no placeholders:
//     npm run test:prove-red-public-plugin
//
// WHY THIS EXISTS, AND WHY IT IS THE ODD ONE OUT. Every other prove-red harness
// beside it breaks a GUARD and asks whether the suite notices. There is no guard
// here: the public front is unauthenticated by design, so the faults worth
// falsifying are the opposite ones — a route that stops being public, a route
// that stops being registered, and a route that comes BACK into src/server.js
// and quietly undoes the cut while behaving perfectly.
//
// THE LAST OF THOSE IS THE POINT OF THE WHOLE ROUND. The 2026-09-03 review found
// that eight of ten extractions landed with a test of the thing extracted and no
// test of its callers, and were adopted exactly as far as their author happened
// to carry them. A cut with no check on WHERE a route may be declared is the
// same fault one level up: it would pass every runtime assertion in
// test-public-plugin.mjs on the day it was reversed. Arm 5 installs that
// reversal and requires the source-level check to see it.
//
// ARM 8 IS THE ONE THAT ALREADY BIT. The source check's first version compared
// the route LITERAL against the public prefixes and reported three false
// findings, because src/routes/pages.js declares '/maps/:id' and serves it at
// /app/maps/:id. The check now joins each file's registered prefix first, and
// this arm is the control for that fix: it must stay GREEN under a mutation that
// adds a legitimate prefixed route, or the check has gone back to guessing.
//
// Each arm must redden the assertion that CLAIMS to be about it. A mutation
// caught by a different assertion is reported as WRONG CAUSE.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-public-'));
  for (const dir of ['scripts', 'src', 'views', 'public']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  // Derived from the subject rather than listed: a scratch world silently short
  // of a dependency is how a mutation "survives" for the wrong reason, which is
  // the fault prove-red-run-tests.mjs and prove-red-redteam-source.js both hit
  // on 2026-09-03. Anything the app requires and does not carry in those four
  // directories is linked whole.
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-public-plugin.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const failedLines = (out) => out.split('\n').filter((l) => /^ {2,4}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

let problems = 0;
const results = [];

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the checks', failedLines(r.out).map((l) => l.trim()).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', '']);
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'a guard appears on the public plugin, so the whole public site needs a session',
    why: 'the inverse of every other prove-red here: a preHandler added to this file is the one change that would take the site down for everybody, and it would look exactly like the correct fix in any other route file',
    file: 'src/routes/public.js',
    find: 'export default async function publicRoutes(app) {',
    to: "export default async function publicRoutes(app) {\n  app.addHook('preHandler', async (req, reply) => { if (!req.user) return reply.code(401).send({ ok: false }); });",
    expect: 'anonymous is not refused',
  },
  {
    what: 'the published-maps catalogue stops being registered at all',
    why: 'a route that stops being registered does not throw — it 404s to whoever asks next, which is what check-live-routes.mjs exists to catch AFTER a deploy and what this must catch before one',
    file: 'src/routes/public.js',
    find: "  app.get('/maps', async (req, reply) => {",
    to: "  app.get('/maps-disabled', async (req, reply) => {",
    expect: 'the plugin declares nineteen public routes',
  },
  {
    what: 'a map page answers an unknown slug with the ROUTER 404 envelope instead of the page',
    why: "check-live-routes.mjs tells 'the route is gone' from 'the thing behind it is gone' by that envelope's code, so a handler that borrows it makes a live route indistinguishable from a lost one",
    file: 'src/routes/public.js',
    find: "    if (!row) return reply.code(404).type('text/html').send(notFoundPage('map'));\n    return sendShell(reply, 'map.html', mapHead(req, publicMap(row)));",
    to: "    if (!row) return reply.code(404).send({ ok: false, code: 'route_not_found' });\n    return sendShell(reply, 'map.html', mapHead(req, publicMap(row)));",
    expect: 'and it is the app answering, not the router',
  },
  {
    what: 'the 404 page loses its body, so a missing map renders as an empty document',
    why: 'the exact shape test-ssr.mjs was written for on the other two pages — a 404 that is technically correct and says nothing to the reader who hit it',
    file: 'src/public/notFound.js',
    find: '<h2 class="mt-0">We can’t find that ${what}</h2>',
    to: '<h2 class="mt-0"></h2>',
    expect: '404 with the "we can\'t find that" page',
  },
  {
    what: 'THE REVERSAL: a public route is put back into src/server.js, and behaves perfectly',
    why: 'this is the fault the whole 2026-09-03 review is about. It serves the right bytes, keeps the route table identical, refuses nobody and passes every runtime assertion in the suite — and the cut is undone. Only a check that reads the SOURCE can see it',
    file: 'src/routes/public.js',
    find: "  app.get('/robots.txt', async (req, reply) => {",
    to: "  app.get('/robots-moved.txt', async (req, reply) => {",
    also: {
      file: 'src/server.js',
      find: 'await app.register(publicRoutes);',
      to: "await app.register(publicRoutes);\napp.get('/robots.txt', async (req, reply) => { reply.type('text/plain'); return 'Sitemap: x'; });",
    },
    expect: 'src/server.js registers no public URL',
  },
  {
    what: 'the public plugin is given a prefix',
    why: 'every other plugin here has one, so adding one reads like consistency; it would move all nineteen URLs at once and the route table would say so, but this file states the rule in its own words',
    file: 'src/server.js',
    find: 'await app.register(publicRoutes);',
    to: "await app.register(publicRoutes, { prefix: '/pub' });",
    expect: 'the public plugin is registered with NO prefix',
  },
  {
    what: 'a dead import is left behind in src/server.js',
    why: 'sixty-three of them accumulated there through the OA-231 cuts and nothing noticed, because a dead import is invisible to every runtime test in this suite and to the route table',
    file: 'src/server.js',
    find: "import { logAudit } from './audit/index.js';",
    to: "import { logAudit } from './audit/index.js';\nimport { slugify } from './http/helpers.js';",
    expect: 'imports are used',
  },
  {
    what: 'a route file reaches back into server.js',
    why: 'the dependency the plugin headers forbid in both directions; it would work until the day server.js imports that route file back and the cycle bites',
    file: 'src/routes/public.js',
    find: "import { dbDateToIso } from '../db/dates.js';",
    to: "import { dbDateToIso } from '../db/dates.js';\nimport { app as _unused } from '../server.js';",
    expect: 'src/routes/public.js does not import from server.js',
  },
  {
    // The control for arm 8's own history — see the header.
    what: 'CONTROL: a legitimate prefixed route that only LOOKS public is added to the admin plugin',
    why: "src/routes/admin.js declaring '/maps/summary' serves /api/admin/maps/summary, which is not public. The check's first version reported three findings of exactly this shape. It must stay GREEN",
    file: 'src/routes/admin.js',
    find: 'export default async function adminRoutes(app) {',
    to: "export default async function adminRoutes(app) {\n  app.get('/maps/summary', async () => ({ ok: true }));",
    expectGreen: true,
  },
];

for (const m of MUTATIONS) {
  const tmp = scratch();
  let r;
  try {
    damage(tmp, m.file, m.find, m.to);
    if (m.also) damage(tmp, m.also.file, m.also.find, m.also.to);
    r = runSuite(tmp);
  } catch (e) {
    problems++; results.push(['✗ HARNESS', m.what, e.message]); rmSync(tmp, { recursive: true, force: true }); continue;
  }
  if (m.expectGreen) {
    if (r.code !== 0) { problems++; results.push(['✗ FALSE FINDING', m.what, failedLines(r.out).map((l) => l.trim()).join(' | ').slice(0, 240)]); }
    else results.push(['ok stayed green', m.what, 'the check did not guess']);
  } else if (r.code === 0) {
    problems++; results.push(['✗ SURVIVED', m.what, 'the suite stayed green']);
  } else if (!caughtBy(r.out, m.expect)) {
    problems++;
    results.push(['✗ WRONG CAUSE', m.what, `expected "${m.expect}" to object; got: ${failedLines(r.out).map((l) => l.trim()).join(' | ').slice(0, 240)}`]);
  } else results.push(['ok caught', m.what, m.expect]);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\nprove-red-public-plugin — the site with no guard, and the cut that could undo itself\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(16)} ${what}`);
  if (detail) console.log(`                     ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
const green = results.filter((r) => r[0] === 'ok stayed green').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, ${green} correctly ignored, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-public-plugin.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it. A FALSE FINDING means the check has started guessing.');
process.exit(problems ? 1 : 0);
