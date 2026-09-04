// One shape for an unexpected failure, and one for a path that is not routed
// (OA-224 Tier 5, portal-src F4).
//
// 24 `try` blocks and 11 explicit `.code(500)` covered the failures this code
// knows about, and every one answers `{ok:false,error}` — the envelope the
// client reads in 128 places. Anything ELSE fell through to Fastify's default,
// `{statusCode,error,message}`, for exactly the cases nobody anticipated. That
// is the wrong way round: the shape a client can rely on was guaranteed for the
// errors somebody had thought about, and not for the ones they had not. `ok` was
// absent, so `if (!r.ok)` — the standard test in this app's own JavaScript —
// read `undefined` and took the SUCCESS branch on a crash.
//
// THE 404's `code` IS AN INTERFACE, NOT A DETAIL, and that is most of what this
// file exists to pin. `scripts/check-live-routes.mjs` asks a deployed site
// whether every route in the snapshot still answers, and it can only do that by
// telling a ROUTER 404 (the route is gone) from a HANDLER 404 (the route is
// there and the thing behind it is not, which is what `/m/:slug` must do for an
// unpublished slug). Before this handler existed it told them apart by matching
// Fastify's default message string — a discriminator nobody had declared, that
// adding a not-found handler would have broken silently, and whose failure mode
// is the loudest false alarm available: *every route on the live site is gone*.
//
// So the body carries BOTH: `code: "route_not_found"`, which is the declared
// discriminator, and Fastify's old `message` wording as a compatibility shim so
// the two changes could land in either order. Both are asserted below. Deleting
// the shim is a change that must go out AFTER every deployment carries this
// handler, and the assertion is what will make somebody notice.
//
// Usage, from the repository root:  node scripts/test-error-envelope.mjs
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-envelope-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { errorEnvelope, wantsJson } = await import('../src/http/errors.js');
const { app } = await import('../src/server.js');
await app.ready();

const get = (method, url, headers = {}) => app.inject({ method, url, headers });

console.log('\nan unrouted /api path answers the house envelope');
for (const method of ['GET', 'POST', 'PATCH']) {
  const r = await get(method, '/api/definitely-not-a-route');
  const b = r.json() || {};
  check(`${method}: 404 with ok:false`, r.statusCode === 404 && b.ok === false, `${r.statusCode} ${r.body.slice(0, 80)}`);
  check('  …and code:"route_not_found", the declared discriminator', b.code === 'route_not_found', JSON.stringify(b.code));
  check('  …and `error` is a sentence naming the method and path', typeof b.error === 'string' && b.error.includes(method), b.error);
}

console.log('\nthe compatibility shim check-live-routes.mjs may still be reading');
const shim = await get('GET', '/api/definitely-not-a-route');
check('the body still carries Fastify\'s old "Route GET:/… not found" wording',
  /^Route GET:\/api\/definitely-not-a-route not found$/.test((shim.json() || {}).message || ''),
  JSON.stringify((shim.json() || {}).message));
check('…and check-live-routes.mjs would read it as a ROUTER miss either way',
  /"code"\s*:\s*"route_not_found"/.test(shim.body) && /^\{"ok":false/.test(shim.body.trim()));

console.log('\na browser navigating to a dead URL still gets the not-found PAGE');
const page = await get('GET', '/definitely-not-a-page');
check('404 and HTML, not JSON', page.statusCode === 404 && String(page.headers['content-type'] || '').includes('text/html'),
  `${page.statusCode} ${page.headers['content-type']}`);
check('…and it is our page, not a stack trace', page.body.includes('We can’t find that'), page.body.slice(0, 80));

console.log('\nthe two audiences are told apart by the path, and by Accept');
const jsonByAccept = await get('GET', '/definitely-not-a-page', { accept: 'application/json' });
check('a JSON client asking for a dead PAGE gets the envelope',
  jsonByAccept.statusCode === 404 && (jsonByAccept.json() || {}).code === 'route_not_found',
  jsonByAccept.body.slice(0, 80));

console.log('\na handler 404 is NOT a router miss, which is the distinction that matters');
// /api/public/maps/:slug is routed; the slug is not published. This must NOT
// carry the router code, or check-live-routes.mjs would report a live route as
// gone every time somebody asked for a map that is not published.
const handler404 = await get('GET', '/api/public/maps/no-such-slug-at-all');
check('the route answers 404 from its own handler', handler404.statusCode === 404, String(handler404.statusCode));
check('…and does NOT carry code:"route_not_found"', (handler404.json() || {}).code !== 'route_not_found',
  handler404.body.slice(0, 120));

console.log('\nan unexpected throw becomes the envelope, and says nothing it should not');
/* THE 5xx BRANCH CANNOT BE PROVOKED THROUGH THE APP, and that is the point of it:
 * every route that can fail already catches its own failure, so what reaches an
 * error handler is by definition the case nobody anticipated. Fastify also
 * refuses a route added after `ready()`, so a throwing test route is not
 * available either. That is why the decisions live in src/http/errors.js as pure
 * functions — this calls them with a deliberately horrible error and reads the
 * answer, which is a stronger test than a contrived route would have been. */
const leaky = new Error('a secret path C:/Users/Peter/.env and a token abc123');
const five = errorEnvelope(leaky);
check('an error with no statusCode is a 500', five.status === 500, String(five.status));
check('…with ok:false and OUR sentence, not the exception text',
  five.body.ok === false && five.body.error === 'Something went wrong at our end. Please try again.', JSON.stringify(five.body));
check('…so the file path and the token reach nobody',
  !JSON.stringify(five.body).includes('C:/Users') && !JSON.stringify(five.body).includes('abc123'), JSON.stringify(five.body));

const bad = Object.assign(new Error('That will not do.'), { statusCode: 400 });
check('a 4xx keeps its own message, because somebody chose those words',
  errorEnvelope(bad).status === 400 && errorEnvelope(bad).body.error === 'That will not do.');
check('a nonsense statusCode falls back to 500 rather than being sent',
  errorEnvelope(Object.assign(new Error('x'), { statusCode: 42 })).status === 500);
check('…and so does one outside the HTTP range',
  errorEnvelope(Object.assign(new Error('x'), { statusCode: 900 })).status === 500);

console.log('\nand a real malformed request still travels through that handler');
// The 4xx branch IS reachable through the app: Fastify raises on a body that is
// not the JSON its content-type claims.
const malformed = await app.inject({
  method: 'POST', url: '/api/apply',
  headers: { 'content-type': 'application/json' }, payload: '{not json',
});
check('a malformed JSON body is refused with the house envelope',
  malformed.statusCode >= 400 && malformed.statusCode < 500 && (malformed.json() || {}).ok === false,
  `${malformed.statusCode} ${malformed.body.slice(0, 100)}`);

console.log('\nwantsJson picks the audience by path first, then by Accept');
check('an /api path wants JSON whatever it says', wantsJson({ url: '/api/x', headers: {} }) === true);
check('a page path does not', wantsJson({ url: '/maps', headers: {} }) === false);
check('…unless it asks', wantsJson({ url: '/maps', headers: { accept: 'application/json' } }) === true);

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all error-envelope checks passed');
process.exit(failures ? 1 : 0);
