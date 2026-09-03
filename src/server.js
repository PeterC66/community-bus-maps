// BusMaps.uk — portal server.
//   P0: public shopfront (apply / contact / health).
//   P1: safe-subset editor (object store, versioned save→render→download).
//   P2: passwordless auth, multi-customer tenant isolation, per-map output toggles.
//   P3: application approval, map-request lifecycle + quota, admin console.
//   P4: publish gate (draft/published, approver review, audit).
//   P5: monthly change acceptance (proposed updates, old-vs-new, accept/decline).
//   P6: public front — published maps get public pages (/maps, /m/:slug, /o/:slug),
//       per-customer branding, map feedback, sitemap.
//   P7: the two expert styles + ops (readiness, metrics, backup/prune).
//   0.8.1: the two lifecycle seams — an approved map request is BUILT IN PLACE by
//       the importer (admin console shows the build queue), and an approver can
//       revert the published pointer to an earlier reviewed version.
//   P8a: the public page made usable online — the sheet served as pan/zoomable
//       inline SVG, a text alternative at /m/:slug/services, provenance and a
//       staleness notice, crawler-visible metadata, version-keyed caching.

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { counts, authCounts, getMap, nextVersion, insertVersion, setCurrentVersion, setMapOutputs, quotaUsage, getCustomer, purgeExpiredSessions, updateCustomerAdmin, getOpenRequestForMap, listPublicMaps, setCustomerBranding, publicCounts, deleteSession, purgeExpiredPersonalData, peekMagicLink } from './db/index.js';
import { saveStatusSnapshot } from './status-snapshot.js';
import { sanitizeBranding, brandingForPublic, ACCENTS } from './branding/index.js';
import { publicMaps, orgPageUrl } from './public/index.js';
import { escapeHtml } from './html.js';   // the ONE server-side HTML escaper (OA-232 Tier 2.1)
import { poiGlyphs, readOverrides, preview, renderVersion, outputsForClient } from './maps/engine.js';
import { mapDataDir } from './maps/store.js';
import { diagramAvailable, readPins, writePins, clearPins, previewDiagram, dropSandbox, pinNotes } from './expert/index.js';
import { readiness, metricsText } from './ops/index.js';
import { requestMagicLink, verifyMagicLink, resolveUser, logout, sessionCookie, clearCookie, stepUpFresh, STEP_UP_MINUTES, COOKIE_NAME, CSRF_COOKIE, newCsrfToken, csrfCookie, csrfOk, sameSiteRequest, parseCookies } from './auth/index.js';
import { logAudit } from './audit/index.js';
import { PILOT, listenOn, noListen, statusToken } from './config.js'; // PILOT: remove PILOT with docs/PILOT.md. INDEXING and ENVIRONMENT moved with the public front to src/routes/public.js
import { loggableUrl } from './public/logRedaction.js';
import { APP_VERSION, GIT_SHA, BUILT_AT } from './version.js';
import { errorEnvelope, notFoundEnvelope, wantsJson } from './http/errors.js';
import { str, isEmail, isHttps, parseOutputs, parseJson, authLink, requireUser, requireAdmin, tokenMatches, bearerToken, opsAuthorised, rateLimited } from './http/helpers.js';
import { withMapLock, downloadsForVersion } from './maps/detail.js';
import adminRoutes from './routes/admin.js';
import reviewRoutes from './routes/review.js';
import proposedRoutes from './routes/proposed.js';
import editorRoutes from './routes/editor.js';
import pageRoutes from './routes/pages.js';
import publicRoutes from './routes/public.js';
// The repository, public-asset and view roots (OA-231): a route file may not
// reach into server.js, so they live in a module with no side effects.
import { PUBLIC_DIR } from './paths.js';
import { sendMagicLink } from './email/index.js';
import { signInSendable } from './email/health.js';
import { notFoundPage } from './public/notFound.js';

const { port: PORT, host: HOST } = listenOn();
const VERSION = APP_VERSION; // GO-LIVE.md §5: package.json is the one source of truth

// trustProxy: behind Caddy (or any reverse proxy) req.protocol and req.ip are
// otherwise the proxy's, not the client's — breaking authLink()'s https URLs
// (GO-LIVE.md §2.4) and letting every visitor share one rate-limit bucket.
//
// `1`, not `true`: `true` trusts the WHOLE X-Forwarded-For chain and takes the
// leftmost entry, which is the value the client sent. Caddy appends the real
// peer address rather than replacing the header, so under `true` anyone could
// pick their own req.ip with a header and rotate it to defeat every rate limit
// below (technical-audit_2026-08-19 S3). `1` trusts exactly one hop — the
// local Caddy — so req.ip is the address Caddy actually saw.
const app = Fastify({
  // P9 B8 — search queries are never logged, and an access log counts as a
  // log: the default request serializer logs req.url including its query
  // string, so strip `q` off the search routes before it ever reaches the log.
  // Every other route's request line is unchanged.
  //
  // `/maps` JOINED THAT LIST on 2026-08-25. The search form has always been a
  // real GET to /maps, but until then nothing on the server read `q`, so the
  // only way to reach it was with JavaScript off. Server-rendering the results
  // (technical-audit_2026-08-25 N1) makes /maps?q=<a place someone is looking
  // for> a first-class URL, and the B8 rule has to follow the feature rather
  // than the route it first appeared on.
  //
  // /auth/verify JOINED THAT LIST on 2026-08-31, and it is the more serious of
  // the two. `?token=` there is a magic link: a live credential that opens a
  // session, single-use with a 15-minute TTL — and a CROSS-SITE arrival only
  // peeks at it and shows a confirmation page, so the token in the log line can
  // still be spendable when somebody reads it. It is the one credential on this
  // site that cannot be moved into a header, because it arrives as a link in an
  // email; the two OPS tokens that used to accept `?token=` were deleted outright
  // in the 2026-08-25 audit (N7) precisely because they could be. This one is
  // stripped instead. It was found on 2026-08-31 while doing the Caddy half
  // below, which is the argument for doing both halves of a leak in one go.
  //
  // WHAT THIS DOES NOT COVER, said plainly rather than left to be discovered:
  // Caddy keeps its own access log and records the full URI, which this
  // serialiser cannot touch. That is now closed at the other end — the Caddyfile
  // redacts `q` and `token` by name in a `format filter` block, deployed by
  // `npm run deploy:caddy` and by nothing else. THE TWO LISTS ARE SEPARATE AND
  // MUST BE KEPT TOGETHER: this one is by ROUTE PREFIX because Fastify sees the
  // route, Caddy's is by PARAMETER NAME because a proxy does not. Adding a
  // sensitive parameter to a new route means editing both. The route list and
  // the stripping are src/public/logRedaction.js, so a test can drive what a log
  // line actually says rather than read the code back.
  logger: {
    serializers: {
      req(req) {
        return { method: req.method, url: loggableUrl(req.url), host: req.host, remoteAddress: req.ip, remotePort: req.socket ? req.socket.remotePort : undefined };
      },
    },
  },
  bodyLimit: 256 * 1024,
  trustProxy: 1,
});

