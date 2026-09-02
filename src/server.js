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
import path from 'node:path';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { insertApplication, insertMessage, counts, authCounts, listMaps, getMap, getMapBySlug, insertMap, nextVersion, insertVersion, setCurrentVersion, dataChangesSince, setMapOutputs, setMapStatus, quotaUsage, getCustomer, purgeExpiredSessions, listPublishedMaps, updateCustomerAdmin, getVersionById, setVersionState, setPublishedVersion, insertPublishRequest, getOpenRequestForMap, getPublishRequest, listPendingPublishRequests, decidePublishRequest, withdrawPublishRequest, nextMajorVersion, decideProposedUpdate, listPublicMaps, getPublicMapBySlug, listPublicOrgs, getCustomerBySlug, setCustomerBranding, setMapPublicListed, publicCounts, setMapBannerNote, clearMapBannerNote, getVersion, deleteSession, purgeExpiredPersonalData, peekMagicLink } from './db/index.js';
import { saveStatusSnapshot } from './status-snapshot.js';
import { sanitizeBranding, brandingForPublic, ACCENTS } from './branding/index.js';
import { publicMap, publicMaps, publicOrg, publicOutputs, mapPageUrl, orgPageUrl, webPreviewPath, PUBLIC_BASES } from './public/index.js';
import { factsForPublicMap, publicServices, servicesPageUrl } from './public/services.js';
import { setInner, setAttr, setClass, removeBooleanAttr } from './public/shell.js';
// The two public pages' markup, shared with the browser rather than written
// twice (technical-audit_2026-08-25 N1). These live under public/ because they
// are ALSO served to browsers as static assets; importing them from here is what
// keeps the server's HTML and the client's HTML the same HTML.
import { grid } from '../public/js/shared/map-card.mjs';
import { servicesView } from '../public/js/shared/services-view.mjs';
import { readFactsSnapshot, buildFacts } from './maps/facts.js';
import { inlineSvg } from './public/inlineSvg.js';
import { readRoutesMeta, readRoutesMetaFromDir, enumerateCandidatesFromDir, editablePoiKeysFromDir, packPoiTiers, poiGlyphs, readOverrides, preview, previewFrom, renderVersion, outputsForClient, chooseOutputs, swapInProposedData, carryExpertTuning, outputsNeedingRender } from './maps/engine.js';
import { sanitizeOverrides } from './maps/safeSubset.js';
import { mergeGenWarnings } from './render/genWarnings.js';
import { versionDir, mapDataDir, proposedDataDir, readBuildWarnings, OUTPUT_FILES, OUTPUTS } from './maps/store.js';
import { ensureWatermarked } from './render/watermark.js';
import { ensureDraftMarked, draftLabel } from './render/draftStamp.js';
import { diagramAvailable, readPins, writePins, clearPins, previewDiagram, dropSandbox, pinNotes } from './expert/index.js';
import { readiness, metricsText } from './ops/index.js';
import { requestMagicLink, verifyMagicLink, resolveUser, logout, sessionCookie, clearCookie, stepUpFresh, STEP_UP_MINUTES, COOKIE_NAME, CSRF_COOKIE, newCsrfToken, csrfCookie, csrfOk, sameSiteRequest, parseCookies } from './auth/index.js';
import { CHECKLIST, CHECKLIST_VERSION, validateChecklist, changeSummary, chooseRevertTarget } from './publish/index.js';
import { logAudit } from './audit/index.js';
import { writePlacesSidecar } from './search/place-index.js';
import { searchPlaces, bumpSearchIndex } from './search/index.js';
import { PILOT, INDEXING, ENVIRONMENT } from './config.js'; // PILOT: remove PILOT with docs/PILOT.md; INDEXING and ENVIRONMENT stay
import { robotsTxt } from './public/robots.js';
import { STATIC_PAGES } from './public/staticPages.js';
import { loggableUrl } from './public/logRedaction.js';
import { APP_VERSION, GIT_SHA, BUILT_AT } from './version.js';
import { ORG_TYPES, MSG_KINDS, MAP_KINDS, str, isEmail, isHttps, parseOutputs, slugify, parseJson, baseUrl, authLink, requireUser, requireAdmin, requireApprover, stepUpDeadline, requireStepUp, tokenMatches, bearerToken, opsAuthorised, operatorRead } from './http/helpers.js';
import { withMapLock, loadOwnedMap, loadReadableMap, savedPoiTiers, safeSubsetAllow, downloadsForVersion, visibleDownloadsForVersion, loadPendingProposed, refreshNote, mapDetail, publishedHistoryFor } from './maps/detail.js';
import adminRoutes from './routes/admin.js';
import reviewRoutes from './routes/review.js';
import { sendMagicLink } from './email/index.js';
import { signInSendable } from './email/health.js';
import { notify, appUrl } from './email/notify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, '..');
const PUBLIC_DIR = path.resolve(HERE, '../public');
// The signed-in app's HTML shells. OUTSIDE public/ on purpose
// (technical-audit_2026-08-19 S7): @fastify/static serves the whole of
// PUBLIC_DIR, so while these lived at public/app/*.html the guarded route
// `/app/admin` correctly 302'd an anonymous visitor to the login page and
// `/app/admin.html` handed the same file to anybody who asked. No data leaked —
// every API behind those shells returns 401, checked at the time across
// /api/maps, /api/me, /api/admin/* and /api/review/pending — but a role check on
// the pretty URL that reads like an access control and is not one is exactly the
// thing a reviewer tests. Now the only way to a shell is through its route.
//
// The app's .js and .css stay under public/app/ and stay public: the browser has
// to be able to fetch them, they are the same code every signed-in user runs,
// and nothing in them is a secret. It is the shells that carried the false
// promise, not the assets.
const VIEWS_DIR = path.resolve(HERE, '../views');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
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

// --- tiny in-memory per-IP rate limit for public POSTs ---
const hits = new Map();
// Nothing evicted from this map until 2026-08-19, so it grew one entry per
// distinct client address for the life of the process — slow memory exhaustion
// (technical-audit_2026-08-19 S3). Two bounds now, belt and braces: a periodic
// sweep of entries whose window has closed, and a hard cap that clears the lot
// the way inlineCache already does. Clearing wholesale only forgives in-flight
// counts, so the failure mode is a moment's extra leniency, never a lockout.
const HITS_MAX = 20_000;
function sweepHits(windowMs = 60_000) {
  const now = Date.now();
  if (hits.size > HITS_MAX) { hits.clear(); return; }
  for (const [ip, rec] of hits) if (now - rec.t > windowMs) hits.delete(ip);
}
function rateLimited(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  hits.set(ip, rec);
  if (hits.size > HITS_MAX) sweepHits(windowMs);
  return rec.n > max;
}

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
  const viaToken = tokenMatches(bearerToken(req), process.env.STATUS_TOKEN);
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
// Public shopfront (P0)
// ===========================================================================

app.post('/api/apply', async (req, reply) => {
  if (rateLimited(req.ip)) return reply.code(429).send({ ok: false, error: 'Too many requests — please try again shortly.' });
  const b = req.body || {};
  if (str(b.website_hp)) return { ok: true, id: 0 }; // honeypot

  const org_name = str(b.org_name, 200);
  const org_type = ORG_TYPES.includes(b.org_type) ? b.org_type : '';
  const contact_name = str(b.contact_name, 120);
  const email = str(b.email, 200);

  const fields = [];
  if (!org_name) fields.push('org_name');
  if (!org_type) fields.push('org_type');
  if (!contact_name) fields.push('contact_name');
  if (!isEmail(email)) fields.push('email');
  if (fields.length) return reply.code(400).send({ ok: false, error: 'Please check the highlighted fields.', fields });

  const id = insertApplication({
    org_name, org_type, contact_name, email,
    phone: str(b.phone, 60), website: str(b.website, 200),
    wants: str(b.wants, 2000), message: str(b.message, 4000),
  });
  req.log.info({ applicationId: id, org_name, org_type }, 'new application');
  return { ok: true, id };
});

