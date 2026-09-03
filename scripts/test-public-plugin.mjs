// The public front's plugin (OA-232 Tier 3.2, codebase review 2026-09-03
// portal-src F25) — four claims, three of which only a running app can make and
// one of which only the SOURCE can.
//
// 1. EVERY PUBLIC URL IS SERVED, ANONYMOUSLY, AND THE POPULATION IS THE TABLE.
//    Enumerated from ROUTE_TABLE, not from a list written here, so a twentieth
//    public route is checked the same way as the first. The route table itself
//    — nothing gained, nothing lost by the cut — is scripts/route-table.json and
//    is asserted by test-admin-plugin.mjs; this file does not repeat that.
//
// 2. A MISSING SLUG IS A HANDLER 404, NOT A ROUTER 404, and that distinction is
//    load-bearing rather than cosmetic. scripts/check-live-routes.mjs asks the
//    DEPLOYED site whether every route still answers, and it tells "the route is
//    gone" from "the route is there and the thing behind it is not" by the
//    `code: 'route_not_found'` discriminator in the body. If this cut had lost a
//    route, /m/:slug would answer a router 404 carrying that code and the deploy
//    check would be the only thing that noticed — after the deploy. This asserts
//    it before.
//
// 3. NO GUARD CREPT IN. Everything here is unauthenticated and read-only by
//    design; there is no preHandler in src/routes/public.js and no route in it
//    may answer 401 or 403 to an anonymous caller. This is the inverse of what
//    test-pages-plugin.mjs and test-admin-plugin.mjs assert about their own
//    plugins, and it is worth stating because a hook added to this file would
//    take the whole public site down and every other test here would still pass.
//
// 4. THE ADOPTION CHECK — the one the 2026-09-03 review says every extraction
//    needs and eight of ten did not get. A public route added back into
//    src/server.js would work perfectly, pass claims 1 to 3, and quietly undo
//    the cut; so this reads the SOURCE and asserts that no public URL is
//    registered outside src/routes/public.js. It also asserts both directions of
//    the dependency rule src/routes/pages.js's header states — a route file never
//    imports from server.js, and server.js imports from src/routes/ nothing but
//    the plugins themselves — and that src/server.js has no import it does not
//    use, which is how 63 dead ones accumulated there unnoticed through the
//    OA-231 cuts before this one removed them.
//
// Usage, from the repository root (C:\Claude\community-bus-maps), no placeholders:
//     node scripts/test-public-plugin.mjs
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-public-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
delete process.env.OPERATOR_TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 ${name}${extra ? ' — ' + extra : ''}`); }
};

await import('../src/db/index.js');
const { app, ROUTE_TABLE } = await import('../src/server.js');
await app.ready();

const table = [...new Set(ROUTE_TABLE)].sort();

// The public URL shapes, as a predicate rather than a list, so a new route under
// one of the three namespaces joins the population automatically. GET /* is
// fastify-static's catch-all and belongs to no plugin.
//
// EXACT AND PREFIX ARE SEPARATE LISTS, and that is not tidiness. Written as one
// loose startsWith list, this predicate called '/maps-disabled' a public URL, so
// prove-red's "the catalogue stops being registered" arm SURVIVED: the count
// stayed at nineteen while /maps 404ed. Six of these nine are single URLs and
// nothing may hang off them; three are namespaces and anything under them is
// public by construction.
const PUBLIC_EXACT = ['/maps', '/robots.txt', '/sitemap.xml', '/js/site-banner.js', '/api/apply', '/api/contact'];
const PUBLIC_PREFIXES = ['/api/public/', '/m/', '/o/'];
const isPublicUrl = (u) => PUBLIC_EXACT.includes(u) || PUBLIC_PREFIXES.some((p) => u.startsWith(p));
const publicRows = table.filter((r) => isPublicUrl(r.slice(r.indexOf(' ') + 1)));

console.log('\nthe routes the plugin owns');
// Fastify adds a HEAD twin for every GET (exposeHeadRoutes), so the TABLE holds
// more rows than the file declares. Both numbers are asserted: nineteen is what
// the plugin registers, and the twins are what a crawler sending HEAD relies on
// — losing them would be silent to every other check here.
const declared = publicRows.filter((r) => !r.startsWith('HEAD '));
const heads = publicRows.filter((r) => r.startsWith('HEAD '));
check('the plugin declares nineteen public routes', declared.length === 19,
  `${declared.length}: ${declared.join(', ')}`);
check('…and every GET among them has its automatic HEAD twin',
  declared.filter((r) => r.startsWith('GET ')).every((r) => heads.includes('HEAD ' + r.slice(4))),
  `${heads.length} HEAD rows for ${declared.filter((r) => r.startsWith('GET ')).length} GETs`);
check('registering with no prefix added no trailing-slash twin',
  !publicRows.some((r) => r.endsWith('/')), publicRows.filter((r) => r.endsWith('/')).join(' | '));

// An empty database is deliberate: nothing is published, so every route that
// looks a map up takes its not-found path, which is the interesting one.
const FILL = { ':slug': 'no-such-map', ':file': 'internal.jpg', ':base': 'internal' };
const fill = (u) => Object.entries(FILL).reduce((acc, [k, v]) => acc.split(k).join(v), u);

console.log('\nevery public route answers an anonymous caller, and none of them refuses');
for (const row of publicRows) {
  const i = row.indexOf(' ');
  const method = row.slice(0, i);
  const url = fill(row.slice(i + 1));
  const r = await app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}) });
  check(`${row}: anonymous is not refused (got ${r.statusCode})`,
    r.statusCode !== 401 && r.statusCode !== 403, `${r.statusCode}`);
  let body = null;
  try { body = JSON.parse(r.payload); } catch { /* an HTML page; checked below */ }
  check(`${row}: …and it is the app answering, not the router`,
    !(body && body.code === 'route_not_found'), r.payload.slice(0, 120));
}

console.log('\nthe router 404 that discriminator is FOR still exists');
const gone = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' });
check('an unregistered /api URL is a router 404 carrying code: route_not_found',
  gone.statusCode === 404 && JSON.parse(gone.payload).code === 'route_not_found', gone.payload.slice(0, 160));

console.log('\nthe not-found paths serve the HTML 404 page, not an empty one');
for (const url of ['/m/no-such-map', '/m/no-such-map/services', '/o/no-such-org', '/nope-not-here']) {
  const r = await app.inject({ method: 'GET', url });
  check(`${url}: 404 with the "we can't find that" page`,
    r.statusCode === 404 && r.payload.includes('We can\u2019t find that') && r.payload.includes('/maps'),
    `${r.statusCode}, ${r.payload.length} bytes`);
}

console.log('\nthe two crawler files and the generated banner still come out of this plugin');
const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
check('/robots.txt is text and names the sitemap',
  robots.statusCode === 200 && robots.payload.includes('Sitemap:'), robots.payload.slice(0, 80));
const sitemap = await app.inject({ method: 'GET', url: '/sitemap.xml' });
check('/sitemap.xml is a urlset with the static pages in it',
  sitemap.statusCode === 200 && sitemap.payload.includes('<urlset') && sitemap.payload.includes('/faq.html'),
  sitemap.payload.slice(0, 120));
const banner = await app.inject({ method: 'GET', url: '/js/site-banner.js' });
check('/js/site-banner.js is JavaScript and carries the version badge',
  banner.statusCode === 200 && banner.payload.includes("m.name = 'app-version'"), banner.payload.slice(0, 80));

// ---------------------------------------------------------------------------
// 4. The source-level half — what a running app cannot tell you.
// ---------------------------------------------------------------------------
const SRC = path.join(ROOT, 'src');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const routeFiles = readdirSync(path.join(SRC, 'routes')).filter((f) => f.endsWith('.js'));

console.log('\nthe public routes are registered in ONE file, and it is the plugin');
// The registration IDIOM, not the URL: `app.get('/maps'` reappearing in
// src/server.js is the thing that would undo this cut, and it is what this looks
// for.
//
// A ROUTE LITERAL IN A PREFIXED PLUGIN IS NOT A URL, and this check's first run
// proved it by reporting three false findings: src/routes/pages.js declares
// '/maps/:id' and it is served at /app/maps/:id. So each file's prefix is read
// out of src/server.js's own register call and prepended before the question is
// asked. A plugin whose prefix this cannot find is a finding, not a skip.
const REG = /\bapp\.(get|post|put|delete|patch|head|all)\(\s*(['"`])([^'"`]+)\2/g;
const serverText = read('src/server.js');
const prefixFor = (file) => {
  const im = serverText.match(new RegExp(`import\\s+(\\w+)\\s+from\\s+'\\./routes/${file.replace('.', '\\.')}'`));
  if (!im) return null;
  const reg = serverText.match(new RegExp(`app\\.register\\(${im[1]}(?:,\\s*\\{[^}]*prefix:\\s*'([^']*)'[^}]*\\})?\\s*\\)`));
  return reg ? (reg[1] || '') : null;
};
for (const f of routeFiles) {
  const p = prefixFor(f);
  check(`src/routes/${f} is registered by src/server.js, so its prefix is known`, p !== null);
  if (f === 'public.js') { check('…and the public plugin is registered with NO prefix', p === ''); continue; }
  const claimed = [...read(`src/routes/${f}`).matchAll(REG)].map((m) => (p || '') + m[3]).filter(isPublicUrl);
  check(`src/routes/${f} registers no public URL`, claimed.length === 0, claimed.join(', '));
}
const serverClaims = [...serverText.matchAll(REG)].map((m) => m[3]).filter(isPublicUrl);
check('src/server.js registers no public URL', serverClaims.length === 0, serverClaims.join(', '));
const pluginSrc = read('src/routes/public.js');
const pluginRegs = [...pluginSrc.matchAll(REG)];
check('src/routes/public.js registers all nineteen', pluginRegs.length === 19, String(pluginRegs.length));
check('…and it has no preHandler hook, because it has nothing to guard',
  !/addHook\(\s*['"]preHandler/.test(pluginSrc));

console.log('\nthe dependency rule holds in both directions');
for (const f of routeFiles) {
  check(`src/routes/${f} does not import from server.js`,
    !/from\s+['"][./]*server\.js['"]/.test(read(`src/routes/${f}`)));
}
const serverSrc = read('src/server.js');
const fromRoutes = [...serverSrc.matchAll(/import\s+([^;]*?)\s+from\s+'\.\/routes\/[\w.]+'/g)];
check('src/server.js imports from src/routes/ nothing but the plugins themselves',
  fromRoutes.length > 0 && fromRoutes.every((m) => /^\w+$/.test(m[1].trim())),
  fromRoutes.map((m) => m[1].trim()).join(' | '));

console.log('\nsrc/server.js has no import it does not use');
// The fault this closes: 63 of its imports were dead on 2026-09-03, every one of
// them left behind by a route moving out under OA-231 while its import stayed. A
// dead import is not free — it makes the bootstrap read as though it still does
// the work it handed away, and it is invisible to every runtime test here.
{
  const lines = serverSrc.split(/\r?\n/);
  const lastImport = lines.reduce((acc, l, i) => (l.startsWith('import ') ? i : acc), -1);
  const body = lines.slice(lastImport + 1).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l)).join('\n');
  const names = [];
  for (const m of lines.slice(0, lastImport + 1).join('\n').matchAll(/import\s+(?:(\w+)|\{([^}]*)\})\s+from/g)) {
    if (m[1]) names.push(m[1]);
    else for (const s of m[2].split(',')) { const t = s.trim(); if (t) names.push(t.split(' as ').pop().trim()); }
  }
  const dead = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(body));
  check(`all ${names.length} imports are used`, dead.length === 0, `dead: ${dead.join(', ')}`);
}

console.log(failures ? `\n\u2717 ${failures} check(s) failed` : '\n\u2713 all public-plugin checks passed');
process.exit(failures ? 1 : 0);