// THE ROUTE TABLE, recorded as it is built (OA-231, 2026-09-02). scripts/test-admin-plugin.mjs
// asserts it against scripts/route-table.json, the table this file registered on the
// day before the admin console moved into src/routes/admin.js -- so a route that moves
// between files is invisible to the check and a route that is gained or lost is not.
// onRoute has to be added before the first route, and the app is built on import, so
// the observer lives here rather than in the test.
export const ROUTE_TABLE = [];
app.addHook('onRoute', (r) => { for (const m of [].concat(r.method)) ROUTE_TABLE.push(`${m} ${r.url}`); });

/* ONE SHAPE FOR AN UNEXPECTED FAILURE, AND ONE FOR A PATH THAT IS NOT ROUTED
 * (OA-224 Tier 5, portal-src F4).
 *
 * 24 `try` blocks and 11 explicit `.code(500)` cover the failures this code
 * knows about, and every one of them answers `{ok:false,error}` — the envelope
 * the client reads in 128 places. Anything ELSE fell through to Fastify's
 * default, which is `{statusCode,error,message}`: a different shape, carrying a
 * different key, for exactly the cases nobody anticipated. A client that reads
 * `error` got Fastify's short name ("Internal Server Error") where it expected a
 * sentence, and `ok` was absent, so `if (!r.ok)` — the standard test in this
 * app's JavaScript — read undefined and took the success branch.
 *
 * The handlers are HTML-aware, because this server answers two audiences: an
 * `/api/` caller gets the envelope, a browser navigating to a dead URL gets the
 * same not-found page the public map routes already serve.
 *
 * THE 404 BODY IS LOAD-BEARING AND THAT IS WHY IT CARRIES A CODE.
 * `scripts/check-live-routes.mjs` asks a deployed site whether every route in
 * the snapshot still answers, and it has to tell a ROUTER 404 (the route is
 * gone) from a HANDLER 404 (the route is there and the thing behind it is not,
 * which is what /m/:slug must do for an unpublished slug). It used to do that by
 * matching Fastify's default message string — a discriminator nobody had
 * declared and anybody could have broken by adding the handler below. It now
 * keys on `code: 'route_not_found'`, which is stated here, asserted by
 * scripts/test-error-envelope.mjs, and cannot be changed silently — and the body
 * ALSO repeats Fastify's old message, so that checker and this handler can land
 * in either order without a day of false alarms. */
app.setNotFoundHandler((req, reply) => {
  if (wantsJson(req)) return reply.code(404).send(notFoundEnvelope(req.method, req.url));
  return reply.code(404).type('text/html').send(notFoundPage('page'));
});

app.setErrorHandler((err, req, reply) => {
  const { status, body } = errorEnvelope(err);
  // A 5xx is ours and is logged with the stack; a 4xx Fastify raised is the
  // caller's and is not an incident.
  if (status >= 500) req.log.error({ err }, 'unhandled error');
  else req.log.warn({ err: err.message }, 'request refused');
  if (wantsJson(req)) return reply.code(status).send(body);
  return reply.code(status).type('text/html').send(notFoundPage('page'));
});

await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });

// Resolve the signed-in user (from the session cookie) for app/api/auth routes.
//
// `reply` is taken as well as `req` because the seven-day session window SLIDES
// (technical-audit_2026-08-19 S5): resolveUser may push the row's expiry
// forward, and when it does the browser needs a cookie with the matching
// Max-Age, or the credential dies seven days after sign-in no matter how active
// the session was. Re-sent only on the requests that actually slid — about one
// an hour — so this is not a Set-Cookie on every response.
app.addHook('preHandler', async (req, reply) => {
  req.user = null;
  const u = req.url;
  if (u.startsWith('/api/') || u.startsWith('/app') || u.startsWith('/auth/') || u.startsWith('/metrics')) req.user = resolveUser(req);

  // A SWITCHED-OFF ACCOUNT MUST NOT HOLD A CREDENTIAL (OA-183, 2026-08-30).
  //
  // Until this hook existed, `user.status` was tested in exactly two places —
  // requestMagicLink and verifyMagicLink — and both are on the way IN. Nothing
  // looked at it on the way through: getSession joins on the token and the
  // expiry, resolveUser copies the status onto req.user, and requireUser /
  // requireAdmin / requireApprover all test the ROLE and never the status. So
  // disabling somebody stopped them obtaining a NEW sign-in link and left the
  // browser session they were already holding completely untouched — and
  // because the seven-day window SLIDES on use, a disabled person who kept
  // working never expired at all.
  //
  // WHY HERE AND NOT IN THE THREE GUARDS. The guards are an enumeration, and
  // the CSRF hook below has already argued this case for this codebase: a rule
  // applied by enumeration is right on the day it is written and silent about
  // the eighty-sixth route added next year. /api/me already reads req.user
  // directly and would have been missed. Clearing it at the single site that
  // SETS it covers every consumer that exists and every consumer that will.
  //
  // The session ROW goes too, not just this request. That is what collapses
  // "disable the user, then revoke each of their live sessions" from two steps
  // that read as one action into one: the dead credential destroys itself the
  // first time it is presented, and the admin Sessions tab stops listing a
  // phantom. PATCH /api/admin/users/:id closes the same window from the other
  // end, at the moment of disabling, so neither half waits on the other.
  if (req.user && req.user.status !== 'active') {
    const { id, email, status, sessionToken } = req.user;
    deleteSession(sessionToken);
    req.user = null;
    reply.header('Set-Cookie', clearCookie({ secure: isHttps(req) }));
    req.log.warn({ userId: id, status, url: u }, 'session refused: account is not active');
    // Everything under /api/ gets a code the UI can act on rather than a 401
    // that reads like an expired link. /api/auth/ is exempt as a PROPERTY, not
    // as a path list: those routes only ever end a credential or ask for a new
    // one, and both already refuse a non-active user on their own terms.
    if (u.startsWith('/api/') && !u.startsWith('/api/auth/')) {
      return reply.code(403).send({
        ok: false,
        code: 'account_disabled',
        error: `This account (${email}) has been switched off. Please contact whoever administers it.`,
      });
    }
    return; // an /app page still loads; its own /api/me call carries the message
  }

  if (req.user && req.user.sessionSlid) {
    reply.header('Set-Cookie', sessionCookie(req.user.sessionToken, { secure: isHttps(req) }));
  }
});

// CSRF (technical-audit_2026-08-25 N7). One hook, not a per-route decoration.
//
// THE FAILURE THIS SHAPE AVOIDS is the one this project keeps meeting: a rule
// applied by enumeration, where the list is right on the day it is written and
// the eighty-sixth route added next year is not on it. There is no allowlist of
// guarded routes here — every state-changing method is guarded, and the two
// exemptions are stated as PROPERTIES of the request rather than as paths.
//
// EXEMPTION 1: no session cookie. Cross-site request forgery is the abuse of a
// credential the browser attaches automatically. A request carrying no session
// cookie has no such credential to abuse, so the public apply and contact forms
// are unaffected and a visitor who has never signed in cannot be locked out of
// them by a cookie they do not have.
//
// EXEMPTION 2: an Authorization header. Bearer tokens are never sent
// automatically by a browser, so `push-status.mjs` and the metrics scrape are
// not forgeable this way and must not be made to carry a token they have no way
// to obtain.
//
// PLUS ONE ROUTE THAT IS GUARDED ANYWAY: POST /auth/verify, which by definition
// runs for somebody who has no session yet. That is the confirmation step of the
// sign-in flow below, and it is precisely the request that must not be
// forgeable — see the GET handler for why it exists at all.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALWAYS_CSRF = new Set(['/auth/verify']);
app.addHook('preHandler', async (req, reply) => {
  if (!MUTATING.has(req.method)) return;
  const always = ALWAYS_CSRF.has(req.url.split('?')[0]);
  if (!always) {
    if (req.headers.authorization) return;
    if (!parseCookies(req.headers.cookie)[COOKIE_NAME]) return;
  }
  if (csrfOk(req)) return;
  req.log.warn({ url: req.url, method: req.method }, 'csrf refused');
  return reply.code(403).send({
    ok: false,
    code: 'csrf',
    error: 'This request could not be verified as coming from BusMaps.uk. Reload the page and try again.',
  });
});

// Hand every visitor a CSRF cookie if they do not already have one, so the page
// they are about to use can echo it. Done in onRequest rather than per-page,
// because the page that needs it may be any of them.
app.addHook('onRequest', async (req, reply) => {
  if (parseCookies(req.headers.cookie)[CSRF_COOKIE]) return;
  if (req.url.startsWith('/renders/') || req.url.startsWith('/metrics')) return;
  reply.header('Set-Cookie', csrfCookie(newCsrfToken(), { secure: isHttps(req) }));
});

// WHICH BUILD SERVED THIS? (technical-audit_2026-08-25 N2)
//
// On every response, from every route, without JavaScript. That sentence is the
// whole point, because until 2026-08-25 the answer lived only in two places a
// machine could not reach:
//
//   - `/health`, where gitSha and builtAt were correctly gated behind
//     opsAuthorised() when S4 was closed on 2026-08-20; and
//   - VERSION_BADGE_JS further down this file, which injects a <meta> and a
//     footer line — from a SCRIPT, so only a browser ever sees them.
//
// The consequence was found the hard way: the live site sat one commit behind
// `main`, the missing commit was the one crediting NaPTAN in legal.html, and
// establishing that took a headless browser. Nothing in the estate compared the
// deployed commit with the branch. Closing S4 had removed the only external
// signal and nothing replaced it — a security fix quietly costing an operational
// control, which is how a well-run system goes blind.
//
// A HEADER, NOT A GATED FIELD, because this is not a secret. It is a build
// identifier: the repository is private, the SHA lets an attacker do nothing,
// and the same string was already on the page for anyone running JavaScript.
// What S4 was actually about was the eleven business counts, the object-store
// path and the exact sharp/libvips versions — those stay gated. Gating the build
// id alongside them was over-correction.
//
// The consumer is the daily gate board (make-bus-leaflet/assets/status.js),
// which fetches this header and reports BEHIND when it does not match
// origin/main.
const APP_BUILD = `${APP_VERSION}+${GIT_SHA}`;
app.addHook('onSend', async (req, reply) => {
  reply.header('X-App-Version', APP_BUILD);
});