app.post('/api/contact', async (req, reply) => {
  if (rateLimited(req.ip)) return reply.code(429).send({ ok: false, error: 'Too many requests — please try again shortly.' });
  const b = req.body || {};
  if (str(b.website_hp)) return { ok: true, id: 0 };

  const body = str(b.body, 4000);
  const kind = MSG_KINDS.includes(b.kind) ? b.kind : 'enquiry';
  const email = str(b.email, 200);
  if (!body) return reply.code(400).send({ ok: false, error: 'Please enter a message.', fields: ['body'] });
  if (email && !isEmail(email)) return reply.code(400).send({ ok: false, error: 'That email address looks wrong.', fields: ['email'] });

  const id = insertMessage({ kind, name: str(b.name, 120), email, body });
  req.log.info({ messageId: id, kind }, 'new message');
  return { ok: true, id };
});

// ===========================================================================
// Public front (P6) — the marketing site's live half.
//
// Everything below is UNAUTHENTICATED and read-only, and it can only ever reach
// a map that (a) has a published version, (b) belongs to an active customer and
// (c) the customer has left listed — enforced in the SQL (src/db/index.js), not
// here. The files served are the very bytes an approver reviewed, because
// publishing never re-renders (P4).
// ===========================================================================

// BASE_URL / baseUrl() used to be declared here, beside their first public-page
// caller. They moved to the top of this file on 2026-08-25 so that the AUTH
// links could go through them too — see the note there
// (technical-audit_2026-08-25 N5).

// Pretty public URLs. The HTML is a static shell; it fetches the JSON below.
// Unknown/unpublished slugs 404 with the same shell (so a link that stops being
// public does not silently render an empty page or leak that a draft exists).
// THE PUBLISHED-MAPS CATALOGUE, RENDERED HERE (technical-audit_2026-08-25 N1).
//
// This route was `reply.sendFile('maps.html')` until 2026-08-25 and the grid was
// filled entirely by public/js/public-maps.js. So the page a crawler received
// carried the words "Loading published maps…" and NO link to any map — 4,479
// bytes of chrome — while /maps sat in sitemap.xml and indexing had just been
// switched on. Worse, the data it needed came from /api/public/maps, and
// robots.txt said `Disallow: /api/`: the site was telling compliant crawlers not
// to fetch its own catalogue.
//
// ?q= IS SERVER-SIDE TOO, and that is not a bonus. public-maps.js's own header
// has claimed since P9 that "the form is a real GET to /maps and works with JS
// off". It did not, because nothing on the server had ever read `q`. It does
// now, so the claim is true for the first time. The client still intercepts the
// submit to avoid a page reload, which is what an enhancement is.
//
// The markup comes from public/js/shared/map-card.mjs, imported by this file AND
// by the browser, so there is exactly one copy of it. See that file's header for
// why sharing beat writing it twice.
app.get('/maps', async (req, reply) => {
  const q = str((req.query || {}).q, 100);
  let maps = publicMaps(listPublicMaps());
  let reasons = null;
  if (q.length >= 2) {
    const { results } = searchPlaces(q);
    reasons = new Map(results.map((r) => [r.map.slug, r.reason]));
    maps = results.map((r) => r.map);
  }
  const { className, html } = grid(maps, { reasons, query: q.length >= 2 ? q : '' });
  let page = setInner(shell('maps.html'), 'grid', html);
  page = setClass(page, 'grid', className);
  // Read the query back into the box, so a /maps?q=… link says what it searched
  // for with or without JavaScript.
  if (q) page = setAttr(page, 'q', 'value', q);
  reply.type('text/html; charset=utf-8');
  return reply.send(page);
});

// P8a — the per-map pages complete their <head> SERVER-side: real title,
// description, canonical and Open Graph tags, and a JSON-LD block, because a
// crawler, a link preview and a screen reader all read the HTML as delivered.
//
// Since 2026-08-25 the /services page completes its BODY here as well (N1). The
// <head> had been doing the right thing for weeks while the body still said
// "Loading…", which is the more visible half of the same argument.
const shellCache = new Map();
function shell(name) {
  if (!shellCache.has(name)) shellCache.set(name, readFileSync(path.join(PUBLIC_DIR, name), 'utf8'));
  return shellCache.get(name);
}
const htmlAttr = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sendShell(reply, name, head, fillBody = null) {
  // Drop the shell's own placeholder <title>/description/og tags first, so the
  // page has exactly one of each and the browser does not just take whichever
  // came first in the file.
  let page = shell(name)
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\r?\n?/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>\r?\n?/i, '')
    .replace(/[ \t]*<meta\s+property="og:(?:title|description|url|image)"[^>]*>\r?\n?/gi, '');
  page = page.replace('</head>', `${head}\n</head>`);
  // `fillBody` is where the /services page puts its content (N1). Optional
  // because /m/:slug still fills its own body in the browser — that page's
  // content is the SVG sheet itself, which is a 472 KB fetch that would be the
  // wrong thing to inline into every HTML response.
  if (fillBody) page = fillBody(page);
  reply.type('text/html; charset=utf-8');
  return reply.send(page);
}

/** The <head> completion for one public map page. */
function mapHead(req, m, { services = false } = {}) {
  const base = baseUrl(req);
  const headline = m.kind === 'place' ? `Buses serving ${m.name}` : `Buses within ${m.name}`;
  const title = services
    ? (m.kind === 'place' ? `Bus services serving ${m.name}` : `Bus services in ${m.name}`)
    : headline;
  const desc = services
    ? `Every bus service on the ${m.name} map, written out as text: route, operator, days and the places served. An accessible alternative to the map image.`
    : m.org.isDemo
      ? `A sample bus map${m.subject ? ' for ' + m.subject : ''}, made to demonstrate BusMaps.uk.`
      : `A bus map published by ${m.org.name}${m.subject ? ' for ' + m.subject : ''}, free to view, print and share.`;
  const canonical = base + (services ? servicesPageUrl(m.slug) : mapPageUrl(m.slug));
  const card = m.outputs.length && m.outputs[0].previewUrl ? base + m.outputs[0].previewUrl : '';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Map',
    name: `${title} — BusMaps.uk`,
    description: desc,
    url: canonical,
    ...(m.org.name ? { publisher: { '@type': 'Organization', name: m.org.name } } : {}),
    ...(m.provenance && m.provenance.dataAsAtDate ? { datePublished: m.provenance.dataAsAtDate } : {}),
    isAccessibleForFree: true,
  };
  return [
    `<title>${htmlAttr(title)} — BusMaps.uk</title>`,
    `<link rel="canonical" href="${htmlAttr(canonical)}">`,
    `<meta name="description" content="${htmlAttr(desc)}">`,
    `<meta property="og:title" content="${htmlAttr(title)}">`,
    `<meta property="og:description" content="${htmlAttr(desc)}">`,
    `<meta property="og:url" content="${htmlAttr(canonical)}">`,
    card ? `<meta property="og:image" content="${htmlAttr(card)}">` : '',
    `<meta name="twitter:card" content="${card ? 'summary_large_image' : 'summary'}">`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).map((l) => '  ' + l).join('\n');
}

app.get('/m/:slug', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).type('text/html').send(notFoundPage('map'));
  return sendShell(reply, 'map.html', mapHead(req, publicMap(row)));
});

