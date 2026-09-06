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
//
// AND THE THIRD THING THAT TRAVELS ON EVERY REQUEST IS THE VISITOR'S ADDRESS
// (buses-data OA-086 phase 1, 2026-09-06). Until now this serialiser wrote
// `remoteAddress: req.ip` in full, and Caddy wrote its own copy of the same
// address. That was defensible while every visitor came to busmaps.uk of their
// own accord and /legal.html could truthfully say there is no other
// organisation involved. It stops being defensible the moment a map is embedded
// on a council's page: the visitor never chose to contact us, the council is
// the controller for that visit, and the addresses we would be accumulating are
// its residents'. `maskIp()` below removes the household from the address
// before it reaches a log, in both places, so an embed does not turn a bus map
// into an audience measurement nobody asked for.
//
// THE RATE LIMITER IS NOT AFFECTED AND MUST NOT BE. `rateLimited()` in
// src/http/helpers.js buckets by the FULL address, in memory, for sixty
// seconds, and never writes it anywhere. Masking at the point of logging and
// keeping the full address at the point of decision are separable, and the
// whole reason this change is cheap is that they were already separate — the
// two call sites of `req.ip` are the serialiser below and that limiter. Do not
// "tidy" them into one masked value: /24 buckets would let one abusive host
// spend a whole street's allowance.

/** Route prefixes whose query string is dropped before the URL is logged. */
export const BARE_QUERY_ROUTES = ['/api/public/search', '/maps?', '/auth/verify?'];

/**
 * How much of an address survives into a log. IPv4 keeps its first three
 * octets; IPv6 keeps its first two groups.
 *
 * THE IPv6 NUMBER IS NOT THE CONVENTIONAL ONE, DELIBERATELY. The pairing you
 * will find in most guidance is /24 and /48 — Google Analytics zeroes the last
 * 80 bits, which is exactly a /48. That pairing is not symmetric: a residential
 * IPv6 allocation is a /56 or a /48, so masking to /48 leaves the household's
 * entire prefix intact and anonymises nothing at all. /32 is the honest
 * analogue of the /24 — it is roughly an ISP's own allocation, so what survives
 * is "which provider, roughly where", which is all a /24 leaves of an IPv4
 * address and all this log needs.
 */
export const IP_MASK_BITS = { ipv4: 24, ipv6: 32 };

/**
 * An address as it should appear in a log line: the network part, then zeroes.
 * `203.0.113.47` becomes `203.0.113.0`, `2001:db8:1234::5` becomes `2001:db8::`.
 *
 * Anything it cannot parse as an address becomes `unknown` rather than being
 * passed through. That direction is deliberate: a value this function does not
 * recognise is, by definition, one whose identifying content it cannot reason
 * about, and letting it through would make the guarantee conditional on the
 * shape of the input. A log line saying `unknown` is a bug worth finding; a log
 * line quietly holding a full address is the thing this exists to prevent.
 */
export function maskIp(ip) {
  if (typeof ip !== 'string' || !ip) return 'unknown';
  // Fastify hands back an IPv4-mapped IPv6 address (`::ffff:203.0.113.47`) when
  // the socket is v6 but the peer is v4, which is the normal shape behind a
  // dual-stack proxy. It is a v4 address wearing a v6 spelling, so mask it as one.
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  const plain = v4mapped ? v4mapped[1] : ip;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(plain)) {
    const parts = plain.split('.').map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'unknown';
    const keep = IP_MASK_BITS.ipv4 / 8;
    return [...parts.slice(0, keep), ...Array(4 - keep).fill(0)].join('.');
  }

  if (plain.includes(':')) {
    // Only the leading groups are kept, so the address never has to be expanded:
    // whatever follows them is discarded and `::` says so. Splitting on `::`
    // FIRST is what makes that true of a compressed address as well — the
    // leading groups always live before the compression, and an address with
    // fewer of them than we keep (`fe80::1`, `::1`) has zeroes there anyway.
    const keep = IP_MASK_BITS.ipv6 / 16;
    const head = plain.split('%')[0].split('::')[0].split(':').filter(Boolean).slice(0, keep);
    if (head.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return 'unknown';
    return `${head.join(':')}::`;
  }

  return 'unknown';
}

/**
 * The URL as it should appear in a log line: unchanged, except on the routes
 * above, where everything from the `?` onwards is dropped.
 */
export function loggableUrl(url) {
  if (!url) return url;
  return BARE_QUERY_ROUTES.some((p) => url.startsWith(p)) ? url.split('?')[0] : url;
}

/**
 * The whole request line, as Fastify's `req` serialiser. src/server.js passes
 * this function itself rather than calling the two helpers inline.
 *
 * IT IS OUT HERE FOR THE REASON THE REST OF THIS FILE IS, and the reason got
 * sharper when the address mask arrived. `loggableUrl` and `maskIp` can each be
 * driven by a test on their own — but "the masker works" and "the log line comes
 * out masked" are different claims, and the wire between them was a call inside
 * a config object that no test could reach. That is the shape where a guarantee
 * has 23 green assertions and one un-probed wire. A test can now call this and
 * read the object that actually reaches the log.
 */
export function loggableReq(req) {
  return {
    method: req.method,
    url: loggableUrl(req.url),
    host: req.host,
    remoteAddress: maskIp(req.ip),
    remotePort: req.socket ? req.socket.remotePort : undefined,
  };
}
