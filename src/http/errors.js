// What an unexpected failure, and an unrouted path, look like to a caller
// (OA-224 Tier 5, portal-src F4).
//
// The decisions live here rather than inline in `server.js` for one reason: the
// 5xx branch is the branch nobody can reach on purpose. Every route that can
// fail already catches its own failure and answers `{ok:false,error}`; what
// falls through to an error handler is by definition the case nobody
// anticipated, so a test cannot provoke it by asking the app nicely. As pure
// functions they can be called with a deliberately horrible error and the
// answer read — which is how `scripts/test-error-envelope.mjs` asserts that a
// thrown message carrying a file path and a token reaches nobody.
//
// TWO AUDIENCES. An `/api/` caller gets the envelope this app's own JavaScript
// tests with `if (!r.ok)`; a browser navigating to a dead URL gets the
// not-found page the public map routes already serve. The `Accept` header
// decides for the paths that are neither.

/** Does this request want JSON — because of where it is, or because it said so? */
export function wantsJson(req) {
  const url = String(req.url || '');
  const accept = String((req.headers && req.headers.accept) || '');
  return url.startsWith('/api/') || accept.includes('application/json');
}

/**
 * The body for a path the router does not know.
 *
 * `code` IS AN INTERFACE. `scripts/check-live-routes.mjs` asks a deployed site
 * whether every route in the snapshot still answers, and can only do so by
 * telling a ROUTER 404 — the route is gone — from a HANDLER 404, which is what
 * `/m/:slug` must return for a slug nobody published. It used to tell them apart
 * by matching Fastify's default message string: a discriminator nobody had
 * declared, that adding this handler would have broken silently, and whose
 * failure mode is the loudest false alarm available — *every route on the live
 * site is gone*.
 *
 * So `message` repeats Fastify's old wording on purpose. It is a compatibility
 * shim that lets this handler and that checker land in either order, and it can
 * go once no deployment predates this file. The assertion in
 * test-error-envelope.mjs is what will make somebody notice.
 */
export function notFoundEnvelope(method, url) {
  return {
    ok: false,
    code: 'route_not_found',
    error: `No route for ${method} ${url}.`,
    message: `Route ${method}:${url} not found`,
  };
}

/**
 * The status and body for anything thrown past a route's own handling.
 *
 * A 5xx IS OURS AND ITS TEXT IS NOT THE CALLER'S. An unhandled throw can carry a
 * file path, a SQL fragment, or a token in its message — this is the one path
 * where nobody chose those words for an audience, so nobody may read them. A 4xx
 * that Fastify raised (a malformed JSON body, a payload too large) is the
 * caller's own mistake and its message is written to be read, so it is passed
 * through.
 */
export function errorEnvelope(err) {
  const raw = Number(err && err.statusCode);
  const status = raw >= 400 && raw < 600 ? raw : 500;
  return {
    status,
    body: {
      ok: false,
      error: status >= 500
        ? 'Something went wrong at our end. Please try again.'
        : ((err && err.message) || 'That request could not be processed.'),
    },
  };
}