// The sheet's TEXT ALTERNATIVE. A picture of a bus map has no `alt` that could
// carry it, so the same facts are published as ordinary HTML: route, operator,
// days, termini, the stops inside the area and where each service goes. 404s
// (rather than showing an empty page) when the payload lists no services.
//
// FULLY RENDERED HERE since 2026-08-25 (technical-audit_2026-08-25 N1). It was a
// shell whose body was the word "Loading…" until then — 4,716 bytes — which
// meant this page, the one the accessibility statement points at, the one a
// public body relies on to meet its own WCAG 2.2 AA duty, and nineteen of whose
// URLs are in sitemap.xml, delivered nothing at all to a reader not executing
// JavaScript. The facts come from exactly the two calls the JSON API makes, so
// the page and the API can never disagree, and the markup comes from the module
// the browser imports.
app.get('/m/:slug/services', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).type('text/html').send(notFoundPage('map'));
  const m = publicMap(row);
  if (!m.servicesUrl) return reply.code(404).type('text/html').send(notFoundPage('services list'));
  const services = publicServices(row, factsForPublicMap(row));
  // The same condition the API applies: a map with no service list has no text
  // alternative to show, and an empty page is worse than an honest 404.
  if (!services || !services.routes.length) {
    return reply.code(404).type('text/html').send(notFoundPage('services list'));
  }
  const v = servicesView(m, services);
  return sendShell(reply, 'services.html', mapHead(req, m, { services: true }), (page) => {
    let p = setInner(page, 'headline', v.headline);
    p = setInner(p, 'intro', v.intro);
    p = setInner(p, 'pills', v.pills);
    p = setInner(p, 'services', v.services);
    if (v.stale) {
      p = setInner(p, 'staleNote', v.stale);
      p = setClass(p, 'staleNote', 'notice notice-warn');
      p = removeBooleanAttr(p, 'staleNote', 'hidden');
    }
    p = setAttr(p, 'mapLink', 'href', v.mapUrl);
    p = setAttr(p, 'backToMap', 'href', v.mapUrl);
    return p;
  });
});
// An organisation only has a public page while it has a publicly-visible map —
// the same condition the API applies, so the page and its data never disagree.
app.get('/o/:slug', async (req, reply) => {
  const slug = str(req.params.slug, 120);
  const c = getCustomerBySlug(slug);
  if (!c || c.status !== 'active' || !listPublicOrgs().some((o) => o.slug === slug)) {
    return reply.code(404).type('text/html').send(notFoundPage('organisation'));
  }
  return reply.sendFile('org.html');
});

app.get('/api/public/maps', async () => ({ ok: true, maps: publicMaps(listPublicMaps()) }));

// P9 Part B — "does any map cover my village?" See src/search/index.js.
// Deliberately no per-query logging (B8): nothing here writes q anywhere but
// the response. Fastify's own request log line is left as-is; it never
// includes the query string for GET requests on this route.
app.get('/api/public/search', async (req) => {
  const q = str((req.query || {}).q, 100);
  const { results, corrected } = searchPlaces(q);
  return { ok: true, results, corrected };
});

app.get('/api/public/maps/:slug', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).send({ ok: false, error: 'No published map with that name.' });
  return { ok: true, map: publicMap(row) };
});

// P8a — caching for published artefacts. A published version is immutable: its
// bytes never change, because publishing never re-renders and a new version gets
// a new storage key. So anything asked for WITH the version (`?v=<pub_key>`, how
// the page itself links) can be cached hard and for ever; a bare URL follows the
// published pointer and so may change under a reader, and gets a short life plus
// an ETag. This is what keeps repeat views — and, later, embeds — off the app.
function cached(req, reply, pubKey, tag) {
  const etag = `"${pubKey}-${tag}"`;
  reply.header('ETag', etag);
  const versioned = req.query && String(req.query.v || '') === String(pubKey);
  reply.header('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300, stale-while-revalidate=86400');
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    reply.code(304).send();
    return true;
  }
  return false;
}

// The published artefacts, straight from the reviewed version's render folder.
// The version key comes from the DB (never the URL), so there is no version to
// probe and no path to traverse.
app.get('/api/public/maps/:slug/:file', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).send({ ok: false, error: 'No published map with that name.' });
  const { file } = req.params;
  if (!Object.prototype.hasOwnProperty.call(OUTPUT_FILES, file)) {
    return reply.code(400).send({ ok: false, error: 'Bad file.' });
  }
  let p = path.join(versionDir(row.id, row.pub_key), file);
  if (!existsSync(p)) return reply.code(404).send({ ok: false, error: 'Not found.' });

  // Watermark JPGs for anyone who isn't the owning customer or an admin — this
  // is the one fully public, unauthenticated download route, so it's the path a
  // forwarded/shared copy would have come through. req.user is already resolved
  // for every /api/ request (see the preHandler above) from the session cookie,
  // so an anonymous visitor and a signed-in stranger are both treated as
  // "not the owner". The owning customer's own downloads, and any admin
  // download (from either route), are never watermarked.
  const isOwnerOrAdmin = !!req.user && (req.user.role === 'admin' || req.user.customer_id === row.customer_id);
  const watermarkable = file.endsWith('.jpg') && !!row.watermark_enabled;
  const watermarked = !isOwnerOrAdmin && watermarkable;
  if (watermarked) {
    try {
      const wp = await ensureWatermarked(p);
      if (wp) p = wp;
    } catch (e) {
      req.log.error(e, 'watermark generation failed; serving the original file');
    }
  }

  reply.header('Content-Type', OUTPUT_FILES[file]);
  // The watermarked/unwatermarked choice depends on who's asking (session
  // cookie), so a shared cache must not reuse one visitor's response for
  // another. P8a's strong immutable caching (cached()) is safe only when the
  // response can't vary by viewer — i.e. everything except a JPG this map
  // might watermark; those keep the original short, private cache instead.
  if (watermarkable) {
    reply.header('Cache-Control', 'private, max-age=60');
  } else if (cached(req, reply, row.pub_key, file)) {
    return reply;
  }
  if (req.query && 'download' in req.query) {
    reply.header('Content-Disposition', `attachment; filename="${row.slug}-${row.pub_key}-${file}"`);
  }
  return reply.send(createReadStream(p));
});

// A screen-sized copy of a published print JPG, derived on first request and
// cached beside it (see src/public/index.js) — the print bytes stay untouched.
app.get('/api/public/maps/:slug/preview/:base', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).send({ ok: false, error: 'No published map with that name.' });
  const base = str(req.params.base, 40);
  if (!PUBLIC_BASES.includes(base)) return reply.code(400).send({ ok: false, error: 'Bad output.' });
  try {
    const p = await webPreviewPath(row.id, row.pub_key, base);
    if (!p) return reply.code(404).send({ ok: false, error: 'Not found.' });
    if (cached(req, reply, row.pub_key, `preview-${base}`)) return reply;
    reply.header('Content-Type', 'image/jpeg');
    return reply.send(createReadStream(p));
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Could not prepare the preview image.' });
  }
});

// P8a — the same published SVG, prepared for INLINE display (scalable, real
// text, pan/zoomable). See src/public/inlineSvg.js for exactly what differs from
// the downloadable bytes. Gzipped here because there is no compression plugin in
// front of the app and an internal sheet is ~470 KB raw against ~88 KB gzipped.
const inlineCache = new Map(); // `${id}/${pubKey}/${base}` -> { raw, gz }
app.get('/api/public/maps/:slug/inline/:base', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).send({ ok: false, error: 'No published map with that name.' });
  const base = str(req.params.base, 40);
  if (!PUBLIC_BASES.includes(base)) return reply.code(400).send({ ok: false, error: 'Bad output.' });
  const file = path.join(versionDir(row.id, row.pub_key), `${base}.svg`);
  if (!existsSync(file)) return reply.code(404).send({ ok: false, error: 'Not found.' });
  if (cached(req, reply, row.pub_key, `inline-${base}`)) return reply;

  const key = `${row.id}/${row.pub_key}/${base}`;
  let entry = inlineCache.get(key);
  if (!entry) {
    const out = publicOutputs(row).find((o) => o.base === base);
    try {
      const raw = Buffer.from(inlineSvg(file, {
        title: out ? `${row.name} — ${out.label}` : `${row.name} bus map`,
        desc: 'A bus map drawn from open bus data. Every service shown here is also '
          + `written out as text at ${servicesPageUrl(row.slug)}.`,
        // Nothing our engine draws is ever removed — the sanitiser is proved inert
        // on the whole corpus — so a drop means the vocabulary has moved and this
        // sheet is now showing LESS on the web than it does in print. Loud, not silent.
        onDrop: (what) => req.log.warn(`inline SVG sanitiser removed ${what} from ${row.slug}/${base}`),
      }), 'utf8');
      entry = { raw, gz: gzipSync(raw, { level: 9 }) };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: 'Could not prepare that sheet.' });
    }
    // One entry per published version per output — bounded by what is published,
    // and dropped wholesale rather than tracked when it grows.
    if (inlineCache.size > 64) inlineCache.clear();
    inlineCache.set(key, entry);
  }
  reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
  reply.header('Vary', 'Accept-Encoding');
  if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
    reply.header('Content-Encoding', 'gzip');
    return reply.send(entry.gz);
  }
  return reply.send(entry.raw);
});

