// THE ONE STATEMENT OF WHICH PEERS MAY SPEAK FOR SOMEBODY ELSE.
//
// It is a module rather than a literal in the `Fastify({...})` options for the
// reason `loggableReq` is one (src/public/logRedaction.js): a value written
// inline in that object can be asserted about only by reading the source, so
// every test stops one call short of the thing the server actually uses. Here
// the suite imports THIS constant and probes it through a real Fastify, so the
// assertion is about the value the app is configured with.
//
// ---------------------------------------------------------------------------
// WHAT WAS HERE BEFORE, AND WHY IT DID NOTHING (buses-data OA-256)
//
// `trustProxy: 1` — with a comment explaining that `1` "trusts exactly one hop
// — the local Caddy — so req.ip is the address Caddy actually saw". That is
// what a NUMBER means in Express, and it is not what it means in Fastify.
// Fastify's `getTrustProxyFn` (node_modules/fastify/lib/request.js) answers a
// numeric option with `function () { return false }` and says why:
//
//     Hop-count-only trust cannot validate the immediate peer. Fail closed so
//     direct clients cannot spoof X-Forwarded-* values by supplying enough hops.
//
// So `1` trusted NOTHING. Fastify's own shipped test for it is titled "trust
// proxy number ignores forwarded headers" and asserts that req.ip falls back to
// the socket address — deliberate upstream behaviour, not a misconfiguration.
//
// The consequence on the live host, measured 2026-09-06 by reading the app's
// log there: `req.ip` was the Docker bridge gateway (172.18.0.1) for EVERY
// visitor, because compose publishes `127.0.0.1:5180` and Caddy runs on the
// host, so the container sees every request arriving from the gateway. `req.ip`
// has two consumers. In the log it was harmless. In `rateLimited()` it was not:
// /api/apply, /api/contact, /api/public/feedback and the sign-in POST were
// limited IN TOTAL rather than per person, so one abusive host exhausted the
// allowance for everybody and the per-visitor protection was absent.
//
// ---------------------------------------------------------------------------
// WHY THIS VALUE, AND NOT `true`
//
// `true` trusts the WHOLE X-Forwarded-For chain and takes the leftmost entry,
// which is the value the CLIENT sent. Caddy appends the real peer rather than
// replacing the header, so under `true` anyone could pick their own req.ip with
// a header and rotate it to defeat every limit (technical-audit_2026-08-19 S3).
// That is the hole S3 closed and this must not reopen it.
//
// An ADDRESS LIST is the spelling that means what the old comment claimed.
// proxy-addr walks the chain outwards from the socket and stops at the first
// address that is not trusted, so naming the proxy's address peels exactly the
// hops the proxy added and no more. Measured, with the peer under control:
//
//   peer 172.18.0.1, XFF "203.0.113.9"              -> req.ip 203.0.113.9
//   peer 172.18.0.1, XFF "1.2.3.4, 203.0.113.9"     -> req.ip 203.0.113.9
//   peer 172.18.0.1, XFF "10.0.0.5, 203.0.113.9"    -> req.ip 203.0.113.9
//   peer 198.51.100.7, XFF "1.2.3.4"                -> req.ip 198.51.100.7
//
// Row two is the spoof: the client's own entry is further up the chain than the
// address Caddy appended, the walk stops at the untrusted real client, and the
// spoof is never reached. Row three is the same attack using a PRIVATE address,
// which is worth stating because `uniquelocal` trusts private addresses — it
// still fails, because trust is evaluated by position in the chain and not by
// whether the string looks local. Row four is the fail-closed case: if the
// published port is ever exposed, a direct client's header is ignored.
//
// `uniquelocal` rather than `172.18.0.1` because a Docker bridge is renumbered
// by Docker, not by us, and a value that is correct until the network is
// recreated is a value that fails silently and exactly like this one did.
// `loopback` beside it so the same path is exercised in dev and in the suite,
// and so that reaching the app over loopback — which docs/DEPLOY.md's own probe
// does — is not a second, untested behaviour. Neither preset can be reached
// from the internet: compose binds the published port to 127.0.0.1.
export const TRUST_PROXY = 'loopback, uniquelocal';
