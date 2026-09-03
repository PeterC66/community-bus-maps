// check-live-routes.mjs — after a deploy, ask a RUNNING site whether every route
// it is supposed to have still answers, and answers with a guard.
//
// Run from the repository root (no placeholders except the URL, which defaults
// to the live site):
//     npm run check:live-routes
//     npm run check:live-routes -- --base http://127.0.0.1:5180
//
// WHY THIS EXISTS, AND WHAT NOTHING ELSE CAN SEE. `/health?deep=1` asks whether
// the process came up; the byte gates ask whether the drawn output still matches;
// `npm test` asks the LAPTOP's build. None of them can see a route that stopped
// being registered, and a route that stops being registered does not throw — it
// 404s, quietly, to whoever asks for it next. That became a real risk on
// 2026-09-02 when OA-231 moved 24 routes out of `src/server.js` into three
// plugins, and it was checked by hand twice (four routes after `94773e3`,
// twenty-eight after `fd438a6`) before this script existed. A third improvisation
// is what this replaces.
//
// THE POPULATION IS `scripts/route-table.json`, the table recorded from the
// UNSPLIT server and owned by `test-admin-plugin.mjs`. That is deliberate: a
// route this app no longer registers is exactly what we are looking for, so the
// list must come from something other than the app under test.
//
// THE HARD PART IS THAT TWO DIFFERENT THINGS RETURN 404, and they are told apart
// by the BODY rather than by the code. Measured against the live site rather than
// assumed:
//
//   router 404   {"ok":false,"code":"route_not_found","error":"No route for GET /api/nope.",
//                 "message":"Route GET:/api/nope not found"}
//   handler 404  {"ok":false,"error":"No published map with that name."}   ← the app answering
//
// `code` is the DECLARED discriminator (src/server.js's setNotFoundHandler says so,
// and test-error-envelope.mjs asserts it). `message` repeats Fastify's own pre-handler
// wording and is matched as a fallback for a deployment older than that handler.
//
// The first means the route is GONE. The second means the route is there and the
// thing behind it is not, which is correct behaviour for `/m/:slug` with a slug
// nobody has published. So the universal rule is *no route may produce a ROUTER
// 404*, and it needs no per-route policy at all.
//
// ON TOP OF THAT, three class rules that need one, and every route must match
// exactly one: a guarded API route must REFUSE an anonymous caller (and in
// particular must not answer 2xx — the opposite fault, a guard lost rather than a
// route lost); an /app page shell must redirect one to the sign-in page; a public
// route must serve one. **A route matching no rule is a finding and exits 2**,
// not a route quietly skipped — this repository's oldest convention is that a
// check which cannot find its subject must never report clear.
//
// IT IS SAFE TO RUN AGAINST PRODUCTION, and that was established by measurement
// too. Every route is asked ANONYMOUSLY, so the guarded ones refuse before doing
// anything. The six that a stranger may legitimately POST to are sent an EMPTY
// body, and each was confirmed on 2026-09-02 to answer 4xx and create nothing:
// /api/apply and /api/contact 400 with a fields list, /api/auth/request 400 on
// the address, /api/public/feedback 404 on the map, POST /auth/verify 403 from
// the CSRF hook, POST /api/auth/logout 200 having logged nobody out.
//
// Exit 0 all well, 1 a route answered wrongly, 2 the script could not do its job
// (an unclassified route, or a site it could not reach at all).
import { readFileSync } from 'node:fs';
import { arg, has } from './lib/cli.mjs';

const BASE = (arg('base') || 'https://busmaps.uk').replace(/\/+$/, '');
const VERBOSE = has('verbose');
const SNAPSHOT = new URL('./route-table.json', import.meta.url);

/* ── the classes ───────────────────────────────────────────────────────────
 * Ordered; first match wins. `kind` says what an ANONYMOUS caller must get.
 *   guarded  — 401 or 403. Never 2xx: that is a guard lost, not a route lost.
 *   page     — 302 to the sign-in page.
 *   public   — 2xx.
 *   reaches  — any non-router-404 answer. For the routes whose correct reply
 *              depends on a real identifier we may not have, and for the
 *              anonymous-writable POSTs, where the only safe probe is an empty
 *              body and the interesting fact is simply that it was REACHED.
 * Each `only` entry is an exception with its reason, in the file rather than in
 * somebody's memory. */