// The facts behind /m/<slug>/services — the map's text alternative as data.
app.get('/api/public/maps/:slug/services', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).send({ ok: false, error: 'No published map with that name.' });
  const facts = factsForPublicMap(row);
  const services = publicServices(row, facts);
  if (!services || !services.routes.length) {
    return reply.code(404).send({ ok: false, error: 'This map has no service list.' });
  }
  if (cached(req, reply, row.pub_key, 'services')) return reply;
  return { ok: true, map: publicMap(row), services };
});

app.get('/api/public/orgs', async () => ({ ok: true, orgs: listPublicOrgs().map(publicOrg) }));

app.get('/api/public/orgs/:slug', async (req, reply) => {
  const c = getCustomerBySlug(str(req.params.slug, 120));
  if (!c || c.status !== 'active') return reply.code(404).send({ ok: false, error: 'No such organisation.' });
  const maps = publicMaps(listPublicMaps()).filter((m) => m.org.slug === c.slug);
  if (!maps.length) return reply.code(404).send({ ok: false, error: 'No such organisation.' });
  return { ok: true, org: publicOrg(c), maps };
});

// "Something looks wrong with this map" from a public map page → the existing
// message table, with the map attached so we know what it is about.
app.post('/api/public/feedback', async (req, reply) => {
  if (rateLimited(req.ip)) return reply.code(429).send({ ok: false, error: 'Too many requests — please try again shortly.' });
  const b = req.body || {};
  if (str(b.website_hp)) return { ok: true, id: 0 }; // honeypot
  const row = getPublicMapBySlug(str(b.mapSlug, 120));
  if (!row) return reply.code(404).send({ ok: false, error: 'No published map with that name.' });
  const body = str(b.body, 4000);
  const email = str(b.email, 200);
  if (!body) return reply.code(400).send({ ok: false, error: 'Please tell us what looks wrong.', fields: ['body'] });
  if (email && !isEmail(email)) return reply.code(400).send({ ok: false, error: 'That email address looks wrong.', fields: ['email'] });
  const id = insertMessage({ kind: 'feedback', name: str(b.name, 120), email, body, map_id: row.id });
  req.log.info({ messageId: id, mapId: row.id }, 'map feedback received');
  return { ok: true, id };
});

// PILOT: this part of the banner mechanism — delete this const, and the one
// <script> tag in each public/**/*.html, to remove it. See docs/PILOT.md.
// NOT pilot-gated: VERSION_BADGE_JS below, appended into the same script, must
// survive PILOT_MODE=0 — GO-LIVE.md §5 wants the build visible for the life of
// the site, not just during the pilot.
//
// There is no template engine here (every page is a hand-written static file
// with a copy-pasted header), so both the banner and the version badge are
// injected client-side from ONE generated script instead of being pasted into
// seventeen files. When the pilot ends the banner half serves nothing, so
// PILOT_MODE=0 alone is a complete off switch for it; the leftover <script>
// tags then cost one empty request each.
const PILOT_BANNER_JS = !PILOT.on ? '' : `(function () {
  var d = document;
  function mount() {
    if (d.getElementById('pilotBanner')) return;
    var b = d.createElement('div');
    b.id = 'pilotBanner';
    b.className = 'pilot-banner';
    b.setAttribute('role', 'note');
    b.innerHTML = '<div class="container pilot-banner-inner">'
      + '<span class="pilot-badge">${jsStr(PILOT.word)}</span>'
      + '<span class="pilot-text">${jsStr(PILOT.short)}.'
      // The full explanation is the point of the banner on a desktop, but it
      // eats a phone screen — small viewports get the headline and the link,
      // which lands on the same words at /faq.html#pilot.
      + ' <span class="pilot-more">${jsStr(PILOT.long)}</span></span>'
      + '<a class="pilot-link" href="${jsStr(PILOT.href)}">What this means</a>'
      + '</div>';
    d.body.insertBefore(b, d.body.firstChild);
  }
  // The public map/org pages rewrite document.title after their fetch resolves,
  // which is long after this script runs — so watch <title> and re-apply the
  // prefix whenever it changes. Setting it here re-triggers the observer, but
  // the prefix check makes that converge immediately.
  var TAG = '[${jsStr(PILOT.word)}] ';
  function markTitle() {
    if (d.title.indexOf(TAG) !== 0) d.title = TAG + d.title;
  }
  function watchTitle() {
    if (!window.MutationObserver) return;
    new MutationObserver(markTitle).observe(d.head, { childList: true, subtree: true, characterData: true });
  }
  function go() { mount(); markTitle(); watchTitle(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', go);
  else go();
})();
`;

// Local/dev instance banner — separate from the pilot banner above and NOT
// removed with it. The pilot banner says "this is a pilot"; this one says
// "this isn't even the public site", which stays true after the pilot ends.
// See SITE_BANNER_JS below for why it must be concatenated after PILOT_BANNER_JS.
const LOCAL_BANNER_JS = ENVIRONMENT.isProduction ? '' : `(function () {
  var d = document;
  function mount() {
    if (d.getElementById('localBanner')) return;
    var b = d.createElement('div');
    b.id = 'localBanner';
    b.className = 'local-banner';
    b.setAttribute('role', 'note');
    b.innerHTML = '<div class="container local-banner-inner">'
      + '<span class="local-badge">Local</span>'
      + '<span class="local-text">This is a local/dev copy, not the public BusMaps.uk site.</span>'
      + '</div>';
    d.body.insertBefore(b, d.body.firstChild);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

// GO-LIVE.md §5, surfaces 3 and 4: a muted footer line and a <meta> tag, both
// from this one generated script, so a screenshot says which build served it.
//
// "or a script run against a deployed page" used to be part of that sentence and
// was wrong: this IS a script, so only a browser ever sees either surface — and
// that is exactly how a stale deployment went unnoticed
// (technical-audit_2026-08-25 N2). The machine-readable answer is now the
// `X-App-Version` response header set by the onSend hook near the top of this
// file. These two surfaces are for humans; keep them, do not rely on them.
const VERSION_BADGE_JS = `(function () {
  var d = document;
  function go() {
    var m = d.createElement('meta');
    m.name = 'app-version';
    m.content = '${jsStr(APP_VERSION)}+${jsStr(GIT_SHA)}';
    d.head.appendChild(m);
    var footers = d.getElementsByTagName('footer');
    if (!footers.length) return;
    var footer = footers[footers.length - 1];
    // Nest inside .container so the line inherits the same padding as the rest
    // of the footer, instead of sitting flush against the page edge.
    var host = footer.querySelector('.container') || footer;
    var line = d.createElement('div');
    line.className = 'muted';
    line.style.marginTop = '4px';
    line.textContent = 'v${jsStr(APP_VERSION)} \\u00b7 ${jsStr(GIT_SHA)}';
    host.appendChild(line);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', go);
  else go();
})();
`;

// Order matters: each banner's mount() does insertBefore(..., body.firstChild),
// so whichever script runs LAST ends up visually topmost. LOCAL_BANNER_JS runs
// last so it sits above the pilot banner when both are present.
const SITE_BANNER_JS = PILOT_BANNER_JS + LOCAL_BANNER_JS + VERSION_BADGE_JS;

// Single-quoted JS string literal contents (the banner script builds HTML).
function jsStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

app.get('/js/site-banner.js', async (req, reply) => {
  reply.type('application/javascript; charset=utf-8');
  reply.header('Cache-Control', 'no-cache'); // the switch must take effect on reload
  return SITE_BANNER_JS;
});

// Search engines: only public pages, and only maps that are actually published.
// The policy is in src/public/robots.js so it can be tested against the real
// bytes without booting this server — see that file's header and
// scripts/test-indexing.mjs.
app.get('/robots.txt', async (req, reply) => {
  reply.type('text/plain');
  return robotsTxt({ indexable: INDEXING.allowed, sitemapUrl: `${baseUrl(req)}/sitemap.xml` });
});

// The list of hand-written public pages is src/public/staticPages.js, so that a
// test can join it to the footer and to each page's canonical without booting
// this server. It used to be a const here; see that file for the rule it keeps
// and the four hours it took to break the first time nothing enforced it.

app.get('/sitemap.xml', async (req, reply) => {
  const base = baseUrl(req);
  const maps = publicMaps(listPublicMaps());
  const orgs = listPublicOrgs().map(publicOrg).filter((o) => o.url);
  const url = (loc, lastmod) =>
    `  <url><loc>${xmlEscape(base + loc)}</loc>${lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : ''}</url>`;
  reply.type('application/xml');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_PAGES.map((p) => url(p)),
    ...maps.map((m) => url(mapPageUrl(m.slug), (m.publishedAt || '').replace(' ', 'T') + 'Z')),
    // P8a — the text alternative is a page in its own right, and the one most
    // worth finding in a search for "buses in <town>".
    ...maps.filter((m) => m.servicesUrl).map((m) => url(m.servicesUrl, (m.publishedAt || '').replace(' ', 'T') + 'Z')),
    ...orgs.map((o) => url(orgPageUrl(o.slug))),
    '</urlset>',
    '',
  ].join('\n');
});

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function notFoundPage(what) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — BusMaps.uk</title><link rel="stylesheet" href="/css/styles.css">
<script src="/js/site-banner.js" defer></script>
<script src="/js/nav-current.js" defer></script></head>
<body><header class="site-header"><div class="container"><nav class="nav">
<a class="brand" href="/"><span class="logo">🚌</span> BusMaps.uk</a><span class="spacer"></span>
<a class="navlink" href="/maps">Published maps</a></nav></div></header>
<main><section><div class="container">
<h2 class="mt-0">We can’t find that ${what}</h2>
<p class="section-intro">It may never have been published, or it may have been taken down. Every map published through the portal is listed on the published-maps page.</p>
<div class="lead-cta"><a class="btn btn-primary" href="/maps">Browse published maps</a>
<a class="btn btn-ghost" href="/contact.html">Ask us about it</a></div>
</div></section></main></body></html>`;
}

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
const escapeHtml = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
// Authenticated app (P1 editor spine, now tenant-scoped in P2)
// ===========================================================================