// The readiness probe writes a file and rasterises an 8x8 JPEG on every call, so
// a short cache stands between it and anyone who decides to hold down F5. Ten
// seconds is far below the five-minute monitor interval, so neither the monitor
// nor the container HEALTHCHECK ever reads a cached answer in practice — this
// only bites on a burst.
let readinessCache = { at: 0, result: null };
const READINESS_TTL_MS = 10_000;
async function cachedReadiness() {
  const now = Date.now();
  if (readinessCache.result && now - readinessCache.at < READINESS_TTL_MS) return readinessCache.result;
  const result = await readiness();
  readinessCache = { at: now, result };
  return result;
}

// Liveness by default (cheap, safe to hammer). `?deep=1` runs the P7 readiness
// probe — DB, object store, engine files, rasteriser — and returns 503 if any
// dependency is unhealthy, which is what a load balancer or uptime check wants.
//
// WHAT AN ANONYMOUS CALLER GETS, AND WHY (technical-audit_2026-08-19 S4).
// Until 2026-08-20 this returned, to anybody: the git SHA, the build time, the
// exact sharp and libvips versions, the object-store path, and eleven business
// counts (applications, messages, maps, publishRequests, proposedUpdates,
// auditEvents, customers, users…). The versions are a precise CVE-targeting aid
// and the counts are a public read-out of how small the operation is. The code's
// own reasoning below already said an unauthenticated /metrics "leaks
// operational detail"; the same argument always applied here.
//
// So anonymous callers get the four fields the audit named — status, service,
// version, time — and nothing else. Everything that was there before is still
// there for a caller who passes METRICS_TOKEN or is a signed-in admin.
//
// SOMETHING EXTERNAL DEPENDS ON THIS URL, AND THE VERDICT IS DELIBERATELY NOT
// GATED. Since 2026-08-20 an Uptime Robot check polls `/health?deep=1` from
// outside every five minutes and alerts on anything that is not a 200
// (technical-audit_2026-08-19 O2). The Docker HEALTHCHECK does the same from
// inside the container. Both need exactly one thing: the STATUS CODE.
//
// That is why `?deep=1` still RUNS for an anonymous caller and still returns 503
// when a dependency is down. It is the per-check `checks{}` detail that is
// gated, not the verdict. Requiring a token to learn the verdict would have
// turned every monitor poll into a 401 the moment this shipped — paging about a
// fault that does not exist, which is the fastest known way to train an operator
// to ignore an alert. Nothing had to be reconfigured in Uptime Robot for this
// change, and nothing should have to be.
//
// If you ever DO gate the verdict, change the monitor and the Dockerfile
// HEALTHCHECK in the same commit, and prove the monitor still goes red by
// stopping the service — the same falsification the alert itself was given on
// 2026-08-20. And do not make `?deep=1` materially more expensive without
// thinking about the interval: it is ~288 readiness probes a day from
// monitoring alone.
app.get('/health', async (req, reply) => {
  const detail = opsAuthorised(req);
  const base = detail
    ? {
        status: 'ok', service: 'community-bus-maps', version: VERSION, gitSha: GIT_SHA, builtAt: BUILT_AT, pilotMode: PILOT.on,
        time: new Date().toISOString(), ...counts(), ...authCounts(), ...publicCounts(),
      }
    : { status: 'ok', service: 'community-bus-maps', version: VERSION, time: new Date().toISOString() };
  if (!req.query || !('deep' in req.query)) return base;
  const r = await cachedReadiness();
  if (!r.ok) reply.code(503);
  return { ...base, status: r.ok ? 'ok' : 'degraded', ...(detail ? { checks: r.checks } : {}) };
});

// Prometheus metrics. Off unless METRICS_TOKEN is set (an unauthenticated metrics
// endpoint leaks operational detail); an admin session is also accepted so the
// numbers can be eyeballed from a browser.
app.get('/metrics', async (req, reply) => {
  if (!opsAuthorised(req)) {
    return reply.code(404).type('text/plain').send('not found\n'); // don't advertise it
  }
  reply.type('text/plain; version=0.0.4');
  return metricsText(VERSION);
});

// Pushed by the laptop's push-status.mjs (fool-proofing plan item 3): the
// byte-identical gate (status.js) plus the engine/S6 staleness it reports
// alongside it. The server cannot compute any of this itself — it needs the
// operator's private map tree, which is deliberately never synced (see
// CLAUDE.md) — so it stores whatever was pushed most recently and the
// worklist trusts it. Same gate as /metrics: a token or an admin session, and
// an absent token 404s so the endpoint doesn't advertise itself.
app.post('/api/admin/status', async (req, reply) => {
  // Its OWN token, not METRICS_TOKEN, so opsAuthorised() is deliberately not
  // reused here: /metrics and /health?deep=1 are read-only, this one WRITES the
  // snapshot the worklist trusts. Keeping the credentials separate stops a read
  // token from quietly becoming a write token.
  //
  // Bearer header only, constant-time, since 2026-08-25 — same change and same
  // reasoning as opsAuthorised() above (N7). This one never had a caller using
  // the query form: bus-work's push-status.mjs has always sent a header.
  const viaToken = tokenMatches(bearerToken(req), statusToken());
  const viaAdmin = req.user && req.user.role === 'admin';
  if (!viaToken && !viaAdmin) return reply.code(404).send({ ok: false });

  const b = req.body || {};
  if (!Array.isArray(b.towns)) return reply.code(400).send({ ok: false, error: 'towns[] required (status.js --json output)' });
  saveStatusSnapshot({
    engine: b.engine || null,
    towns: b.towns,
    places: Array.isArray(b.places) ? b.places : [],
    portalDrift: Array.isArray(b.portalDrift) ? b.portalDrift : [],
  });
  return { ok: true };
});