const RULES = [
  { match: 'POST /api/admin/status', kind: 'reaches', why: 'a STATUS_TOKEN drop-box that 404s to a session on purpose — the opposite of the admin guard' },
  { match: 'GET /metrics', kind: 'reaches', why: 'hidden from an anonymous caller as a 404 rather than a 401, deliberately' },
  { match: 'GET /auth/verify', kind: 'reaches', why: 'a magic link with no token redirects; with one it signs in, and we have none' },
  { match: 'POST /auth/verify', kind: 'reaches', why: 'refused by the CSRF hook without a same-site token, which is the point of it' },
  { match: 'POST /api/auth/logout', kind: 'reaches', why: 'anonymous logout is a no-op that answers ok:true' },
  { match: 'POST /api/auth/request', kind: 'reaches', why: 'anonymous by design; an empty body is refused on the address and emails nobody' },
  { match: 'POST /api/apply', kind: 'reaches', why: 'the public application form; an empty body is refused on its fields and inserts nothing' },
  { match: 'POST /api/contact', kind: 'reaches', why: 'the public contact form; same' },
  { match: 'POST /api/public/feedback', kind: 'reaches', why: 'public map feedback; an empty body is refused on the map and inserts nothing' },
  { prefix: '/app/login.html', kind: 'public', why: 'the sign-in page, anonymous by design' },
  { prefix: '/app', kind: 'page' },
  { prefix: '/api/admin', kind: 'guarded' },
  { prefix: '/api/review', kind: 'guarded' },
  { prefix: '/api/expert', kind: 'guarded' },
  { prefix: '/api/customer', kind: 'guarded' },
  { prefix: '/api/maps', kind: 'guarded' },
  { prefix: '/api/me', kind: 'guarded' },
  { prefix: '/api/poi-glyphs', kind: 'guarded' },
  { prefix: '/api/public', kind: 'public' },
  { prefix: '/health', kind: 'public' },
  { prefix: '/robots.txt', kind: 'public' },
  { prefix: '/sitemap.xml', kind: 'public' },
  { prefix: '/js/', kind: 'public' },
  { prefix: '/m/', kind: 'public' },
  { prefix: '/o/', kind: 'public' },
  { prefix: '/maps', kind: 'public' },
  { prefix: '/*', kind: 'public', why: 'the static catch-all; probed as the site root' },
];

const classify = (row) => {
  const url = row.slice(row.indexOf(' ') + 1);
  for (const r of RULES) {
    if (r.match && r.match === row) return r;
    if (r.prefix && (url === r.prefix || url.startsWith(r.prefix))) return r;
  }
  return null;
};

/** THE discriminator, and it is the reason this script can make a universal claim
 *  without a policy per route. Two spellings, and the ORDER OF THE KEYS IS NOT ONE
 *  OF THEM: this test was `/^\{"message":"Route .../` until 2026-09-03, which read
 *  the shim `notFoundEnvelope()` deliberately kept — but read it in POSITION ONE,
 *  where `ok` and `code` now sit. It reported a deleted route as a guard failure,
 *  so the two changes were not in fact safe in either order. Match the FIELD, never
 *  the layout. */
const isRouterMiss = (status, body) => {
  if (status !== 404) return false;
  const t = body.trim();
  if (/"code"\s*:\s*"route_not_found"/.test(t)) return true;
  return /"message"\s*:\s*"Route [A-Z]+:[^"]*not found"/.test(t);
};

/* ── real identifiers, so a parameterised public route is asked a real question ──
 * A published slug turns "/m/:slug does not 404 from the router" into "/m/<a real
 * town> serves". Where the site has nothing published — a fresh instance, or the
 * scratch copy prove-red-live-routes.mjs drives — the placeholders stand in and
 * the run SAYS SO, because a weaker check reported as a strong one is worse than
 * a weak one. */
async function discover() {
  const out = { slug: 'no-such-slug', org: 'no-such-org', base: 'internal', file: 'internal.svg', real: false };
  try {
    const maps = await (await fetch(`${BASE}/api/public/maps`)).json();
    const first = (maps.maps || [])[0];
    if (!first) return out;
    out.slug = first.slug;
    const detail = await (await fetch(`${BASE}/api/public/maps/${first.slug}`)).json();
    const o = ((detail.map || {}).outputs || [])[0];
    if (o) {
      out.base = o.base;
      const svg = String(o.svgUrl || '');
      out.file = svg.slice(svg.lastIndexOf('/') + 1) || 'internal.svg';
    }
    out.org = ((detail.map || {}).org || {}).slug || out.org;
    out.real = true;
  } catch { /* leave the placeholders, and say so below */ }
  return out;
}