// Anonymous by design — it is the sign-in page. It needs a route only because
// it is no longer a static file; the URL is unchanged so every existing
// redirect, bookmark and `location.href` in the app keeps working.
app.get('/app/login.html', async (req, reply) => reply.sendFile('app/login.html', VIEWS_DIR));

app.get('/app', async (req, reply) => (req.user ? reply.sendFile('app/index.html', VIEWS_DIR) : reply.redirect('/app/login.html')));
app.get('/app/maps/:id', async (req, reply) => (req.user ? reply.sendFile('app/editor.html', VIEWS_DIR) : reply.redirect('/app/login.html')));
app.get('/app/maps/:id/landmarks', async (req, reply) => (req.user ? reply.sendFile('app/landmarks.html', VIEWS_DIR) : reply.redirect('/app/login.html')));
app.get('/app/branding', async (req, reply) => (req.user ? reply.sendFile('app/branding.html', VIEWS_DIR) : reply.redirect('/app/login.html')));
app.get('/app/admin', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'admin') return reply.redirect('/app');
  return reply.sendFile('app/admin.html', VIEWS_DIR);
});
app.get('/app/review', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'approver' && req.user.role !== 'admin') return reply.redirect('/app');
  return reply.sendFile('app/review.html', VIEWS_DIR);
});

// The services-and-stops list a reviewer opens in a second tab from
// /app/review. It was reachable by anyone until 2026-08-20 because it was a
// static file with no route of its own — the clearest single case of S7. Same
// guard as the review page that links to it. The `.html` stays in the URL
// because review.js links to it by that name.
app.get('/app/review-services.html', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'approver' && req.user.role !== 'admin') return reply.redirect('/app');
  return reply.sendFile('app/review-services.html', VIEWS_DIR);
});

// Admin-only view of the developer CHANGELOG.md. NOT public: entries there
// name real past security findings (e.g. the S6 self-approval bypass, the S4
// /health disclosure) in the same detail as the rest of this repo's docs, so
// publishing it verbatim would hand a visitor a list of things that used to
// be wrong. Rendered as escaped plain text, not parsed markdown — this is a
// read-only convenience for Peter, not a document worth a markdown dependency
// for. The public-facing counterpart is /changelog.html, fed by the small
// curated file at public/data/whats-new.json instead of this one.
app.get('/app/changelog', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'admin') return reply.redirect('/app');
  let body;
  try {
    body = readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf8');
  } catch {
    body = '(CHANGELOG.md not found on this instance.)';
  }
  reply.type('text/html; charset=utf-8');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Changelog (admin) — BusMaps.uk</title>
