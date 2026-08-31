// What the application log is allowed to record of a request line.
//
// Out here rather than inline in src/server.js so a test can drive the actual
// behaviour — "what does /auth/verify?token=abc become?" — instead of asserting
// that a regex looks right. Same argument as src/public/robots.js.
//
// THE RULE. Two kinds of thing travel in a query string on this site and neither
// belongs in a log file:
//
//   a SEARCH TERM (`q` on /api/public/search and /maps). P9 B8: search queries
//   are never logged, and an access log counts as a log.
//
//   a SIGN-IN CREDENTIAL (`token` on /auth/verify). A magic link is the one
//   credential here that cannot be moved into a header, because it arrives as a
//   link in an email. Single-use with a 15-minute TTL — and a cross-site arrival
//   only PEEKS at it, showing a confirmation page, so a token written to a log
//   can still be spendable when somebody reads it. The two OPS tokens that used
//   to accept `?token=` were deleted outright in the 2026-08-25 audit (N7),
//   because they could be; this one is stripped from the log instead.
//
// THIS IS ONE OF TWO LISTS AND THEY MUST BE KEPT TOGETHER. Caddy has its own
// access log, which this cannot reach, redacting `q` and `token` in a `format
// filter` block in ./Caddyfile. This list is by ROUTE PREFIX, because Fastify
// knows the route; Caddy's is by PARAMETER NAME, because a proxy does not.
// Putting a sensitive parameter on a new route means editing both.

/** Route prefixes whose query string is dropped before the URL is logged. */
export const BARE_QUERY_ROUTES = ['/api/public/search', '/maps?', '/auth/verify?'];

/**
 * The URL as it should appear in a log line: unchanged, except on the routes
 * above, where everything from the `?` onwards is dropped.
 */
export function loggableUrl(url) {
  if (!url) return url;
  return BARE_QUERY_ROUTES.some((p) => url.startsWith(p)) ? url.split('?')[0] : url;
}