const ids = await discover();
/* `:slug` means two different things and the first run of this script got it
 * wrong: under /o/ and /api/public/orgs/ it is an ORGANISATION, everywhere else a
 * MAP, and filling both from the map list made two correct routes look broken. A
 * fill that is not route-aware is a checker that reports its own bug. */
const fill = (u) => {
  const slug = (u.startsWith('/o/') || u.startsWith('/api/public/orgs/')) ? ids.org : ids.slug;
  return u
    .replace('/*', '/')
    .replace(':slug', slug).replace(':base', ids.base).replace(':file', ids.file)
    .replace(':handle', 'no-such-handle')
    .replace(':pid', '999999').replace(':key', 'v9.9').replace(':id', '999999');
};

let table;
try {
  table = [...new Set(JSON.parse(readFileSync(SNAPSHOT, 'utf8')))].filter((r) => !r.startsWith('HEAD ')).sort();
} catch (e) {
  console.error(`cannot read ${SNAPSHOT.pathname}: ${e.message}`);
  process.exit(2);
}

const unclassified = table.filter((r) => !classify(r));
if (unclassified.length) {
  console.error(`\n${unclassified.length} route(s) in the snapshot match no rule in this script, so it cannot say whether they are right:\n`);
  for (const r of unclassified) console.error(`  ${r}`);
  console.error('\nAdd each to RULES with the answer an ANONYMOUS caller must get, and a reason if it is an exception.');
  process.exit(2);
}

console.log(`\n${table.length} routes from scripts/route-table.json, asked anonymously of ${BASE}`);
console.log(ids.real
  ? `real identifiers in use: slug=${ids.slug} org=${ids.org} base=${ids.base} file=${ids.file}`
  : 'NO published map on this instance — parameterised public routes are checked for the router 404 only, not for a 200.');
console.log('');

let reachable = 0;
const bad = [];
const lines = [];
for (const row of table) {
  const rule = classify(row);
  const [method, url] = [row.slice(0, row.indexOf(' ')), row.slice(row.indexOf(' ') + 1)];
  let status = 0, body = '', loc = '';
  try {
    const r = await fetch(BASE + fill(url), {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    status = r.status; loc = r.headers.get('location') || '';
    body = await r.text();
    reachable++;
  } catch (e) {
    bad.push([row, `could not be reached at all: ${e.message}`]);
    lines.push(`  ✗  --  ${method.padEnd(5)} ${url}`);
    continue;
  }

  let fault = null;
  if (isRouterMiss(status, body)) fault = 'the ROUTER does not know this path — the route is gone';
  else if (rule.kind === 'guarded' && !(status === 401 || status === 403)) {
    fault = status >= 200 && status < 300
      ? 'answered 2xx to an anonymous caller — the route is there and its GUARD is not'
      : `wanted 401 or 403, got ${status}`;
  } else if (rule.kind === 'page' && !(status === 302 && loc === '/app/login.html')) {
    fault = `wanted a 302 to /app/login.html, got ${status}${loc ? ' → ' + loc : ''}`;
  } else if (rule.kind === 'public' && !(status >= 200 && status < 300)) {
    // A parameterised public route with no real identifier to use is only held
    // to the universal rule; saying otherwise would be reporting a check we
    // did not make.
    const parameterised = url.includes(':');
    if (!(parameterised && !ids.real)) fault = `a public route answered ${status} to an anonymous caller`;
  }

  if (fault) { bad.push([row, fault]); lines.push(`  ✗ ${String(status).padStart(3)} ${method.padEnd(5)} ${url.padEnd(44)} ${fault}`); }
  else if (VERBOSE) lines.push(`  ✓ ${String(status).padStart(3)} ${method.padEnd(5)} ${url.padEnd(44)} ${rule.kind}${loc ? ' → ' + loc : ''}`);
}

if (lines.length) console.log(lines.join('\n'));
if (!reachable) {
  console.error(`\nnothing at ${BASE} answered at all — this is a check that could not find its subject, not a clean run.`);
  process.exit(2);
}

const counts = table.reduce((m, r) => { const k = classify(r).kind; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`\n${table.length} routes: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
if (bad.length) {
  console.error(`\n✗ ${bad.length} of ${table.length} answered wrongly:`);
  for (const [row, why] of bad) console.error(`    ${row} — ${why}`);
  process.exit(1);
}
console.log('✓ every route in the snapshot answers, and every refusal is a guard rather than a missing route.');
process.exit(0);