<link rel="stylesheet" href="/css/styles.css">
<link rel="stylesheet" href="/app/app.css">
<script src="/js/site-banner.js" defer></script></head>
<body><header class="site-header"><div class="container"><nav class="nav">
<a class="brand" href="/"><span class="logo">🚌</span> BusMaps.uk</a><span class="spacer"></span>
<a class="navlink" href="/app/admin">Admin</a></nav></div></header>
<main class="app-main"><div class="app-sub"><h1>Changelog (admin)</h1><span class="spacer"></span></div>
<p class="hint-line">The raw developer CHANGELOG.md, for reference only — not shown to visitors. The public "What's new" is /changelog.html, edited separately.</p>
<pre style="white-space:pre-wrap;font-size:.85rem;line-height:1.5;max-width:900px;">${xmlEscape(body)}</pre>
</main></body></html>`;
});

app.get('/api/maps', async (req, reply) => {
  // OPERATOR_TOKEN reads this at admin scope (OA-203). It is resolved BEFORE
  // requireUser so a tokened call never needs a session; with no token and no
  // session the 401 below is unchanged.
  const viaToken = operatorRead(req);
  const user = viaToken ? null : requireUser(req, reply);
  if (!viaToken && !user) return;
  const isAdmin = viaToken || user.role === 'admin';
  if (!isAdmin && user.customer_id == null) return { ok: true, isAdmin: false, maps: [] };
  const scope = isAdmin ? {} : { customerId: user.customer_id };
  return {
    ok: true, isAdmin,
    maps: listMaps(scope).map((m) => ({
      id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
      status: m.status, currentVersion: m.cur_key || null,
      publishedVersion: m.pub_key || null, pendingReview: !!m.pending_reviews,
      pendingUpdate: !!m.pending_updates,
      // P6 — set only when the map really is on the public site (same query the
      // public pages use, so a suspension or an un-listing shows through here).
      publicUrl: m.pub_key && m.public_listed && getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
      customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    })),
  };
});

// A customer requests a new map (area or place), within quota. It starts in
// 'requested'; an admin approves it (P3) and the central pipeline builds the
// data later — so no object store / render exists yet.
app.post('/api/maps/request', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  if (user.customer_id == null) return reply.code(400).send({ ok: false, error: 'Only a customer account can request maps.' });
  const cust = getCustomer(user.customer_id);
  if (!cust) return reply.code(400).send({ ok: false, error: 'Your organisation record is missing — please contact us.' });

  const b = req.body || {};
  const kind = MAP_KINDS.includes(b.kind) ? b.kind : '';
  const name = str(b.name, 120);
  const fields = [];
  if (!kind) fields.push('kind');
  if (!name) fields.push('name');
  if (fields.length) return reply.code(400).send({ ok: false, error: 'Please choose a type and give the map a name.', fields });

  const usage = quotaUsage(cust.id);
  const limit = kind === 'area' ? cust.quota_areas : cust.quota_places;
  if (usage[kind] >= limit) {
    const noun = kind === 'area' ? 'area map' : 'place map';
    return reply.code(400).send({ ok: false, error: `Your plan includes ${limit} ${noun}${limit === 1 ? '' : 's'} and you already have ${usage[kind]}. Contact us to raise your quota.` });
  }

  // Unique slug (append a counter if the base is taken).
  let slug = slugify(name) || kind;
  for (let n = 2; getMapBySlug(slug); n++) slug = `${slugify(name) || kind}-${n}`;

  const id = insertMap({
    customer_id: cust.id, slug, name, kind,
    subject: str(b.subject, 200), request_note: str(b.note, 2000),
    requested_by: user.id, data_dir: '', status: 'requested',
  });
  req.log.info({ mapId: id, kind, by: user.email }, 'map requested');
  const after = quotaUsage(cust.id);
  return {
    ok: true,
    map: { id, slug, name, kind, subject: str(b.subject, 200), status: 'requested' },
    usage: { usedAreas: after.area, usedPlaces: after.place, quotaAreas: cust.quota_areas, quotaPlaces: cust.quota_places },
  };
});

app.get('/api/maps/:id', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadReadableMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  return { ok: true, map: mapDetail(map) };
});

app.post('/api/maps/:id/preview', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  const meta = readRoutesMeta(id);
  const poiKeys = editablePoiKeysFromDir(mapDataDir(id), savedPoiTiers(id));
  const s = sanitizeOverrides((req.body || {}).overrides, safeSubsetAllow(map, meta, poiKeys));
  try {
    // OA-216 — a preview is the cheapest place to learn that a *Must show*
    // cannot be seated, because nothing has been saved yet. The generator has
    // always computed it and written it to stderr on a zero exit; this is the
    // first caller to read it.
    const runs = [];
    const svg = await withMapLock(id, () => preview(id, s.overrides, parseOutputs(map.outputs), runs));
    return { ok: true, overrides: s.overrides, rejected: s.rejected, svg, warnings: mergeGenWarnings(runs) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Preview render failed: ' + e.message });
  }
});

/**
 * The landmark chooser's list (OA-212): every POI this map COULD draw, with the
 * answer it currently carries, grouped so a category can be answered in one go.
 *
 * Read-only, and it runs no generator: enumerateCandidatesFromDir() asks the
 * selector directly. That matters twice over — it is fast enough to serve on
 * page load, and it is the only enumeration that still lists a POI somebody has
 * already classified `Do not show`.
 */
app.get('/api/maps/:id/landmarks', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  const tiers = savedPoiTiers(id);
  const saved = readOverrides(id);
  // A POI hidden through the editor's older render-time tick is shown here as
  // "Do not show" and rewritten as a tier on the next save (Peter, 2026-09-01).
  // Both are reported so the page can say which it is reading.
  const hidden = new Set(Object.keys((saved.internal && saved.internal.pois) || {})
    .filter((k) => saved.internal.pois[k] && saved.internal.pois[k].hide));
  // WHICH ROWS HAVE BEEN ANSWERED, which is not the same question as which rows
  // carry a tier other than `may` (OA-215). A deliberate "show if there is room"
  // is recorded as an entry whose tier IS `may`, so the only way to see it is to
  // ask which keys the two tier layers actually name — the map pack's own
  // routes.json, and the customer's overrides.
  const answeredKeys = new Set([
    ...Object.keys(packPoiTiers(mapDataDir(id))),
    ...Object.keys(tiers || {}),
  ]);
  const cand = enumerateCandidatesFromDir(mapDataDir(id), tiers).map((p) => ({
    key: p.key, cat: p.cat, name: p.name, ll: p.ll,
    tier: p.tier === 'may' && hidden.has(p.key) ? 'miss' : p.tier,
    as: p.as || null,
    printsName: !!p.printsName,
    fromHide: p.tier === 'may' && hidden.has(p.key),
    answered: answeredKeys.has(p.key) || hidden.has(p.key),
  }));
  return {
    ok: true,
    map: { id, name: map.name, slug: map.slug, kind: map.kind, status: map.status },
    landmarks: cand,
    counts: {
      total: cand.length,
      must: cand.filter((p) => p.tier === 'must').length,
      miss: cand.filter((p) => p.tier === 'miss').length,
      symbolOnly: cand.filter((p) => !p.printsName).length,
      fromHide: cand.filter((p) => p.fromHide).length,
      answered: cand.filter((p) => p.answered).length,
    },
  };
});

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

/**
 * The street network and the POI points behind the chooser's map.
 *
 * DELIBERATELY NOT THE SHEET. It is the town's roads in plain lat/lon, drawn by
 * the browser, so that ticking is instant and a judgement about whether
 * somewhere is a landmark is made looking at where it actually is. It is served
 * from the same roads_geo.json the sheet is built from, so the streets are the
 * real ones — but the sheet's own projection, rotation and focus fisheye are NOT
 * applied, and the page says so. A picture that looked like the sheet without
 * being it would invite the reader to judge crowding from the wrong drawing;
 * the "See the real sheet" button is what answers that question honestly.
 *
 * Slimmed on the way out: roads_geo.json is 1.3 MB for High Wycombe, most of it
 * node id arrays nothing here needs.
 */
app.get('/api/maps/:id/basemap', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const dir = mapDataDir(map.id);
  let roads = null;
  try { roads = JSON.parse(readFileSync(path.join(dir, 'roads_geo.json'), 'utf8')); } catch { roads = null; }
  if (!roads || !Array.isArray(roads.ways)) {
    return reply.code(404).send({ ok: false, error: 'This map has no street data to draw.' });
  }
  // Keep the classes that read as a street network at town scale. A service
  // road or a driveway is noise here and is most of the file.
  const KEEP = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'unclassified', 'residential', 'motorway_link', 'trunk_link', 'primary_link',
    'secondary_link', 'tertiary_link', 'living_street', 'pedestrian']);
  const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link']);
  const ways = [];
  for (const w of roads.ways) {
    const hw = w.tags && w.tags.highway;
    if (!hw || !KEEP.has(hw)) continue;
    if (!Array.isArray(w.geometry) || w.geometry.length < 2) continue;
    ways.push({
      g: w.geometry.map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]),
      m: MAJOR.has(hw) ? 1 : 0,
      n: (w.tags.name || w.tags.ref || '') || undefined,
    });
  }
  return { ok: true, bbox: roads.bbox || null, ways };
});

app.post('/api/maps/:id/save', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  // Editing is frozen while a version awaits publication review — withdraw the
  // request first, so the version an approver reviews is always the head.
  if (getOpenRequestForMap(id)) {
    return reply.code(409).send({ ok: false, error: 'This map is awaiting publication review. Withdraw the request to make further changes.' });
  }
  const meta = readRoutesMeta(id);
  const poiKeys = editablePoiKeysFromDir(mapDataDir(id), savedPoiTiers(id));
  const b = req.body || {};
  const s = sanitizeOverrides(b.overrides, safeSubsetAllow(map, meta, poiKeys));
  const { major, minor } = nextVersion(id);
  const storageKey = `v${major}.${minor}`;
  try {
    const r = await withMapLock(id, () => renderVersion(id, s.overrides, storageKey, parseOutputs(map.outputs)));
    const versionId = insertVersion({ map_id: id, major, minor, note: str(b.note, 500), overrides: s.overrides, storage_key: storageKey });
    setCurrentVersion(id, versionId);
    req.log.info({ mapId: id, version: storageKey, by: user.email, genLog: r.log }, 'saved new map version');
    logAudit(req, 'version.save', { mapId: id, versionId, detail: { version: storageKey, note: str(b.note, 500) } });
    // OA-216 — what the generators said on the way to this SUCCESSFUL render.
    // `mustPlace` is not a veto: a place the customer marked *Must show* that
    // the placer could not seat is named on stderr and the run still exits 0,
    // so until 2026-09-01 the editor was told "the map has been redrawn with
    // your choices" over an answer that had partly not happened.
    return { ok: true, version: storageKey, rejected: s.rejected, files: r.files, warnings: r.warnings, downloads: visibleDownloadsForVersion(id, storageKey, parseOutputs(map.outputs)) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Render failed: ' + e.message });
  }
});

// --- publish gate: the editor submits the current head for review, or
//     withdraws a pending request to resume editing. Approvers/admins decide
//     (below, under /api/review). Editors never publish their own maps.
app.post('/api/maps/:id/publish-request', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  if (!map.current_version_id || !map.cur_key) {
    return reply.code(400).send({ ok: false, error: 'This map has no rendered version to publish yet.' });
  }
  if (getOpenRequestForMap(id)) {
    return reply.code(409).send({ ok: false, error: 'This map is already awaiting publication review.' });
  }
  if (map.published_version_id === map.current_version_id) {
    return reply.code(409).send({ ok: false, error: 'The current version is already the published one.' });
  }
  const note = str((req.body || {}).note, 1000);
  const requestId = insertPublishRequest({ map_id: id, version_id: map.current_version_id, requested_by: user.id, note });
  setVersionState(map.current_version_id, 'pending');
  req.log.info({ mapId: id, requestId, version: map.cur_key, by: user.email }, 'publication requested');
  logAudit(req, 'version.submit', { mapId: id, versionId: map.current_version_id, detail: { requestId, version: map.cur_key, note } });
  return { ok: true, request: { id: requestId, versionKey: map.cur_key, note } };
});

app.post('/api/maps/:id/publish-request/withdraw', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const open = getOpenRequestForMap(map.id);
  if (!open) return reply.code(409).send({ ok: false, error: 'There is no pending request to withdraw.' });
  withdrawPublishRequest(open.id);
  // Return the version to draft unless it is the currently-published one.
  if (open.version_id !== map.published_version_id) setVersionState(open.version_id, 'draft');
  req.log.info({ mapId: map.id, requestId: open.id, by: user.email }, 'publication request withdrawn');
  logAudit(req, 'version.withdraw', { mapId: map.id, versionId: open.version_id, detail: { requestId: open.id } });
  return { ok: true };
});

// Choose which outputs a map produces (P2 output toggles).
//
// Expert styles (P7) can only be switched on for a map that carries the config
// they need, and the tube-map diagram cannot be switched on by a customer at all
// — it is request-only (see chooseOutputs). The server decides, not the UI.
app.patch('/api/maps/:id/outputs', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const current = parseOutputs(map.outputs);
  const available = outputsForClient(current, map.id, map.kind).filter((o) => o.available).map((o) => o.key);
  const { outputs: clean, refused } = chooseOutputs((req.body || {}).outputs, {
    current, available, isAdmin: user.role === 'admin',
  });
  if (refused.length) {
    req.log.warn({ mapId: map.id, refused, by: user.email }, 'refused a request-only output change');
    return reply.code(403).send({
      ok: false, refused,
      error: 'The tube-map diagram is hand-finished, so it is not a tick-box — ask us for it and we will quote and set it up.',
    });
  }
  if (!Object.values(clean).some(Boolean)) return reply.code(400).send({ ok: false, error: 'A map must produce at least one output.' });

  // GRANTING AN OUTPUT USED TO RENDER NOTHING (OA-007). Walked for real on the
  // St Ives Bus Station import, 2026-08-24: `PATCH /api/maps/14/outputs` set
  // `boarding_plan: true`, returned 200, and produced no file at all —
  // `renders/v1.0/` still held only the internal and external sheets. The sheet
  // appeared only after a second delivery of the same S5 was staged as a
  // proposed update and ACCEPTED, because accept is what renders. So the working
  // sequence was grant → re-deliver → accept → publish, and two of those four
  // steps existed purely to make a flag take effect.
  //
  // Most flips need none of that: a `buildAlways` output (the schematic) is
  // already in every version's folder, so enabling it is a pure visibility
  // change and must stay instant and free. The ones that need a render are
  // exactly the ones whose FILE IS MISSING from the current version — which is
  // the condition asked here, rather than "is this output expert" or "is it
  // request-only". Both of those are proxies; the file is the fact.
  const grantsNeedingRender = outputsNeedingRender(current, clean, mapDataDir(map.id), map.cur_key ? versionDir(map.id, map.cur_key) : null);
  if (grantsNeedingRender.length && getOpenRequestForMap(map.id)) {
    return reply.code(409).send({
      ok: false,
      error: 'This map is awaiting publication review, and adding that sheet needs a new version. Withdraw the request first.',
    });
  }

  setMapOutputs(map.id, clean);
  req.log.info({ mapId: map.id, outputs: clean }, 'updated map outputs');

  let added = null;
  if (grantsNeedingRender.length) {
    const overrides = readOverrides(map.id);
    const { major, minor } = nextVersion(map.id);
    const storageKey = `v${major}.${minor}`;
    const labels = grantsNeedingRender.map((k) => (map.kind === 'place' && OUTPUTS[k].placeLabel) || OUTPUTS[k].label);
    try {
      const r = await withMapLock(map.id, () => renderVersion(map.id, overrides, storageKey, clean));
      const versionId = insertVersion({
        map_id: map.id, major, minor,
        note: `Added ${labels.join(' and ')}`,
        overrides, storage_key: storageKey,
      });
      setCurrentVersion(map.id, versionId);
      added = { version: storageKey, outputs: grantsNeedingRender, files: r.files };
      req.log.info({ mapId: map.id, version: storageKey, outputs: grantsNeedingRender, by: user.email }, 'rendered a new version for a granted output');
      logAudit(req, 'version.save', { mapId: map.id, versionId, detail: { version: storageKey, granted: grantsNeedingRender } });
    } catch (e) {
      // The FLAG IS ALREADY SET and that is deliberate: the grant itself is what
      // was asked for and it succeeded. Report the render failure honestly and
      // let the next save pick the sheet up, rather than silently reverting a
      // decision an admin made.
      req.log.error(e);
      return reply.code(500).send({
        ok: false,
        outputs: outputsForClient(clean, map.id, map.kind),
        error: `The sheet was granted, but rendering it failed: ${e.message}. The next save will produce it.`,
      });
    }
  }
  return { ok: true, outputs: outputsForClient(clean, map.id, map.kind), added };
});

// "Ask us for the diagram" — the customer half of the request-only lock above.
// It deliberately creates nothing but a MESSAGE (the same table the contact form
// and public map feedback use, with the map attached), because granting the
// output is expert work with a price attached, not a state a form can set.
app.post('/api/maps/:id/diagram-request', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const note = str((req.body || {}).note, 2000);
  const body = [
    `Asked for the tube-map diagram on "${map.name}" (map #${map.id}, ${map.kind}).`,
    note && `They said: ${note}`,
  ].filter(Boolean).join('\n\n');
  const id = insertMessage({ kind: 'diagram-request', name: user.name || null, email: user.email, body, map_id: map.id });
  req.log.info({ messageId: id, mapId: map.id, by: user.email }, 'tube-map diagram requested');
  logAudit(req, 'diagram.request', { mapId: map.id, detail: { messageId: id, note } });
  return { ok: true, id };
});

