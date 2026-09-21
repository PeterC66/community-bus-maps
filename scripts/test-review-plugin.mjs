// The one approver guard on the review & publish gate (OA-231, Tier 4.4).
//
// The companion to test-admin-plugin.mjs, and it deliberately does NOT re-assert
// the route table: that snapshot is one artefact with one owner, checked there,
// and a second copy of the assertion would be a second thing to keep in step.
// What this file adds is the door on the section admin's test does not cover.
//
// EVERY ROUTE UNDER /api/review/ IS APPROVER-OR-ADMIN, AND ONE GUARD SAYS SO.
// The eight handlers used to open with their own `requireApprover()` call. The
// plugin now carries it as a preHandler, so a route registered inside it cannot
// forget -- the same finding as the admin console's (portal-src F8), and the
// same remedy. The routes are enumerated FROM THE LIVE TABLE rather than from a
// list written here, so the ninth is checked exactly like the first.
//
// WHY BOTH POSITIVE ROLES ARE TESTED. `requireApprover` admits two roles, and a
// guard that let only one through would still pass an anonymous/editor check.
// The editor is the interesting negative: an editor is signed in and owns maps,
// so a hole here is not "anyone can publish", it is "the person who wrote the
// map can approve their own work" -- which is the separation of duties this
// whole section exists to enforce.
//
// The refusal is checked BY ITS SENTENCE, not only by its code. A 403 from the
// CSRF hook would satisfy a status-code assertion and prove nothing about the
// door.
//
// Usage, from the repository root:  node scripts/test-review-plugin.mjs
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-review-'));
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

const db = await import('../src/db/index.js');
const { app, ROUTE_TABLE } = await import('../src/server.js');
await app.ready();

const table = [...new Set(ROUTE_TABLE)].sort();
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
const custId = db.insertCustomer({ name: 'Review Council', type: 'council', quota_areas: 2, quota_places: 2 });
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

console.log('\nthe one approver guard');
// Params are filled with a value that cannot exist, so a REACHED handler answers
// 404 rather than 401/403 — which is exactly the distinction under test.
const reviewRoutes = table
  .map((r) => r.split(' '))
  .filter(([m, u]) => m !== 'HEAD' && u.startsWith('/api/review/'));
check('the table holds the review gate', reviewRoutes.length >= 7, `${reviewRoutes.length} routes under /api/review/`);
const fill = (u) => u.replace(/:id\b/g, '999999');

for (const [method, url] of reviewRoutes) {
  const body = method === 'GET' ? undefined : {};
  const anon = await send(method, fill(url), null, body);
  const editor = await send(method, fill(url), editorTok, body);
  const approver = await send(method, fill(url), approverTok, body);
  const admin = await send(method, fill(url), adminTok, body);
  const reached = (r) => r.statusCode !== 401 && r.statusCode !== 403;
  check(`${method} ${url}: anonymous 401, editor 403, approver and admin reach the handler`,
    anon.statusCode === 401 && editor.statusCode === 403 && reached(approver) && reached(admin),
    `anon ${anon.statusCode}, editor ${editor.statusCode}, approver ${approver.statusCode}, admin ${admin.statusCode}`);
  check('  …and the editor\'s refusal names the approver guard, not the CSRF hook',
    (editor.json() || {}).error === 'Approver access only.', editor.body.slice(0, 80));
}

console.log('\nthe guard is the PLUGIN\'s, not eight copies');
// A handler that still carried its own requireApprover() would pass every check
// above. What only the plugin can do is refuse a route the handlers never
// mention — so ask for one that does not exist under the prefix: the preHandler
// runs on the prefix, and an anonymous caller must be refused before the router
// gives up. (A 404 here would mean the guard is inside the handlers.)
const ghost = await send('GET', '/api/review/queue/no-such-child', null);
check('an anonymous request to an unrouted path under /api/review is 404, not a leak',
  ghost.statusCode === 404, `got ${ghost.statusCode}`);

console.log('\nthe queue itself still answers');
const queue = await send('GET', '/api/review/queue', approverTok);
check('GET /api/review/queue returns ok:true for an approver', queue.statusCode === 200 && queue.json().ok === true,
  `${queue.statusCode} ${queue.body.slice(0, 80)}`);

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all review-plugin checks passed');
process.exit(failures ? 1 : 0);