// ===========================================================================
// Public shopfront (P0) and public front (P6) -- src/routes/public.js, one
// plugin with NO prefix (OA-232 Tier 3.2). Nineteen routes: the two shopfront
// POSTs, the four rendered public pages, eleven /api/public reads, the generated
// banner script, robots.txt and sitemap.xml.
//
// NO PREFIX AND NO GUARD, and those are the same fact. Every other plugin
// registered below carries one preHandler because everything under its prefix is
// refused to the same people; everything in this one is unauthenticated and
// read-only by design, and what stands in for a guard is the P6 SQL in
// src/db/index.js, which cannot reach a map that is not published, listed and
// owned by an active customer.
//
// It is registered HERE, in the position the block occupied, so the order routes
// enter the router is unchanged from before the cut.
// ===========================================================================

await app.register(publicRoutes);


// ===========================================================================
// Auth (P2) — passwordless magic links + server-side sessions
// ===========================================================================

// SIGN-IN MUST NOT LIE (technical-audit_2026-08-19 O4).
//
// This route used to tell every caller "a sign-in link has been sent" whether or
// not one had been. The dev fallback that prints the link to the console keyed
// on CONFIGURATION (`sendMagicLink` returns `{sent:false}` only when
// EMAIL_PROVIDER is unset), so a configured provider that THREW — bad key,
// outage, suspended domain — landed in the catch, logged, and the caller was
// still told to check their inbox. Nobody could sign in and nothing surfaced it.
//
// The fix has to keep two properties that pull against each other.
//
// NO ADDRESS ENUMERATION. The response must not differ between a registered and
// an unregistered address. So the refusal below is decided BEFORE the address is
// looked at, from `signInSendable()`, which reads only configuration and the
// consecutive-failure count — never this request's address. A caller who trips
// it learns that BusMaps cannot send email at the moment, which is true for
// everyone and reveals nothing about anyone.
//
// NO SILENT SUCCESS. A send that throws is counted (src/email/health.js). It
// still returns the generic message for THIS request — refusing on the first
// failure would leak that an attempt was made, i.e. that the address exists —
// but after FAILURE_THRESHOLD consecutive failures the address-independent
// refusal above starts firing, the readiness probe reports the configuration
// half, and the admin worklist carries a row about it. The window in which the
// system can be lying is one request wide, not indefinite.
//
// AND NO CONSOLE FALLBACK ON FAILURE. The link is printed only when no provider
// is configured at all. Printing a live credential into production logs because
// a send failed is worse than failing.
app.post('/api/auth/request', async (req, reply) => {
  if (rateLimited(req.ip, 10)) return reply.code(429).send({ ok: false, error: 'Too many requests — please wait a moment.' });
  const email = str((req.body || {}).email, 200).toLowerCase();
  if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'Please enter a valid email address.', fields: ['email'] });

  const sendable = signInSendable();
  if (!sendable.ok) {
    req.log.error({ reason: sendable.reason }, 'sign-in refused: email is not sendable');
    return reply.code(503).send({
      ok: false,
      error: 'We cannot send sign-in emails at the moment. Please try again shortly — this is a fault at our end, not with your address.',
      code: 'email-unavailable',
    });
  }

  const token = requestMagicLink(email);
  if (token) {
    // authLink(), not a hand-built URL: this was the third copy of the same
    // string and the one that mattered most, because it is the sign-in email
    // (technical-audit_2026-08-25 N5).
    const link = authLink(req, token);
    try {
      const r = await sendMagicLink({ to: email, link, kind: 'signin' });
      if (r.sent) {
        req.log.info({ email }, 'magic link emailed');
      } else {
        // DEV_LINKS: no email provider configured — print the link to the SERVER CONSOLE.
        // Only reachable outside production; signInSendable() refuses this
        // configuration when NODE_ENV=production.
        console.log(`\n🔗  Sign-in link for ${email}:\n    ${link}\n`);
        req.log.info({ email }, 'magic link issued (see console)');
      }
    } catch (e) {
      // Counted by sendEmail() before it rethrows, so the NEXT caller gets the
      // honest 503 above. This one still gets the generic message, deliberately.
      req.log.error({ email, err: e.message }, 'magic link email failed to send');
    }
  } else {
    req.log.info({ email }, 'magic link requested for unknown/inactive email (no-op)');
  }
  // Identical response whether or not the email is registered (no enumeration).
  return { ok: true, message: 'If that address is registered, a sign-in link has been sent.' };
});

// LOGIN-CSRF, and why this route has two halves (technical-audit_2026-08-25 N7).
//
// The attack: an attacker requests a magic link for their OWN account, then gets
// the victim's browser to follow it — an <img> tag, a redirect, anything that
// makes a top-level GET. The victim is now silently signed in as the attacker,
// and everything they do next lands in the attacker's account where the attacker
// can read it. `SameSite=Lax` does not help, because this is exactly the
// top-level GET that Lax exists to allow.
//
// The obvious fix — refuse a cross-site request — breaks the product. A link
// clicked in Gmail, Outlook.com or any other webmail arrives with
// `Sec-Fetch-Site: cross-site`, indistinguishable from the attack. Refusing it
// would mean sign-in worked from a desktop mail client and nowhere else, which
// is most users locked out to close a hole almost nobody was going to exploit.
//
// So: a request the USER started (`none`, `same-origin`, `same-site`, or a
// browser too old to say) signs in as before, one click, no change. A cross-site
// one gets a confirmation page on OUR origin naming the account, whose button
// POSTs back with the double-submit token an attacker's page cannot read. One
// extra click for webmail, and the attack needs the victim to read a page that
// says whose account it is and press a button anyway.
//
// The GET never consumes the link. peekMagicLink exists for that: burning it
// here would let anyone destroy a real user's sign-in link by making their
// browser fetch it once.
// Attribute-safe, because the token goes into a value="" — `escText` in
// inlineSvg.js is text-node-safe only, and the difference is a quote character.
// That is `escapeHtml` from ./html.js, imported at the top of this file since
// 2026-09-03; this file kept a private copy of it, and a second four-character
// `htmlAttr`, for a day after html.js landed as "the one escaper" (the
// 2026-09-03 review, portal-src F26).