// Whether the map's PUBLISHED version appears on the public site (P6). This is
// the customer's own choice and is independent of the publish gate: un-listing
// takes the page down without touching the reviewed version or its pointer.
app.patch('/api/maps/:id/public', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const listed = !!(req.body || {}).listed;
  setMapPublicListed(map.id, listed);
  bumpSearchIndex(); // P9 — an unlisted map's places must stop being searchable
  req.log.info({ mapId: map.id, listed }, 'public listing updated');
  logAudit(req, listed ? 'public.list' : 'public.unlist', { mapId: map.id, detail: { name: map.name } });
  return { ok: true, publicListed: listed, publicUrl: getPublicMapBySlug(map.slug) ? mapPageUrl(map.slug) : null };
});

// P8: the "changes coming" banner shown above the public map image. Auto-
// suggested by scripts/check-upcoming-refreshes.mjs from the GTFS upcoming-
// changes scan; the owning customer or an admin may overwrite the wording here
// (marking it 'manual' so the next scan won't clobber it), or clear it entirely.
app.patch('/api/maps/:id/banner-note', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const note = str((req.body || {}).note, 500);
  setMapBannerNote(map.id, note || null, 'manual');
  req.log.info({ mapId: map.id, by: user.email }, 'banner note updated');
  logAudit(req, 'banner.update', { mapId: map.id, detail: { note } });
  return { ok: true, bannerNote: note || null };
});

