// The route table, and the one admin guard (OA-231 -- codebase review Tier 4.4).
//
// Two claims, both of which only a running app can make.
//
// 1. THE ROUTE TABLE IS THE ONE RECORDED BEFORE THE SPLIT. `route-table.json`
//    beside this file was written from `src/server.js` on 2026-09-02, BEFORE the
//    admin console moved into `src/routes/admin.js`, by `--record`. Every cut
//    since has to reproduce it exactly: same methods, same URLs, nothing gained
//    and nothing lost. A route that moves between files is invisible here, which
//    is the point -- the file is not the interface, the table is.
//
// 2. EVERY ROUTE UNDER /api/admin/ IS ADMIN-ONLY, AND IT IS ONE GUARD THAT SAYS
//    SO. The console's routes used to open with their own `requireAdmin()` call,
//    twenty-three times, and the review (portal-src F8) named the risk in that
//    shape: a new admin route that forgets the line is silent. The plugin now
//    carries the guard as a preHandler, so a route registered inside it cannot
//    forget. This test enumerates the table rather than a list written by hand,
//    so the twenty-third route is checked the same way as the first, and the
//    twenty-fourth will be.
//
// The exceptions are the exceptions on purpose: POST /api/admin/status is not
// in the plugin, because it is a STATUS_TOKEN drop-box that 404s to a session;
// and GET /api/admin/worklist admits the read-only OPERATOR_TOKEN, declared as
// route config so the guard can see it -- test-operator-token.mjs holds that
// route's own contract, this one only checks the door is where it says it is.
//
// Usage, from the repository root:
//   node scripts/test-admin-plugin.mjs            check
//   node scripts/test-admin-plugin.mjs --record   rewrite route-table.json from the app as built
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-admin-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
delete process.env.OPERATOR_TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const { app, ROUTE_TABLE } = await import('../src/server.js');
await app.ready();

const SNAPSHOT = new URL('./route-table.json', import.meta.url);
const table = [...new Set(ROUTE_TABLE)].sort();

if (process.argv.includes('--record')) {
  writeFileSync(SNAPSHOT, JSON.stringify(table, null, 2) + '\n');
  console.log(`recorded ${table.length} routes -> scripts/route-table.json`);
  process.exit(0);
}

console.log('\nthe route table');
const recorded = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
eq('the app registers exactly the routes recorded before the split', table, recorded);
const missing = recorded.filter((r) => !table.includes(r)), extra = table.filter((r) => !recorded.includes(r));
if (missing.length || extra.length) console.error(`    missing: ${missing.join(', ') || '-'}\n    extra: ${extra.join(', ') || '-'}`);
check('the table is not empty', table.length > 50, `${table.length} routes`);

console.log('\nthe one admin guard');
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
const custId = db.insertCustomer({ name: 'Guard Council', type: 'council', quota_areas: 2, quota_places: 2 });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: custId });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: custId });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'approver', customer_id: null });
let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const adminTok = openSession(adminId), editorTok = openSession(editorId), approverTok = openSession(approverId);
const CSRF = 'test-csrf-token-value';
const send = (method, url, token, body) => app.inject({
  method, url,
  headers: {
    ...(token ? { cookie: `cbm_session=${token}; cbm_csrf=${CSRF}` } : { cookie: `cbm_csrf=${CSRF}` }),
    'x-csrf-token': CSRF, 'content-type': 'application/json',
  },
  payload: body === undefined ? undefined : JSON.stringify(body),
});

// The table, not a list: every non-HEAD route under /api/admin/ except the
// STATUS_TOKEN drop-box. Params are filled with a value that cannot exist, so a
// reached handler answers 404 rather than 401/403 -- which is exactly the
// distinction under test.
const adminRoutes = table
  .map((r) => r.split(' '))
  .filter(([m, u]) => m !== 'HEAD' && u.startsWith('/api/admin/') && u !== '/api/admin/status');
check('the table holds the admin console', adminRoutes.length >= 22, `${adminRoutes.length} routes under /api/admin/`);
const fill = (u) => u.replace(/:id\b/g, '999999').replace(/:handle\b/g, 'nosuchhandle');

for (const [method, url] of adminRoutes) {
  const anon = await send(method, fill(url), null, method === 'GET' ? undefined : {});
  const editor = await send(method, fill(url), editorTok, method === 'GET' ? undefined : {});
  const approver = await send(method, fill(url), approverTok, method === 'GET' ? undefined : {});
  const admin = await send(method, fill(url), adminTok, method === 'GET' ? undefined : {});
  check(`${method} ${url}: anonymous 401, editor 403, approver 403, admin reaches the handler`,
    anon.statusCode === 401 && editor.statusCode === 403 && approver.statusCode === 403
      && admin.statusCode !== 401 && admin.statusCode !== 403,
    `anon ${anon.statusCode}, editor ${editor.statusCode}, approver ${approver.statusCode}, admin ${admin.statusCode}`);
  // The refusal must be the guard's, not the CSRF hook's -- a 403 for the wrong
  // reason would satisfy the line above and prove nothing about the door.
  check(`  …and the editor's refusal names the guard`, (editor.json() || {}).error === 'Admin access only.', editor.body.slice(0, 80));
}

console.log('\nthe declared exception');
const wl = table.find((r) => r === 'GET /api/admin/worklist');
check('GET /api/admin/worklist is in the table', !!wl);
const status = table.find((r) => r === 'POST /api/admin/status');
check('POST /api/admin/status is in the table and outside the plugin', !!status && (await send('POST', '/api/admin/status', editorTok, {})).statusCode === 404);

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all admin-plugin checks passed');
process.exit(failures ? 1 : 0);