const verifyPage = (token, email) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirm sign-in — BusMaps.uk</title><link rel="stylesheet" href="/css/styles.css"></head>
<body><main><section><div class="container" style="max-width:34rem">
<h2 class="mt-0">Confirm sign-in</h2>
<p>You are about to sign in to BusMaps.uk as <strong>${escapeHtml(email)}</strong>.</p>
<p class="form-note">This step appears because the link was opened from another site — normally your email. If you did not ask to sign in, close this page: nothing has happened yet, and the link stays unused.</p>
<form method="POST" action="/auth/verify" id="f">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <button class="btn btn-primary" type="submit">Sign in as ${escapeHtml(email)}</button>
</form>
<script src="/js/verify-confirm.js"></script>
</div></section></main></body></html>`;

const openSession = (req, reply, token) => {
  const res = token ? verifyMagicLink(token) : null;
  if (!res) return reply.redirect('/app/login.html?error=expired');
  reply.header('Set-Cookie', sessionCookie(res.sessionToken, { secure: isHttps(req) }));
  req.log.info({ userId: res.user.id }, 'session opened');
  return reply.redirect('/app');
};

app.get('/auth/verify', async (req, reply) => {
  const token = str((req.query || {}).token, 400);
  if (sameSiteRequest(req)) return openSession(req, reply, token);

  const link = token ? peekMagicLink(token) : null;
  if (!link) return reply.redirect('/app/login.html?error=expired');
  req.log.info({ site: req.headers['sec-fetch-site'] }, 'sign-in confirmation shown');
  return reply.type('text/html; charset=utf-8').send(verifyPage(token, link.email));
});

// The other half. Guarded by ALWAYS_CSRF in the hook above, so it cannot be
// posted from anywhere but a page that read our cookie.
app.post('/auth/verify', async (req, reply) => {
  const token = str((req.body || {}).token, 400);
  return openSession(req, reply, token);
});

app.post('/api/auth/logout', async (req, reply) => {
  logout(req);
  reply.header('Set-Cookie', clearCookie({ secure: isHttps(req) }));
  return { ok: true };
});

app.get('/api/me', async (req, reply) => {
  if (!req.user) return reply.code(401).send({ ok: false, error: 'Not signed in.' });
  const cust = req.user.customer_id ? getCustomer(req.user.customer_id) : null;
  const usage = cust ? quotaUsage(cust.id) : null;
  return {
    ok: true,
    // So a screen can say "this needs a fresh sign-in" BEFORE the user fills in
    // a form, rather than after the 403 (technical-audit_2026-08-19 S5).
    session: {
      signedInAt: req.user.sessionCreatedAt || null,
      expiresAt: req.user.sessionExpiresAt || null,
      stepUpFresh: stepUpFresh(req.user),
      stepUpMinutes: STEP_UP_MINUTES,
    },
    user: {
      id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role,
      customer: cust ? {
        id: cust.id, name: cust.name, type: cust.type,
        quotaAreas: cust.quota_areas, quotaPlaces: cust.quota_places,
        usedAreas: usage.area, usedPlaces: usage.place,
        // P6 — the organisation's public identity (and where it appears).
        slug: cust.slug || null,
        publicUrl: cust.slug ? orgPageUrl(cust.slug) : null,
        branding: parseJson(cust.branding_json),
        brandingPublic: brandingForPublic(cust),
      } : null,
    },
  };
});

// ---------------------------------------------------------------------------
// Per-customer branding (P6). A customer edits its own public identity; the
// whitelist in src/branding/index.js is the gate (unknown/invalid fields are
// dropped and reported, exactly like the safe subset for map edits). Branding
// decorates the public PAGE, never the printed sheet — see that module's header.
// ---------------------------------------------------------------------------

app.get('/api/customer/branding', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  if (user.customer_id == null) return reply.code(400).send({ ok: false, error: 'Only a customer account has public branding.' });
  const cust = getCustomer(user.customer_id);
  if (!cust) return reply.code(404).send({ ok: false, error: 'Your organisation record is missing — please contact us.' });
  return {
    ok: true,
    customer: {
      id: cust.id, name: cust.name, slug: cust.slug || null, publicUrl: cust.slug ? orgPageUrl(cust.slug) : null,
      watermarkEnabled: !!cust.watermark_enabled,
    },
    branding: parseJson(cust.branding_json),
    preview: brandingForPublic(cust),
    accents: Object.entries(ACCENTS).map(([key, a]) => ({ key, ...a })),
    publicMaps: publicMaps(listPublicMaps()).filter((m) => m.org.slug === cust.slug),
  };
});

app.patch('/api/customer/branding', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  if (user.customer_id == null) return reply.code(400).send({ ok: false, error: 'Only a customer account has public branding.' });
  const cust = getCustomer(user.customer_id);
  if (!cust) return reply.code(404).send({ ok: false, error: 'Your organisation record is missing — please contact us.' });
  const { branding, rejected } = sanitizeBranding((req.body || {}).branding);
  setCustomerBranding(cust.id, branding);
  req.log.info({ customerId: cust.id, rejected }, 'branding updated');
  logAudit(req, 'branding.update', { detail: { customerId: cust.id, branding, rejected } });
  const fresh = getCustomer(cust.id);
  return { ok: true, branding, rejected, preview: brandingForPublic(fresh) };
});

// Self-service download setting: a customer may opt their OWN maps out of the
// non-owner watermark, so anyone can download a clean copy. Deliberately a
// single whitelisted boolean — quota/plan/status stay admin-only, so this
// route must never widen to pass the raw body through to updateCustomerAdmin.
app.patch('/api/customer/settings', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  if (user.customer_id == null) return reply.code(400).send({ ok: false, error: 'Only a customer account has organisation settings.' });
  const cust = getCustomer(user.customer_id);
  if (!cust) return reply.code(404).send({ ok: false, error: 'Your organisation record is missing — please contact us.' });
  const b = req.body || {};
  if (b.watermarkEnabled == null) return reply.code(400).send({ ok: false, error: 'Nothing valid to update.' });
  updateCustomerAdmin(cust.id, { watermark_enabled: !!b.watermarkEnabled });
  req.log.info({ customerId: cust.id, watermarkEnabled: !!b.watermarkEnabled }, 'customer settings updated');
  logAudit(req, 'customer.settings.update', { detail: { customerId: cust.id, watermarkEnabled: !!b.watermarkEnabled } });
  const fresh = getCustomer(cust.id);
  return { ok: true, watermarkEnabled: !!fresh.watermark_enabled };
});


// ===========================================================================
// The signed-in app's HTML SHELLS -- src/routes/pages.js, one plugin under /app
// (OA-231). Ten pages, including the P7 diagram editor's shell, which is here
// because this plugin owns the /app subtree. The hook redirects an anonymous
// caller to the sign-in page (which declares itself the exception); the four
// ROLE checks stay in the handlers and redirect rather than refuse.
// ===========================================================================
await app.register(pageRoutes, { prefix: '/app' });

// ---------------------------------------------------------------------------
// The editor spine's API -- src/routes/editor.js, one plugin under /api/maps
// (OA-231). 14 routes: the map list, a map request, one map's detail, preview,
// the landmark list and basemap, save, publish-request and its withdrawal, the
// output toggles, the diagram request, public listing, the banner note and the
// version file server. The plugin guard is requireUser only; loadOwnedMap() and
// loadReadableMap() are the decisions that matter and they stay in the handlers,
// because they need the map. Registered below, after /api/poi-glyphs, which is
// the same audience behind the same guard but is NOT in this subtree.
// ---------------------------------------------------------------------------

/**
 * The sheet's own POI pictograms, for the landmark chooser (OA-220).
 *
 * The chooser drew a coloured circle per place and the sheet draws twelve
 * pictograms, so a reader was matching a picture against a legend they could
 * only see by opening "See the real sheet". Map-independent and cached in the
 * module, so this is a single small response shared by every map.
 *
 * Behind requireUser only because every page that asks is: there is nothing
 * here but our own artwork, and no map data of any kind.
 */
app.get('/api/poi-glyphs', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const glyphs = poiGlyphs();
  if (!glyphs) return reply.code(404).send({ ok: false, error: 'No icon set available.' });
  reply.header('cache-control', 'private, max-age=3600');
  return { ok: true, glyphs };
});

await app.register(editorRoutes, { prefix: '/api/maps' });

// ===========================================================================
// Monthly change acceptance (P5) -- src/routes/proposed.js, one plugin under the
// parametric prefix /api/maps/:id/proposed/:pid. Three routes: preview, accept,
// decline. The plugin guard is requireUser only; loadOwnedMap() is the decision
// that matters and it stays in the handlers, because it needs the map.
// ===========================================================================
await app.register(proposedRoutes, { prefix: '/api/maps/:id/proposed/:pid' });

// ===========================================================================
// Expert side (P7) — the tube-map DIAGRAM pin editor.
//
// This is the deliberate other half of the safe subset: dragging junctions changes
// LAYOUT, which is exactly what customers may not do, so every route here is
// ADMIN-only (`requireAdmin`) — the expert is us. Previews solve in a per-map
// sandbox and never touch the live map; saving writes the map's
// `diagram-layout.json` and then goes through the ordinary versioned render, so
// the result is a draft that still needs an approver's review (P4).
// ===========================================================================

// Load a map for expert work: admin-only, must have data + the diagram configured.
function loadDiagramMap(req, reply) {
  if (!requireAdmin(req, reply)) return null;
  const m = getMap(Number(req.params.id));
  if (!m) { reply.code(404).send({ ok: false, error: 'No such map.' }); return null; }
  if (!m.data_dir || !m.current_version_id) {
    reply.code(400).send({ ok: false, error: 'This map has no built data yet.' }); return null;
  }
  if (!diagramAvailable(m.id)) {
    reply.code(400).send({
      ok: false,
      error: 'This map has no "internalDiagram" configuration, so it has no diagram to tune. That is set up centrally when the map is built.',
    });
    return null;
  }
  return m;
}

app.get('/api/expert/maps/:id/diagram', async (req, reply) => {
  const map = loadDiagramMap(req, reply); if (!map) return;
  try {
    const pins = readPins(mapDataDir(map.id));
    const r = await withMapLock(map.id, () => previewDiagram(map.id, pins));
    return {
      ok: true,
      map: { id: map.id, name: map.name, kind: map.kind, subject: map.subject, currentVersion: map.cur_key, customer: map.customer_name || null },
      diagramEnabled: outputsForClient(parseOutputs(map.outputs), map.id).some((o) => o.key === 'internal_diagram' && o.enabled),
      editable: !getOpenRequestForMap(map.id),
      pins, svg: r.svg, nodes: r.nodes, frame: r.frame, notes: pinNotes(r.log),
    };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Could not solve the diagram: ' + e.message });
  }
});

app.post('/api/expert/maps/:id/diagram/preview', async (req, reply) => {
  const map = loadDiagramMap(req, reply); if (!map) return;
  const pins = sanitizePins((req.body || {}).pins);
  try {
    const r = await withMapLock(map.id, () => previewDiagram(map.id, pins));
    return { ok: true, svg: r.svg, nodes: r.nodes, frame: r.frame, notes: pinNotes(r.log) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Could not solve the diagram: ' + e.message });
  }
});

// Save the pins into the live map and render a new version with them. The diagram
// output is switched on if it was off — otherwise the tuning would exist in the
// data but appear on no sheet.
app.post('/api/expert/maps/:id/diagram/save', async (req, reply) => {
  const map = loadDiagramMap(req, reply); if (!map) return;
  const id = map.id;
  if (getOpenRequestForMap(id)) {
    return reply.code(409).send({ ok: false, error: 'This map is awaiting publication review. Withdraw the request before changing the diagram.' });
  }
  const pins = sanitizePins((req.body || {}).pins);
  const note = str((req.body || {}).note, 500);

  let outputs = parseOutputs(map.outputs);
  let enabledDiagram = false;
  if (outputs.internal_diagram !== true) {
    outputs = { ...outputs, internal_diagram: true };
    setMapOutputs(id, outputs);
    enabledDiagram = true;
  }

  const saved = readOverrides(id);
  const { major, minor } = nextVersion(id);
  const storageKey = `v${major}.${minor}`;
  const dataDir = mapDataDir(id);
  const before = readPins(dataDir);
  try {
    const r = await withMapLock(id, async () => {
      if (Object.keys(pins).length) writePins(dataDir, pins);
      else clearPins(dataDir);
      return renderVersion(id, saved, storageKey, outputs);
    });
    dropSandbox(id); // the live layout moved on; next preview starts from it
    const n = Object.keys(pins).length;
    const versionId = insertVersion({
      map_id: id, major, minor,
      note: note || `Diagram layout — ${n} pin${n === 1 ? '' : 's'} (expert)`,
      overrides: saved, storage_key: storageKey,
    });
    setCurrentVersion(id, versionId);
    req.log.info({ mapId: id, version: storageKey, pins: n, by: req.user.email }, 'diagram layout saved');
    logAudit(req, 'diagram.save', { mapId: id, versionId, detail: { version: storageKey, pins: n, pinsBefore: Object.keys(before).length, enabledDiagramOutput: enabledDiagram, note } });
    return { ok: true, version: storageKey, pins: n, enabledDiagramOutput: enabledDiagram, files: r.files, downloads: downloadsForVersion(id, storageKey) };
  } catch (e) {
    // Put the previous layout back — a failed render must not leave the live map
    // carrying pins that were never rendered.
    try { if (Object.keys(before).length) writePins(dataDir, before); else clearPins(dataDir); } catch { /* ignore */ }
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Render failed, so the diagram layout was left as it was: ' + e.message });
  }
});

/**
 * Pins arrive from a browser: keep only `{ x, y, ll }` on plausible node keys,
 * with finite page-mm coordinates inside an A4 landscape sheet. The layout file is
 * read by the engine on every later render, so it gets the same "rebuild it from a
 * whitelist" treatment as the customer safe subset.
 */
function sanitizePins(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= -max && v <= max ? Math.round(v * 100) / 100 : null);
  for (const [key, p] of Object.entries(src).slice(0, 500)) {
    if (typeof key !== 'string' || !key || key.length > 200) continue;
    if (!p || typeof p !== 'object') continue;
    const x = num(p.x, 1000), y = num(p.y, 1000);
    if (x == null || y == null) continue;
    const pin = { x, y };
    if (Array.isArray(p.ll) && p.ll.length === 2) {
      const lat = num(p.ll[0], 90), lon = num(p.ll[1], 180);
      if (lat != null && lon != null) pin.ll = [p.ll[0], p.ll[1]];
    }
    out[key] = pin;
  }
  return out;
}

// ===========================================================================
// Review & publish gate (P4) -- src/routes/review.js, one plugin under
// /api/review with ONE approver guard (OA-231). Eight routes: the queue, one
// version, its services, approve, reject, the published list, a map history and
// a revert.
// ===========================================================================
await app.register(reviewRoutes, { prefix: '/api/review' });

// ===========================================================================
// Admin console (P3) -- src/routes/admin.js, one plugin under /api/admin with one
// guard (OA-231). POST /api/admin/status above is deliberately not in it.
// ===========================================================================
await app.register(adminRoutes, { prefix: '/api/admin' });

// Exported so scripts/test-audit-p1.mjs can drive real requests through
// `app.inject()` instead of asserting about the source. It still listens below
// exactly as before — this is an entry point that also happens to be importable,
// not a refactor of how it starts.
export { app };

// CBM_NO_LISTEN=1 builds the app without binding a socket, for
// scripts/test-audit-p1.mjs, which drives real requests through `app.inject()`.
// Set only by that harness: production and dev both leave it unset and listen
// exactly as before. It exists so the test suite cannot fail in CI over a port
// that happened to be busy -- a test that is flaky for a reason unrelated to
// what it asserts is a test people learn to re-run rather than read.
if (noListen()) {
  await app.ready();
  app.log.info(`BusMaps.uk portal (${VERSION}) built, not listening (CBM_NO_LISTEN=1)`);
} else {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`BusMaps.uk portal (${VERSION}) → http://${HOST}:${PORT}`);
    setInterval(() => { try { purgeExpiredSessions(); } catch {} }, 3_600_000).unref();
    // Retention for personal data (technical-audit_2026-08-25 N8). Daily, beside
    // the hourly session prune rather than in a separate cron, for the reason
    // the backup dead-man switch taught: a job that lives somewhere else is a
    // job that can stop without anything noticing. It LOGS what it deleted even
    // when that is nothing, so the log can answer "is retention running?" —
    // which is the question an erasure request actually asks first.
    const purgePersonalData = () => {
      try {
        const n = purgeExpiredPersonalData();
        if (n.applications || n.messages) app.log.info(n, 'retention purge');
        else app.log.debug(n, 'retention purge (nothing due)');
      } catch (e) { app.log.error({ err: e }, 'retention purge failed'); }
    };
    purgePersonalData();
    setInterval(purgePersonalData, 86_400_000).unref();
    setInterval(() => { try { sweepHits(); } catch {} }, 300_000).unref();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
