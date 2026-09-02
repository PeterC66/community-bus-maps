// The signed-in app's page shells: the one redirect, and the four role checks it
// cannot make (OA-231, Tier 4.4).
//
// These ten routes answer a browser navigation, so every refusal here is a
// REDIRECT rather than a 401 or a 403 — which is why they are their own plugin
// and their own test rather than more of test-editor-plugin.mjs.
//
// WHAT THIS FILE IS ACTUALLY GUARDING AGAINST HAS HAPPENED HERE ONCE.
// /app/review-services.html was reachable by ANYBODY until 2026-08-20, because it
// was a static file with no route of its own (technical-audit_2026-08-19 S7): the
// clearest single case in that audit. A page shell that loses its guard does not
// fail loudly, it just serves. So the door is asserted on every route the live
// table holds, not on a list written out here.
//
// AND THE HOOK IS ONLY PART OF THE DECISION. Four of these pages are further
// restricted by ROLE and those checks stay in the handlers: /app/admin and
// /app/changelog to admins, /app/review and /app/review-services.html to
// approvers and admins, /app/maps/:id/diagram to admins. A cut that hoisted the
// cheap guard and lost the role checks would pass every anonymous assertion in
// this file while handing the admin console's shell — and the raw developer
// CHANGELOG.md, which names past security findings — to any customer who typed
// the URL. Both the refusals AND the admissions are asserted, because a suite
// that only checks refusals passes just as well when a page is broken for
// everyone.
//
// THE STATIC ASSETS UNDER /app ARE NOT BEHIND THIS HOOK AND MUST NOT BE. A
// Fastify hook is scoped to the routes of the plugin that declares it, not to
// the URL prefix, so /app/app.css is still served by @fastify/static to anybody.
// That is deliberate — the browser has to fetch the app's CSS before anyone is
// signed in — and it is asserted here because "guard the /app prefix" is the
// obvious wrong fix, and it would break the sign-in page's own stylesheet.
//
// Usage, from the repository root:  node scripts/test-pages-plugin.mjs
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-pages-'));
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

const cust = db.insertCustomer({ name: 'Pages Council', type: 'council', quota_areas: 2, quota_places: 2 });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: cust });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'approver', customer_id: null });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: cust });
const mapId = db.insertMap({ customer_id: cust, slug: 'pages-town', name: 'Pages Town', kind: 'area', status: 'draft' });

let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const editorTok = openSession(editorId), approverTok = openSession(approverId), adminTok = openSession(adminId);
const get = (url, token) => app.inject({
  method: 'GET', url,
  headers: token ? { cookie: `cbm_session=${token}` } : {},
});

// Enumerated from the LIVE table so an eleventh page is checked like the first.
const pages = table
  .filter((r) => r.startsWith('GET /app'))
  .map((r) => r.slice('GET '.length));

console.log('\nthe pages the plugin owns');
check('the table holds ten /app pages', pages.length === 10, `${pages.length}: ${pages.join(', ')}`);
check('the prefix did not add a trailing-slash twin of /app',
  !table.some((r) => r.endsWith(' /app/')), table.filter((r) => r.endsWith(' /app/')).join(' | '));

const fill = (u) => u.replace(':id', String(mapId));
const LOGIN = '/app/login.html';

console.log('\nthe one redirect, and its one declared exception');
for (const url of pages) {
  const anon = await get(fill(url));
  if (url === LOGIN) {
    check(`${url}: anonymous is SERVED — it is the sign-in page, and a hook that redirected it would loop`,
      anon.statusCode === 200, `${anon.statusCode}`);
  } else {
    check(`${url}: anonymous is redirected to the sign-in page by the plugin hook`,
      anon.statusCode === 302 && anon.headers.location === LOGIN,
      `${anon.statusCode} → ${anon.headers.location}`);
  }
}

console.log('\nthe role checks, which the plugin hook CANNOT make');
// An enumeration on purpose: which page needs which role IS the fact under test,
// so reading it out of the source would be the assertion checking its own subject.
const ROLES = [
  { url: '/app/admin', admits: ['admin'], to: '/app' },
  { url: '/app/changelog', admits: ['admin'], to: '/app' },
  { url: '/app/review', admits: ['approver', 'admin'], to: '/app' },
  { url: '/app/review-services.html', admits: ['approver', 'admin'], to: '/app' },
  { url: '/app/maps/:id/diagram', admits: ['admin'], to: `/app/maps/${mapId}` },
];
const TOKENS = { editor: editorTok, approver: approverTok, admin: adminTok };
const an = (role) => (role === 'admin' || role === 'approver' ? 'an ' : 'a ') + role;
for (const { url, admits, to } of ROLES) {
  check(`${url} is a page this plugin serves`, pages.includes(url), pages.join(' | '));
  for (const [role, token] of Object.entries(TOKENS)) {
    const r = await get(fill(url), token);
    if (admits.includes(role)) {
      check(`  ${url}: ${an(role)} is served the shell`, r.statusCode === 200, `${r.statusCode} → ${r.headers.location || ''}`);
    } else {
      check(`  ${url}: a signed-in ${role} is redirected to ${to}, not refused`,
        r.statusCode === 302 && r.headers.location === to, `${r.statusCode} → ${r.headers.location}`);
    }
  }
}

console.log('\nthe pages with no role check are open to any signed-in user');
for (const url of pages.filter((u) => u !== LOGIN && !ROLES.some((r) => r.url === u))) {
  const r = await get(fill(url), editorTok);
  check(`${url}: a plain editor is served the shell`, r.statusCode === 200, `${r.statusCode} → ${r.headers.location || ''}`);
}

console.log('\nthe static assets under /app are NOT behind the hook');
// A Fastify hook is scoped to its plugin's routes, not to the URL prefix. Guarding
// the prefix instead is the obvious wrong fix, and it would take the sign-in page's
// own stylesheet down with it.
const css = await get('/app/app.css');
check('/app/app.css is served to an anonymous browser', css.statusCode === 200, `${css.statusCode} → ${css.headers.location || ''}`);
check('…and it really is the stylesheet, not a shell or a redirect',
  String(css.headers['content-type'] || '').includes('css'), String(css.headers['content-type']));

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all pages-plugin checks passed');
process.exit(failures ? 1 : 0);
