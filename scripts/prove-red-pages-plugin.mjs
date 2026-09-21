// prove-red-pages-plugin.mjs — falsify the app's page-shell guards (OA-231, Tier 4.4).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-pages-plugin
//
// WHY THIS EXISTS. The page shells are the one part of this server whose refusals
// are REDIRECTS, and a redirect is the failure mode that does not look like one:
// a page that stops guarding simply serves, with a 200 and no error anywhere.
// This section has already had that fault once — /app/review-services.html was
// reachable by anybody until 2026-08-20 because it was a static file with no
// route (technical-audit_2026-08-19 S7).
//
// THE SECOND, THIRD AND FOURTH ARMS ARE WHY THE FILE IS LONGER THAN THE DOOR. The
// plugin hook only asks whether somebody is signed in; four pages carry a further
// ROLE check in the handler, and losing one hands the admin console's shell — or
// the raw developer CHANGELOG.md, which names past security findings — to any
// customer who typed the URL, while every anonymous assertion stays green.
//
// THE LAST ARM IS THE OBVIOUS WRONG FIX. "Guard the /app prefix" reads like the
// same thing as "guard the plugin's routes" and is not: a Fastify hook is scoped
// to the routes of the plugin that declares it, so the static assets under /app
// stay public — which they must, because the sign-in page needs its stylesheet
// before anybody is signed in. The arm installs that wrong fix in server.js and
// requires the suite to notice.
//
// Each arm must redden the assertion that CLAIMS to be about it. A mutation caught
// by a different assertion is reported as WRONG CAUSE.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-pages-'));
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-pages-plugin.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
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
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guards', failedLines(r.out).map((l) => l.trim()).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', '']);
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'the plugin hook stops requiring a session, so all ten shells go anonymous',
    why: 'the cheap half, and the only half a plugin-level hook can be',
    file: 'src/routes/pages.js',
    find: "    if (!req.user) return reply.redirect('/app/login.html');",
    to: '    if (false) return reply;',
    expect: 'anonymous is redirected to the sign-in page',
  },
  {
    what: 'the sign-in page loses its declared exception, so the hook redirects it to itself',
    why: 'the exception is the reason the hook is safe to have at all; without it every anonymous visitor meets a redirect loop on the one page they need, and no other assertion in the suite moves',
    file: 'src/routes/pages.js',
    find: '    if (req.routeOptions.config.anonymous) return;',
    to: '    if (false) return;',
    expect: 'anonymous is SERVED',
  },
  {
    what: 'the admin console shell loses its role check, so any signed-in customer is served it',
    why: 'the door is untouched and every anonymous row stays green while the admin console opens to editors',
    file: 'src/routes/pages.js',
    find: "  app.get('/admin', async (req, reply) => {\n    if (req.user.role !== 'admin') return reply.redirect('/app');",
    to: "  app.get('/admin', async (req, reply) => {\n    if (false) return reply.redirect('/app');",
    expect: '/app/admin: a signed-in editor is redirected to /app',
  },
  {
    what: "the review shell narrows to admins, so approvers cannot open the queue they are asked to review",
    why: 'the paired control, and the direction a refusal-only suite cannot see: nothing about anonymous or editor changes, and the publish gate quietly stops working for the people who operate it',
    file: 'src/routes/pages.js',
    find: "  app.get('/review', async (req, reply) => {\n    if (req.user.role !== 'approver' && req.user.role !== 'admin') return reply.redirect('/app');",
    to: "  app.get('/review', async (req, reply) => {\n    if (req.user.role !== 'admin') return reply.redirect('/app');",
    expect: '/app/review: an approver is served the shell',
  },
  {
    what: 'the P7 diagram shell loses its admin check, so any customer reaches the layout editor page',
    why: "the page that came from another section, and the arm that says moving it did not leave its rule behind",
    file: 'src/routes/pages.js',
    find: "    if (req.user.role !== 'admin') return reply.redirect(`/app/maps/${Number(req.params.id)}`);",
    to: '    if (false) return reply.redirect(`/app/maps/${Number(req.params.id)}`);',
    expect: '/app/maps/:id/diagram: a signed-in editor is redirected to /app/maps/',
  },
  {
    what: "the prefix's trailing-slash twin comes back",
    why: "Fastify's default for a route path of '/' inside a prefixed plugin registers /app/ as well — a route the unsplit server never had, and the one way this cut could silently ADD to the route table",
    file: 'src/routes/pages.js',
    find: "  app.get('/', { prefixTrailingSlash: 'no-slash' }, async (req, reply) => reply.sendFile('app/index.html', VIEWS_DIR));",
    to: "  app.get('/', async (req, reply) => reply.sendFile('app/index.html', VIEWS_DIR));",
    expect: 'the prefix did not add a trailing-slash twin of /app',
  },
  {
    what: 'THE OBVIOUS WRONG FIX: the guard is moved onto the /app URL prefix instead of the plugin',
    why: 'it reads like the same rule and is not — a global hook on the path catches @fastify/static too, so the sign-in page loses its own stylesheet and nothing about the shells themselves changes',
    file: 'src/server.js',
    find: "await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });",
    to: "await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });\napp.addHook('onRequest', async (req, reply) => {\n  if (req.url.startsWith('/app') && req.url !== '/app/login.html' && !req.user) return reply.redirect('/app/login.html');\n});",
    expect: '/app/app.css is served to an anonymous browser',
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

console.log('\nprove-red-pages-plugin — the one redirect, the four role checks, and the wrong fix\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                   ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in test-pages-plugin.mjs. A WRONG CAUSE is a\ndifferent hole: the suite noticed the damage, but not through the assertion that\nclaims to be about it.');
process.exit(problems ? 1 : 0);