app.get('/api/maps/:id/versions/:key/:file', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadReadableMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const { key, file } = req.params;
  if (!/^v\d+\.\d+$/.test(key) || !Object.prototype.hasOwnProperty.call(OUTPUT_FILES, file)) {
    return reply.code(400).send({ ok: false, error: 'Bad version or file.' });
  }
  let p = path.join(versionDir(map.id, key), file);
  if (!existsSync(p)) return reply.code(404).send({ ok: false, error: 'Not found.' });

  /* Mark a copy that is NOT the published one, so a sheet on someone's desk says
   * what it is. The render itself carries only "Map version 5.0" — true while the
   * version is a draft and still true once it is published, which is what lets
   * publishing stay a pure state flip and leaves the reviewed bytes alone (see
   * renderVersion in maps/engine.js). This route is the one that serves versions
   * OTHER than the published one, so it is where the state belongs.
   *
   * Derived and cached beside the source, never written over it — the same
   * contract as the public watermark, and it falls back to the original file on
   * any error rather than failing a download. A render made before the version
   * line existed has no line to rewrite and is served untouched.
   */
  const ver = getVersion(map.id, key);
  if (ver && ver.review_state !== 'published') {
    try {
      const marked = await ensureDraftMarked(p, draftLabel(ver.review_state, `${ver.major}.${ver.minor}`, ver.created_at));
      if (marked) p = marked;
    } catch (e) {
      req.log.error(e, 'draft marking failed; serving the original file');
    }
  }

  reply.header('Content-Type', OUTPUT_FILES[file]);
  if (req.query && 'download' in req.query) {
    reply.header('Content-Disposition', `attachment; filename="${map.slug}-${key}-${file}"`);
  }
  return reply.send(createReadStream(p));
});

// ===========================================================================
// Monthly change acceptance (P5) — the central pipeline stages a data refresh
// (via scripts/propose-update.mjs); the customer reviews an old-vs-new preview
// and Accepts (re-applies their overrides as a new MAJOR version, which is a
// draft that still goes through the P4 publish gate) or Declines. Only the map's
// own customer (or an admin) may act. The data fetch/judgement stays central.
// ===========================================================================

// Old-vs-new preview: render the LIVE data (with saved overrides) and the STAGED
// data (with those overrides re-applied — orphans dropped) so the customer can
// compare exactly what accepting would produce. Nothing is persisted.
app.post('/api/maps/:id/proposed/:pid/preview', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  const { pu, code: pcode, error: perror } = loadPendingProposed(id, Number(req.params.pid));
  if (!pu) return reply.code(pcode).send({ ok: false, error: perror });
  if (!map.cur_key) return reply.code(400).send({ ok: false, error: 'This map has no current version to compare against.' });

  const stagedDir = pu.data_dir || proposedDataDir(id, pu.id);
  const outputs = parseOutputs(map.outputs);
  const saved = readOverrides(id);
  try {
    const result = await withMapLock(id, async () => {
      // The staged payload comes from central data and carries no expert tuning;
      // lay the map's own pins on it so the "after" side is what accepting gives.
      carryExpertTuning(id, stagedDir);
      const stagedMeta = readRoutesMetaFromDir(stagedDir);
      const poiKeys = editablePoiKeysFromDir(stagedDir, savedPoiTiers(id));
      const after = sanitizeOverrides(saved, safeSubsetAllow(map, stagedMeta, poiKeys, stagedDir)); // re-apply onto proposed data
      return {
        before: previewFrom(mapDataDir(id), saved, outputs),
        after: previewFrom(stagedDir, after.overrides, outputs),
        dropped: after.rejected, // overrides the refresh made obsolete
      };
    });
    return { ok: true, ...result, summary: parseJson(pu.summary_json) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Preview render failed: ' + e.message });
  }
});

// Accept the refresh: render the new major version FROM the staged data first
// (so a failure leaves the live map untouched), then swap the data in, re-apply
// the overrides, and record the new draft head + audit. The published pointer is
// unchanged — the new version must be reviewed (P4) before it goes public.
app.post('/api/maps/:id/proposed/:pid/accept', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  const { pu, code: pcode, error: perror } = loadPendingProposed(id, Number(req.params.pid));
  if (!pu) return reply.code(pcode).send({ ok: false, error: perror });
  if (!map.current_version_id || !map.cur_key) {
    return reply.code(400).send({ ok: false, error: 'This map has no current version to update.' });
  }
  // Accepting moves the head — not allowed while a publication awaits review.
  if (getOpenRequestForMap(id)) {
    return reply.code(409).send({ ok: false, error: 'This map is awaiting publication review. Withdraw that request before accepting an update.' });
  }

  const stagedDir = pu.data_dir || proposedDataDir(id, pu.id);
  const outputs = parseOutputs(map.outputs);
  const saved = readOverrides(id);
  const { major, minor } = nextMajorVersion(id);
  const storageKey = `v${major}.${minor}`;
  const decisionNote = str((req.body || {}).note, 1000);
  const summary = parseJson(pu.summary_json);

  try {
    const applied = await withMapLock(id, async () => {
      // Expert hand-tuning first: the new version is rendered FROM the staged data,
      // so the pins must be in there before we render, not just after the swap.
      const carried = carryExpertTuning(id, stagedDir);
      if (carried.length) req.log.info({ mapId: id, carried }, 'carried expert tuning into the refreshed data');
      // Re-apply the customer's overrides onto the PROPOSED data (orphans dropped).
      const stagedMeta = readRoutesMetaFromDir(stagedDir);
      const poiKeys = editablePoiKeysFromDir(stagedDir, savedPoiTiers(id));
      const reapplied = sanitizeOverrides(saved, safeSubsetAllow(map, stagedMeta, poiKeys, stagedDir));
      // Render from the staged data BEFORE committing the swap.
      const rend = await renderVersion(id, reapplied.overrides, storageKey, outputs, stagedDir);
      // Render OK → make the staged data the live data (old data archived).
      // What the swap carried forward from the archive is worth a line: the list is
      // how the expert's pins and the pack's engine-source declaration survive a
      // refresh, and a declaration it deliberately REFUSED to carry (OA-199) is a
      // fact about this map that nothing else would ever say out loud.
      const swap = swapInProposedData(id, pu.id);
      if (swap.carried.length) req.log.info({ mapId: id, carried: swap.carried }, 'carried pack extras onto the refreshed data');
      for (const d of swap.dropped) req.log.warn({ mapId: id, file: d.file }, `did NOT carry ${d.file} forward — ${d.why}`);
      return { rend, overrides: reapplied.overrides, dropped: reapplied.rejected };
    });

    const noteBits = refreshNote(summary);
    const versionId = insertVersion({
      map_id: id, major, minor,
      note: `Accepted update${noteBits ? ' — ' + noteBits : ''}`,
      overrides: applied.overrides, storage_key: storageKey,
      // The diff travels WITH the version, so every later screen can say what
      // this version changed without digging through the audit log (findings A1).
      data_change: { proposedId: pu.id, sourceNote: pu.source_note || '', summary },
    });
    setCurrentVersion(id, versionId);
    decideProposedUpdate(pu.id, { status: 'accepted', reviewedBy: user.id, decisionNote, acceptedVersionId: versionId });
    req.log.info({ mapId: id, version: storageKey, proposedId: pu.id, by: user.email }, 'monthly update accepted');
    logAudit(req, 'refresh.accept', { mapId: id, versionId, detail: { proposedId: pu.id, version: storageKey, changeSummary: summary, droppedOverrides: applied.dropped, note: decisionNote } });
    return {
      ok: true, version: storageKey, dropped: applied.dropped,
      files: applied.rend.files, downloads: visibleDownloadsForVersion(id, storageKey, outputs),
    };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Accepting the update failed: ' + e.message });
  }
});

// Decline the refresh: keep the current data; mark the proposal declined.
app.post('/api/maps/:id/proposed/:pid/decline', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const id = map.id;
  const { pu, code: pcode, error: perror } = loadPendingProposed(id, Number(req.params.pid));
  if (!pu) return reply.code(pcode).send({ ok: false, error: perror });
  const note = str((req.body || {}).note, 1000);
  decideProposedUpdate(pu.id, { status: 'declined', reviewedBy: user.id, decisionNote: note });
  req.log.info({ mapId: id, proposedId: pu.id, by: user.email }, 'monthly update declined');
  logAudit(req, 'refresh.decline', { mapId: id, detail: { proposedId: pu.id, note } });
  return { ok: true };
});

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

app.get('/app/maps/:id/diagram', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'admin') return reply.redirect(`/app/maps/${Number(req.params.id)}`);
  return reply.sendFile('app/diagram.html', VIEWS_DIR);
});

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
if (process.env.CBM_NO_LISTEN === '1') {
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
