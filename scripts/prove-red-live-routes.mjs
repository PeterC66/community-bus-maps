// prove-red-live-routes.mjs — falsify the post-deploy route check (OA-231).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-live-routes
//
// WHY THIS IS DIFFERENT FROM THE OTHER prove-red HARNESSES HERE. The others break
// a module and re-run a suite that imports it. `check-live-routes.mjs` talks to a
// RUNNING SITE over HTTP and asserts nothing about the source at all, so the only
// way to break its subject is to start a real server from a mutated copy and point
// the checker at that. Each arm therefore does the whole thing: copy, damage,
// listen on a scratch port, run the checker against it, read the verdict, stop.
//
// It never touches the repository and never touches busmaps.uk — every arm runs
// against 127.0.0.1 with its own empty DATA_DIR and its own SQLite file.
//
// THE FOUR ARMS ARE THE FOUR THINGS THE CHECKER CLAIMS TO SEE, and two of them are
// opposite faults that a naive check would confuse:
//   A route GONE      — the router 404, which is what a bad cut leaves behind.
//   A guard GONE      — the route still answers, and answers 2xx to a stranger.
//   A redirect GONE   — the same fault on a page shell, where the refusal is a 302.
//   A rule MISSING    — a route the script has no expectation for must EXIT 2 and
//                       name it, not be skipped. That is the arm that stops this
//                       check quietly shrinking as routes are added.
//
// An arm must redden the checker for the reason it names; a mutation caught by a
// different message is a WRONG CAUSE and is reported as a problem, not a pass.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* A FREE port, asked of the OS, rather than a number written here. This
 * repository already carries the lesson — CBM_NO_LISTEN exists because a test
 * that fails over a port somebody else happened to be using is a test people
 * learn to re-run rather than read — and a harness that binds five servers is
 * the last place to reintroduce it. */
const PORT = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-routes-'));
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

/** Edit one file in the scratch copy. A stale anchor is a broken HARNESS. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start the copy on its own port with its own empty store, and wait for /health. */
async function serve(tmp) {
  const data = path.join(tmp, 'scratch-data');
  const child = spawn(process.execPath, [path.join(tmp, 'src', 'server.js')], {
    cwd: tmp,
    env: {
      ...process.env,
      NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1',
      DATA_DIR: data, DB_PATH: path.join(data, 'portal.sqlite'),
      CBM_NO_LISTEN: '', OPERATOR_TOKEN: '', METRICS_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return { child, log: () => log };
    } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
  }
  child.kill();
  throw new Error(`the scratch server never answered /health on ${PORT}. Its output was:\n${log.slice(-1500)}`);
}

function runChecker(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'check-live-routes.mjs'), '--base', `http://127.0.0.1:${PORT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

async function arm(edits) {
  const tmp = scratch();
  let server = null;
  try {
    for (const [rel, find, to] of edits) damage(tmp, rel, find, to);
    server = await serve(tmp);
    return runChecker(tmp);
  } finally {
    if (server) { server.child.kill(); await sleep(300); }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows holds the sqlite file briefly */ }
  }
}

let problems = 0;
const results = [];

// ---------------------------------------------------------------- 0. control
{
  const r = await arm([]);
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy passes', r.out.split('\n').filter((l) => l.trim()).slice(-4).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', 'and it says so with no published map, so the parameterised public routes are held to the router rule only']);
}

const MUTATIONS = [
  {
    what: 'a route is deleted — the cut lost one',
    why: 'THE fault this script exists for. Nothing else in the repository can see it: /health still says ok, the byte gates still pass, and npm test asks the laptop rather than the deployed app',
    edits: [['src/routes/editor.js', "  app.get('/:id/basemap', async (req, reply) => {", "  app.get('/:id/basemap-RENAMED-BY-A-BAD-CUT', async (req, reply) => {"]],
    expect: 'the ROUTER does not know this path',
  },
  {
    what: 'a GUARD is deleted and the route stays — the opposite fault',
    why: 'a route-only check would pass this happily: /api/poi-glyphs still answers, it just answers to anybody. A check that only asks "is it there" is the one that ships an open door',
    edits: [['src/server.js', "app.get('/api/poi-glyphs', async (req, reply) => {\n  const user = requireUser(req, reply); if (!user) return;", "app.get('/api/poi-glyphs', async (req, reply) => {\n  const user = req.user;"]],
    expect: 'the route is there and its GUARD is not',
  },
  {
    what: "a page shell's redirect is deleted, so the app's HTML is served to a stranger",
    why: 'the same fault where the refusal is a 302 rather than a 401 — the shape /app/review-services.html actually had until 2026-08-20',
    edits: [['src/routes/pages.js', "    if (!req.user) return reply.redirect('/app/login.html');", '    if (false) return reply;']],
    expect: 'wanted a 302 to /app/login.html',
  },
  {
    what: 'a route in the snapshot has no rule in the script',
    why: 'the arm that stops this check quietly shrinking. A route nobody wrote an expectation for must be a FINDING with exit 2, never a silent skip — the oldest convention here is that a check unable to find its subject does not report clear',
    edits: [['scripts/check-live-routes.mjs', "  { prefix: '/api/me', kind: 'guarded' },\n", '']],
    expect: 'match no rule in this script',
    wantCode: 2,
  },
];

for (const m of MUTATIONS) {
  let r;
  try { r = await arm(m.edits); }
  catch (e) { problems++; results.push(['✗ HARNESS', m.what, e.message.split('\n')[0]]); continue; }
  const want = m.wantCode ?? 1;
  if (r.code === 0) { problems++; results.push(['✗ SURVIVED', m.what, 'the checker stayed green']); }
  else if (!r.out.includes(m.expect)) {
    problems++;
    results.push(['✗ WRONG CAUSE', m.what, `expected "${m.expect}"; got: ${r.out.split('\n').filter((l) => l.includes('✗') || l.includes('match no rule')).join(' | ').slice(0, 240)}`]);
  } else if (r.code !== want) {
    problems++;
    results.push(['✗ WRONG CODE', m.what, `said the right thing but exited ${r.code}, wanted ${want}`]);
  } else results.push(['ok caught', m.what, `${m.expect}  (exit ${r.code})`]);
}

console.log('\nprove-red-live-routes — a route gone, a guard gone, and a rule missing\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                   ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) console.log('\nA SURVIVED mutation is a hole in check-live-routes.mjs. A WRONG CAUSE is a\ndifferent hole: it noticed, but not through the message that claims to be about it.');
process.exit(problems ? 1 : 0);
