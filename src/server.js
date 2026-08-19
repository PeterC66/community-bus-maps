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
import {
  insertApplication, insertMessage, counts, authCounts,
  listMaps, getMap, getMapBySlug, insertMap, nextVersion, insertVersion, setCurrentVersion, listVersions,
  dataChangesSince,
  setMapOutputs, setMapStatus, listMapsByStatus, listAwaitingBuild, quotaUsage, getCustomer, purgeExpiredSessions,
  listPublishedHistory, listPublishedMaps,
  listApplications, getApplication, setApplicationReviewed, listMessages,
  insertCustomer, insertUser, getUserByEmail, getUser, listUsersAdmin, updateUserAdmin,
  listCustomersAdmin, updateCustomerAdmin, adminSummary,
  getVersionById, setVersionState, setPublishedVersion,
  insertPublishRequest, getOpenRequestForMap, getPublishRequest, listPendingPublishRequests,
  decidePublishRequest, withdrawPublishRequest, listPublishRequestsForMap, listAudit,
  nextMajorVersion, getOpenProposedForMap, getProposedUpdate, decideProposedUpdate,
  listProposedForMap, listPendingProposedUpdates,
  listPublicMaps, getPublicMapBySlug, listPublicOrgs, getCustomerBySlug,
  setCustomerBranding, setMapPublicListed, publicCounts,
  setMapBannerNote, clearMapBannerNote, getVersion } from './db/index.js';
import { buildWorklist } from './worklist/index.js';
import { saveStatusSnapshot } from './status-snapshot.js';
import { sanitizeBranding, brandingForPublic, ACCENTS } from './branding/index.js';
import {
  publicMap, publicMaps, publicOrg, publicOutputs, mapPageUrl, orgPageUrl, webPreviewPath, PUBLIC_BASES,
} from './public/index.js';
import { factsForPublicMap, publicServices, servicesPageUrl } from './public/services.js';
import { readFactsSnapshot, buildFacts } from './maps/facts.js';
import { inlineSvg } from './public/inlineSvg.js';
import {
  readRoutesMeta, readRoutesMetaFromDir, enumeratePois, enumeratePoisFromDir,
  readOverrides, preview, previewFrom, renderVersion, outputsForClient, chooseOutputs,
  swapInProposedData, carryExpertTuning,
} from './maps/engine.js';
import { sanitizeOverrides } from './maps/safeSubset.js';
import { versionDir, mapDataDir, proposedDataDir, OUTPUT_FILES } from './maps/store.js';
import { ensureWatermarked } from './render/watermark.js';
import { ensureDraftMarked, draftLabel } from './render/draftStamp.js';
import {
  diagramAvailable, readPins, writePins, clearPins, previewDiagram, dropSandbox, pinNotes,
} from './expert/index.js';
import { readiness, metricsText, opsSnapshot } from './ops/index.js';
import {
  requestMagicLink, verifyMagicLink, resolveUser, logout, sessionCookie, clearCookie,
} from './auth/index.js';
import { CHECKLIST, CHECKLIST_VERSION, validateChecklist, changeSummary, chooseRevertTarget } from './publish/index.js';
import { logAudit } from './audit/index.js';
import { writePlacesSidecar } from './search/place-index.js';
import { searchPlaces, bumpSearchIndex } from './search/index.js';
import { PILOT } from './config.js'; // PILOT: remove with docs/PILOT.md
import { APP_VERSION, GIT_SHA, BUILT_AT } from './version.js';
import { sendMagicLink } from './email/index.js';
import { notify, appUrl } from './email/notify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = APP_VERSION; // GO-LIVE.md §5: package.json is the one source of truth

// The five pain-point classes the shopfront is organised around, plus 'other'.
// The trailing seven are the original organisation-type values: no longer offered
// on the form, still accepted so that stored applications and seeded demo rows
// keep validating (customer.type is copied straight from here on approval).
const ORG_TYPES = [
  'authority-council', 'healthcare-campus', 'business-park', 'bid-tourism', 'operator-ct', 'other',
  'council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt',
];
// What the PUBLIC contact form may set. 'diagram-request' is a fourth kind in the
// message table, but only the server writes it (see /api/maps/:id/diagram-request),
// so it is deliberately not in this list.
const MSG_KINDS = ['enquiry', 'question', 'feedback', 'issue'];
const MAP_KINDS = ['area', 'place'];
// In dev (no email provider) the invite/sign-in link is surfaced to the admin UI
// so the whole apply→approve→sign-in loop is demoable without a mailbox.
const DEV_LINKS = !process.env.EMAIL_PROVIDER;

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const isHttps = (req) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
const parseOutputs = (json) => { try { return JSON.parse(json || '{}') || {}; } catch { return {}; } };
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const authLink = (req, token) => `${req.protocol}://${req.headers.host}/auth/verify?token=${token}`;

// trustProxy: behind Caddy (or any reverse proxy) req.protocol and req.ip are
// otherwise the proxy's, not the client's — breaking authLink()'s https URLs
// (GO-LIVE.md §2.4) and letting every visitor share one rate-limit bucket.
const app = Fastify({
  // P9 B8 — search queries are never logged, and an access log counts as a
  // log: the default request serializer logs req.url including its query
  // string, so strip `q` off this one route before it ever reaches the log.
  // Every other route's request line is unchanged.
  logger: {
    serializers: {
      req(req) {
        const url = req.url && req.url.startsWith('/api/public/search') ? req.url.split('?')[0] : req.url;
        return { method: req.method, url, host: req.host, remoteAddress: req.ip, remotePort: req.socket ? req.socket.remotePort : undefined };
      },
    },
  },
  bodyLimit: 256 * 1024,
  trustProxy: true,
});

await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });

// Resolve the signed-in user (from the session cookie) for app/api/auth routes.
app.addHook('preHandler', async (req) => {
  req.user = null;
  const u = req.url;
  if (u.startsWith('/api/') || u.startsWith('/app') || u.startsWith('/auth/') || u.startsWith('/metrics')) req.user = resolveUser(req);
});

// --- tiny in-memory per-IP rate limit for public POSTs ---
const hits = new Map();
function rateLimited(ip, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  hits.set(ip, rec);
  return rec.n > max;
}

// Liveness by default (cheap, safe to hammer). `?deep=1` runs the P7 readiness
// probe — DB, object store, engine files, rasteriser — and returns 503 if any
// dependency is unhealthy, which is what a load balancer or uptime check wants.
app.get('/health', async (req, reply) => {
  const base = {
    status: 'ok', service: 'community-bus-maps', version: VERSION, gitSha: GIT_SHA, builtAt: BUILT_AT, pilotMode: PILOT.on,
    time: new Date().toISOString(), ...counts(), ...authCounts(), ...publicCounts(),
  };
  if (!req.query || !('deep' in req.query)) return base;
  const r = await readiness();
  if (!r.ok) reply.code(503);
  return { ...base, status: r.ok ? 'ok' : 'degraded', checks: r.checks };
});

// Prometheus metrics. Off unless METRICS_TOKEN is set (an unauthenticated metrics
// endpoint leaks operational detail); an admin session is also accepted so the
// numbers can be eyeballed from a browser.
app.get('/metrics', async (req, reply) => {
  const token = process.env.METRICS_TOKEN;
  const bearer = String((req.headers.authorization || '')).replace(/^Bearer\s+/i, '');
  const viaToken = token && (bearer === token || (req.query && req.query.token === token));
  const viaAdmin = req.user && req.user.role === 'admin';
  if (!viaToken && !viaAdmin) {
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
  const token = process.env.STATUS_TOKEN;
  const bearer = String((req.headers.authorization || '')).replace(/^Bearer\s+/i, '');
  const viaToken = token && (bearer === token || (req.query && req.query.token === token));
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

const BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const baseUrl = (req) => BASE_URL || `${req.protocol}://${req.headers.host}`;

// Pretty public URLs. The HTML is a static shell; it fetches the JSON below.
// Unknown/unpublished slugs 404 with the same shell (so a link that stops being
// public does not silently render an empty page or leak that a draft exists).
app.get('/maps', async (req, reply) => reply.sendFile('maps.html'));

// P8a — the map pages are still static shells filled in by their fetch, but a
// crawler, a link preview and a screen reader all read the HTML as delivered.
// So the shell's <head> is completed SERVER-side for the two per-map pages: real
// title, description, canonical and Open Graph tags, and a JSON-LD block. The
// client-side render is unchanged and simply agrees with what is already there.
const shellCache = new Map();
function shell(name) {
  if (!shellCache.has(name)) shellCache.set(name, readFileSync(path.join(PUBLIC_DIR, name), 'utf8'));
  return shellCache.get(name);
}
const htmlAttr = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sendShell(reply, name, head) {
  // Drop the shell's own placeholder <title>/description/og tags first, so the
  // page has exactly one of each and the browser does not just take whichever
  // came first in the file.
  const stripped = shell(name)
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\r?\n?/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>\r?\n?/i, '')
    .replace(/[ \t]*<meta\s+property="og:(?:title|description|url|image)"[^>]*>\r?\n?/gi, '');
  reply.type('text/html; charset=utf-8');
  return reply.send(stripped.replace('</head>', `${head}\n</head>`));
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
app.get('/m/:slug/services', async (req, reply) => {
  const row = getPublicMapBySlug(str(req.params.slug, 120));
  if (!row) return reply.code(404).type('text/html').send(notFoundPage('map'));
  const m = publicMap(row);
  if (!m.servicesUrl) return reply.code(404).type('text/html').send(notFoundPage('services list'));
  return sendShell(reply, 'services.html', mapHead(req, m, { services: true }));
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

// GO-LIVE.md §5, surfaces 3 and 4: a muted footer line and a machine-readable
// <meta> tag, both from this one generated script so a screenshot — or a
// script run against a deployed page — can say which build served it.
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

const SITE_BANNER_JS = PILOT_BANNER_JS + VERSION_BADGE_JS;

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
app.get('/robots.txt', async (req, reply) => {
  reply.type('text/plain');
  return [
    'User-agent: *',
    // PILOT: a pilot with no customers has no business being indexed. The
    // sitemap stays below so the line is a one-line revert.
    ...(PILOT.on ? ['Disallow: /'] : []),
    'Disallow: /app',
    'Disallow: /api/',
    'Disallow: /auth/',
    `Sitemap: ${baseUrl(req)}/sitemap.xml`,
    '',
  ].join('\n');
});

// Every public page that is linked from the footer, so the sitemap and the footer
// agree. `/opportunity.html` is outreach rather than shopfront, but it is linked
// from all of them — excluding it would hide it from crawlers while showing it to
// every visitor, which is not privacy, just inconsistency. (What actually keeps it
// unindexed during the pilot is robots.txt saying `Disallow: /`.)
const STATIC_PAGES = ['/', '/maps', '/examples.html', '/pricing.html', '/faq.html', '/apply.html', '/contact.html', '/opportunity.html', '/legal.html', '/terms.html', '/accessibility.html'];

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
<script src="/js/site-banner.js" defer></script></head>
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

app.post('/api/auth/request', async (req, reply) => {
  if (rateLimited(req.ip, 10)) return reply.code(429).send({ ok: false, error: 'Too many requests — please wait a moment.' });
  const email = str((req.body || {}).email, 200).toLowerCase();
  if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'Please enter a valid email address.', fields: ['email'] });

  const token = requestMagicLink(email);
  if (token) {
    const link = `${req.protocol}://${req.headers.host}/auth/verify?token=${token}`;
    try {
      const r = await sendMagicLink({ to: email, link, kind: 'signin' });
      if (r.sent) {
        req.log.info({ email }, 'magic link emailed');
      } else {
        // DEV_LINKS: no email provider configured — print the link to the SERVER CONSOLE.
        console.log(`\n🔗  Sign-in link for ${email}:\n    ${link}\n`);
        req.log.info({ email }, 'magic link issued (see console)');
      }
    } catch (e) {
      // A broken provider must not tell an unauthenticated caller anything
      // beyond the generic message below — log it and move on.
      req.log.error({ email, err: e.message }, 'magic link email failed to send');
    }
  } else {
    req.log.info({ email }, 'magic link requested for unknown/inactive email (no-op)');
  }
  // Identical response whether or not the email is registered (no enumeration).
  return { ok: true, message: 'If that address is registered, a sign-in link has been sent.' };
});

app.get('/auth/verify', async (req, reply) => {
  const token = str((req.query || {}).token, 400);
  const res = token ? verifyMagicLink(token) : null;
  if (!res) return reply.redirect('/app/login.html?error=expired');
  reply.header('Set-Cookie', sessionCookie(res.sessionToken, { secure: isHttps(req) }));
  req.log.info({ userId: res.user.id }, 'session opened');
  return reply.redirect('/app');
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

// Serialise generator runs per map (preview + save write into the map's data/).
const mapLocks = new Map();
function withMapLock(id, fn) {
  const prev = mapLocks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  mapLocks.set(id, next.finally(() => { if (mapLocks.get(id) === next) mapLocks.delete(id); }));
  return next;
}

function requireUser(req, reply) {
  if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return null; }
  return req.user;
}

function requireAdmin(req, reply) {
  if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return null; }
  if (req.user.role !== 'admin') { reply.code(403).send({ ok: false, error: 'Admin access only.' }); return null; }
  return req.user;
}

// Publishing is a platform review (separation of duties from the customer who
// edits): approvers and admins may review + publish; editors may only submit.
function requireApprover(req, reply) {
  if (!req.user) { reply.code(401).send({ ok: false, error: 'Please sign in.' }); return null; }
  if (req.user.role !== 'approver' && req.user.role !== 'admin') {
    reply.code(403).send({ ok: false, error: 'Approver access only.' }); return null;
  }
  return req.user;
}

// Load a map only if the user may EDIT it. Admins edit all; everyone else is
// scoped to their own customer. Returns { map } or { code, error }.
function loadOwnedMap(id, user) {
  const m = getMap(id);
  if (!m) return { code: 404, error: 'No such map.' };
  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {
    return { code: 403, error: 'You do not have access to this map.' };
  }
  return { map: m };
}

// Load a map the user may READ (view detail / download rendered files). Same as
// edit scope PLUS platform approvers, who must inspect any submitted map's
// print-ready files to review it — but cannot edit it.
function loadReadableMap(id, user) {
  const m = getMap(id);
  if (!m) return { code: 404, error: 'No such map.' };
  const owner = user.customer_id != null && m.customer_id === user.customer_id;
  if (user.role === 'admin' || user.role === 'approver' || owner) return { map: m };
  return { code: 403, error: 'You do not have access to this map.' };
}

// Whether this map's owning customer has opted into the hiddenOperators
// safe-subset key (off by default — most maps/customers never see it).
function operatorFilterAllow(customerId) {
  if (customerId == null) return false;
  const c = getCustomer(customerId);
  return !!(c && c.hide_operators_enabled);
}

function downloadsForVersion(id, storageKey) {
  const dir = versionDir(id, storageKey);
  return Object.keys(OUTPUT_FILES)
    .filter((f) => existsSync(path.join(dir, f)))
    .map((f) => ({ file: f, url: `/api/maps/${id}/versions/${storageKey}/${f}` }));
}

// Customer-facing download list: same as downloadsForVersion() but additionally
// hides any `buildAlways` output (the schematic) the map hasn't switched on for
// itself yet. It is rendered into every version regardless (see effectiveOutputs
// in maps/engine.js), so the raw file list would otherwise leak it before the
// customer ticks the visibility box. Non-output files (disagreements.pdf) always
// pass through. Admin-only views (review, revert, the diagram pin editor) use
// the raw downloadsForVersion() — an admin should see everything that exists.
function visibleDownloadsForVersion(id, storageKey, outputsConfig) {
  const visibleBases = new Set(
    outputsForClient(outputsConfig, id).filter((o) => o.enabled).map((o) => o.base),
  );
  return downloadsForVersion(id, storageKey).filter((d) => {
    const m = d.file.match(/^(.*)\.(svg|jpg)$/);
    return !m || visibleBases.has(m[1]);
  });
}

const parseJson = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

// Load a map's PENDING proposed update, scoped to that map. Returns { pu } or { code, error }.
function loadPendingProposed(mapId, pid) {
  const pu = getProposedUpdate(pid);
  if (!pu || pu.map_id !== mapId) return { code: 404, error: 'No such update for this map.' };
  if (pu.status !== 'pending') return { code: 409, error: `This update was already ${pu.status}.` };
  return { pu };
}

// A short, human phrase for a data-refresh change summary (goes on the version note).
function refreshNote(s) {
  if (!s || s.unchanged) return '';
  const bits = [];
  if (s.routesAdded && s.routesAdded.length) bits.push(`routes +${s.routesAdded.join('/')}`);
  if (s.routesRemoved && s.routesRemoved.length) bits.push(`routes −${s.routesRemoved.join('/')}`);
  if (s.stopsChanged && s.stopsChanged.length) bits.push(`${s.stopsChanged.length} route stop change${s.stopsChanged.length > 1 ? 's' : ''}`);
  if (s.descChanged && s.descChanged.length) bits.push(`${s.descChanged.length} description change${s.descChanged.length > 1 ? 's' : ''}`);
  if (s.validity) bits.push(`validity → ${s.validity.to || '—'}`);
  return bits.join(' · ');
}

function mapDetail(m) {
  const id = m.id;
  const meta = readRoutesMeta(id);
  const saved = readOverrides(id);
  const savedColors = saved.routeColors || {};
  const savedPois = (saved.internal && saved.internal.pois) || {};
  const order = (meta.routeOrder && meta.routeOrder.length ? meta.routeOrder : Object.keys(meta.palette));
  const routes = order
    .filter((r) => meta.palette[r])
    .map((r) => ({
      id: r, defaultColor: meta.palette[r], color: savedColors[r] || meta.palette[r],
      customised: !!savedColors[r], textOn: meta.textOn[r] || '#111', desc: meta.internalDesc[r] || null,
    }));
  const pois = enumeratePois(id).map((p) => ({ ...p, hidden: !!(savedPois[p.key] && savedPois[p.key].hide) }));
  const hideOperatorsEnabled = operatorFilterAllow(m.customer_id);
  const savedHiddenOps = new Set(Array.isArray(saved.hiddenOperators) ? saved.hiddenOperators : []);
  const operators = hideOperatorsEnabled ? meta.operatorNames.map((name) => ({ name, hidden: savedHiddenOps.has(name) })) : [];

  // Publish gate (P4): the pending request (if any) locks editing; the published
  // pointer + a diff of "what publishing the current head would change".
  const open = getOpenRequestForMap(id);
  const pendingVer = open ? getVersionById(open.version_id) : null;
  const pending = open ? {
    id: open.id, versionKey: pendingVer ? pendingVer.storage_key : null,
    note: open.note || '', createdAt: open.created_at,
  } : null;
  // The diff must count the DATA refreshes this head carries as well as the
  // customer's own overrides — see changeSummary()'s note and findings A1.
  const summary = m.cur_key
    ? changeSummary(saved, parseJson(m.pub_overrides), {
      palette: meta.palette,
      hasBaseline: !!m.pub_key,
      dataChanges: dataChangesSince(id, m.published_version_id, m.current_version_id),
    })
    : null;

  // Monthly change acceptance (P5): a staged data refresh awaiting accept/decline.
  const openProposed = getOpenProposedForMap(id);
  const proposedUpdate = openProposed ? {
    id: openProposed.id, sourceNote: openProposed.source_note || '',
    createdAt: openProposed.created_at, summary: parseJson(openProposed.summary_json),
  } : null;

  return {
    id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject, status: m.status,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    town: meta.town, currentVersion: m.cur_key || null, overrides: saved,
    routes, pois, hideOperatorsEnabled, operators, outputs: outputsForClient(parseOutputs(m.outputs), id, m.kind),
    // Every version, with the files that still exist and the overrides it was
    // rendered from — the editor lists them, so "earlier versions stay
    // available" is something the customer can see (findings H8).
    versions: listVersions(id).map((v) => ({
      id: v.id, storage_key: v.storage_key, note: v.note, review_state: v.review_state,
      created_at: v.created_at, overrides: parseJson(v.overrides_json),
      downloads: visibleDownloadsForVersion(id, v.storage_key, parseOutputs(m.outputs)),
    })),
    downloads: m.cur_key ? visibleDownloadsForVersion(id, m.cur_key, parseOutputs(m.outputs)) : [],
    // --- publish gate ---
    headState: m.cur_state || null,
    publishedVersion: m.pub_key || null,
    publishedDownloads: m.pub_key ? visibleDownloadsForVersion(id, m.pub_key, parseOutputs(m.outputs)) : [],
    pendingRequest: pending,
    editable: !pending, // locked while a publish request awaits review
    changeSummary: summary,
    publishHistory: listPublishRequestsForMap(id),
    // --- monthly change acceptance (P5) ---
    proposedUpdate,
    refreshHistory: listProposedForMap(id),
    // --- public page (P6) --- `publicUrl` is set only when the map really is
    // reachable by the public (asked of the same query the public site uses, so
    // the editor can never be told "you are live" when a suspension hides it).
    publicListed: !!m.public_listed,
    publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
    org: m.customer_id ? brandingForPublic(getCustomer(m.customer_id)) : null,
    // --- P8: "changes coming" banner ---
    bannerNote: m.banner_note || null,
    bannerNoteSource: m.banner_note_source || 'auto',
  };
}

app.get('/app', async (req, reply) => (req.user ? reply.sendFile('app/index.html') : reply.redirect('/app/login.html')));
app.get('/app/maps/:id', async (req, reply) => (req.user ? reply.sendFile('app/editor.html') : reply.redirect('/app/login.html')));
app.get('/app/branding', async (req, reply) => (req.user ? reply.sendFile('app/branding.html') : reply.redirect('/app/login.html')));
app.get('/app/admin', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'admin') return reply.redirect('/app');
  return reply.sendFile('app/admin.html');
});
app.get('/app/review', async (req, reply) => {
  if (!req.user) return reply.redirect('/app/login.html');
  if (req.user.role !== 'approver' && req.user.role !== 'admin') return reply.redirect('/app');
  return reply.sendFile('app/review.html');
});

app.get('/api/maps', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  if (user.role !== 'admin' && user.customer_id == null) return { ok: true, isAdmin: false, maps: [] };
  const scope = user.role === 'admin' ? {} : { customerId: user.customer_id };
  return {
    ok: true, isAdmin: user.role === 'admin',
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
  const poiKeys = enumeratePois(id).map((p) => p.key);
  const s = sanitizeOverrides((req.body || {}).overrides, {
    palette: meta.palette, poiKeys,
    operatorNames: meta.operatorNames, operatorFilterEnabled: operatorFilterAllow(map.customer_id),
  });
  try {
    const svg = await withMapLock(id, () => preview(id, s.overrides, parseOutputs(map.outputs)));
    return { ok: true, overrides: s.overrides, rejected: s.rejected, svg };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Preview render failed: ' + e.message });
  }
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
  const poiKeys = enumeratePois(id).map((p) => p.key);
  const b = req.body || {};
  const s = sanitizeOverrides(b.overrides, {
    palette: meta.palette, poiKeys,
    operatorNames: meta.operatorNames, operatorFilterEnabled: operatorFilterAllow(map.customer_id),
  });
  const { major, minor } = nextVersion(id);
  const storageKey = `v${major}.${minor}`;
  try {
    const r = await withMapLock(id, () => renderVersion(id, s.overrides, storageKey, parseOutputs(map.outputs)));
    const versionId = insertVersion({ map_id: id, major, minor, note: str(b.note, 500), overrides: s.overrides, storage_key: storageKey });
    setCurrentVersion(id, versionId);
    req.log.info({ mapId: id, version: storageKey, by: user.email }, 'saved new map version');
    logAudit(req, 'version.save', { mapId: id, versionId, detail: { version: storageKey, note: str(b.note, 500) } });
    return { ok: true, version: storageKey, rejected: s.rejected, files: r.files, downloads: visibleDownloadsForVersion(id, storageKey, parseOutputs(map.outputs)) };
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
  setMapOutputs(map.id, clean);
  req.log.info({ mapId: map.id, outputs: clean }, 'updated map outputs');
  return { ok: true, outputs: outputsForClient(clean, map.id, map.kind) };
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
      const poiKeys = enumeratePoisFromDir(stagedDir).map((p) => p.key);
      const after = sanitizeOverrides(saved, {
        palette: stagedMeta.palette, poiKeys,
        operatorNames: stagedMeta.operatorNames, operatorFilterEnabled: operatorFilterAllow(map.customer_id),
      }); // re-apply onto proposed data
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
      const poiKeys = enumeratePoisFromDir(stagedDir).map((p) => p.key);
      const reapplied = sanitizeOverrides(saved, {
        palette: stagedMeta.palette, poiKeys,
        operatorNames: stagedMeta.operatorNames, operatorFilterEnabled: operatorFilterAllow(map.customer_id),
      });
      // Render from the staged data BEFORE committing the swap.
      const rend = await renderVersion(id, reapplied.overrides, storageKey, outputs, stagedDir);
      // Render OK → make the staged data the live data (old data archived).
      swapInProposedData(id, pu.id);
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
  return reply.sendFile('app/diagram.html');
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
// Review & publish gate (P4) — approvers/admins review a submitted version.
// The customer who edits never publishes (separation of duties). Publishing
// requires a completed review checklist, records the change-summary evidence,
// advances the map's public-current pointer, and writes the audit trail.
// ===========================================================================

app.get('/api/review/queue', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  return { ok: true, requests: listPendingPublishRequests(), checklist: CHECKLIST };
});

app.get('/api/review/:id', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const pr = getPublishRequest(Number(req.params.id));
  if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
  const meta = readRoutesMeta(pr.map_id);
  const pub = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
  const summary = changeSummary(
    parseJson(pr.version_overrides), parseJson(pub ? pub.overrides_json : '{}'),
    {
      palette: meta.palette, hasBaseline: !!pub,
      // Bounded at the SUBMITTED version, so the reviewer reads what they are
      // signing off and not anything saved after it (findings A1).
      dataChanges: dataChangesSince(pr.map_id, pr.published_version_id, pr.version_id),
    },
  );
  const decided = pr.status !== 'pending';
  return {
    ok: true,
    request: {
      id: pr.id, status: pr.status, createdAt: pr.created_at, note: pr.note || '',
      map: { id: pr.map_id, name: pr.map_name, slug: pr.map_slug, kind: pr.map_kind, subject: pr.map_subject },
      customer: pr.customer_id ? { id: pr.customer_id, name: pr.customer_name } : null,
      version: pr.version_key, versionNote: pr.version_note || '',
      publishedVersion: pub ? pub.storage_key : null,
      requestedBy: pr.requested_by_email || null,
      reviewedBy: pr.reviewed_by_email || null, reviewedAt: pr.reviewed_at || null,
      decisionNote: pr.decision_note || '',
      evidence: decided ? parseJson(pr.evidence_json) : null,
    },
    changeSummary: summary,
    checklist: CHECKLIST,
    // Files to eyeball before signing off (approver read-access is enforced above).
    inspect: downloadsForVersion(pr.map_id, pr.version_key),
    town: meta.town,
  };
});

// Checklist item `alternative` asks the approver to open the map's text
// alternative and check it — but the map may not be published yet (a first
// submission has no public page at all), and even when it is, the PUBLIC
// /m/:slug/services route serves the PUBLISHED version's facts, not the one
// under review. So this builds the SUBMITTED version's own facts straight
// from its render folder, same read as factsForPublicMap() but keyed off the
// pending version rather than the published pointer — the approver always
// previews exactly what they are about to sign off, whether or not anything
// has ever been published before.
app.get('/api/review/:id/services', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const pr = getPublishRequest(Number(req.params.id));
  if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
  const dir = versionDir(pr.map_id, pr.version_key);
  const facts = readFactsSnapshot(dir) || buildFacts(mapDataDir(pr.map_id), { kind: pr.map_kind });
  const services = publicServices({ subject: pr.map_subject, name: pr.map_name }, facts);
  if (!services) return reply.code(404).send({ ok: false, error: 'This version has no service list.' });
  return {
    ok: true,
    map: { name: pr.map_name, kind: pr.map_kind, version: pr.version_key },
    services,
  };
});

app.post('/api/review/:id/approve', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const pr = getPublishRequest(Number(req.params.id));
  if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
  if (pr.status !== 'pending') return reply.code(409).send({ ok: false, error: `This request was already ${pr.status}.` });

  // The review gate: every checklist item must be confirmed. No exceptions —
  // it is public transit information people rely on.
  const { ok, missing, checklist } = validateChecklist((req.body || {}).checklist);
  if (!ok) return reply.code(400).send({ ok: false, error: 'Please confirm every item on the review checklist before publishing.', missing });

  const meta = readRoutesMeta(pr.map_id);
  const pub = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
  const summary = changeSummary(
    parseJson(pr.version_overrides), parseJson(pub ? pub.overrides_json : '{}'),
    {
      palette: meta.palette, hasBaseline: !!pub,
      // Bounded at the SUBMITTED version, so the reviewer reads what they are
      // signing off and not anything saved after it (findings A1).
      dataChanges: dataChangesSince(pr.map_id, pr.published_version_id, pr.version_id),
    },
  );
  const decisionNote = str((req.body || {}).note, 2000);
  const evidence = { checklistVersion: CHECKLIST_VERSION, checklist, changeSummary: summary, decidedAt: new Date().toISOString() };

  decidePublishRequest(pr.id, { status: 'approved', reviewedBy: user.id, decisionNote, evidence });
  // Advance the public-current pointer; retire the previous published version.
  if (pr.published_version_id && pr.published_version_id !== pr.version_id) setVersionState(pr.published_version_id, 'superseded');
  setVersionState(pr.version_id, 'published');
  setPublishedVersion(pr.map_id, pr.version_id);
  setMapStatus(pr.map_id, 'published');
  // The newly-published data is presumed to reflect any change the banner warned
  // about — clear it. (If it still applies, the GTFS scan or an admin re-sets it.)
  clearMapBannerNote(pr.map_id);
  // P9 — index the place names this version actually shows, from the live data
  // dir at this exact moment (never re-read later, so it can't drift ahead of
  // what was reviewed). See src/search/place-index.js.
  const mapRow = getMap(pr.map_id);
  writePlacesSidecar(pr.map_id, pr.version_key, { kind: mapRow.kind, subject: mapRow.subject });
  bumpSearchIndex();

  req.log.info({ mapId: pr.map_id, requestId: pr.id, version: pr.version_key, by: user.email }, 'version published');
  logAudit(req, 'version.publish', { mapId: pr.map_id, versionId: pr.version_id, detail: { requestId: pr.id, version: pr.version_key, changeSummary: summary, note: decisionNote } });
  // Tell the people whose map it is (findings B2). Deliberately after every
  // state change and the audit row: the publication has happened whether or not
  // the email does, and notify() never throws.
  //
  // suppressNotify: true skips this one call — the ONLY caller is the laptop
  // batch script (scripts/accept-publish-batch.mjs), which collects every map
  // it publishes in a run and asks for one grouped digest per customer via
  // POST /api/admin/notify-published-batch instead, so a 12-map round sends
  // one email per customer, not twelve. The interactive review screen never
  // sends this flag, so a human approving one map through the UI is unaffected.
  if ((req.body || {}).suppressNotify !== true) {
    notify('published', {
      customerId: pr.customer_id, log: req.log,
      mapName: pr.map_name, versionKey: pr.version_key,
      mapUrl: appUrl(`/app/maps/${pr.map_id}`),
      publicUrl: mapRow.public_listed && getPublicMapBySlug(mapRow.slug) ? appUrl(mapPageUrl(mapRow.slug)) : null,
    });
  }
  return {
    ok: true, publishedVersion: pr.version_key, downloads: downloadsForVersion(pr.map_id, pr.version_key),
    customerId: pr.customer_id,
    publicUrl: mapRow.public_listed && getPublicMapBySlug(mapRow.slug) ? appUrl(mapPageUrl(mapRow.slug)) : null,
  };
});

app.post('/api/review/:id/reject', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const pr = getPublishRequest(Number(req.params.id));
  if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
  if (pr.status !== 'pending') return reply.code(409).send({ ok: false, error: `This request was already ${pr.status}.` });
  const note = str((req.body || {}).note, 2000);
  if (!note) return reply.code(400).send({ ok: false, error: 'Please give a reason so the editor knows what to change.', fields: ['note'] });

  decidePublishRequest(pr.id, { status: 'rejected', reviewedBy: user.id, decisionNote: note, evidence: {} });
  // Return the version to draft (unless it somehow is the published one) so the editor can revise + resubmit.
  if (pr.version_id !== pr.published_version_id) setVersionState(pr.version_id, 'rejected');
  req.log.info({ mapId: pr.map_id, requestId: pr.id, by: user.email }, 'publication rejected');
  logAudit(req, 'version.reject', { mapId: pr.map_id, versionId: pr.version_id, detail: { requestId: pr.id, version: pr.version_key, note } });
  // The one state change the customer has no other way of learning about: their
  // map simply becomes editable again (findings B2).
  const publishedNow = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
  notify('sent-back', {
    customerId: pr.customer_id, log: req.log,
    mapName: pr.map_name, versionKey: pr.version_key, reason: note,
    publishedVersion: publishedNow ? publishedNow.storage_key : null,
    mapUrl: appUrl(`/app/maps/${pr.map_id}`),
  });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Rollback (incident response). When a published version turns out to be wrong,
// the fast mitigation is un-listing it, but the FIX is serving a known-good
// version again. These two routes make that one click for an approver instead of
// a re-run through the whole gate:
//
//   GET  /api/review/published                → maps with a published version
//   GET  /api/review/maps/:id/published-history → the versions ever published
//   POST /api/review/maps/:id/revert           → move the pointer back to one
//
// It is deliberately NOT a general "publish anything" button: the only versions
// on offer are ones an approver already reviewed (they have an approved
// publish_request), and whose rendered files are still on disk. So reverting can
// never serve bytes that never passed the gate. A reason is required and the whole
// thing is audited.
// ---------------------------------------------------------------------------

app.get('/api/review/published', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const maps = listPublishedMaps().map((m) => ({
    id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    customerSuspended: m.customer_status === 'suspended',
    publishedVersion: m.pub_key, publishedVersions: m.published_versions,
    // A revert needs somewhere to go back TO — flag the maps where one is possible.
    canRevert: m.published_versions > 1,
    publicListed: !!m.public_listed,
    publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
  }));
  return { ok: true, maps };
});

/** Publication history for one map: which versions were published, when, by whom. */
function publishedHistoryFor(map) {
  return listPublishedHistory(map.id).map((h) => {
    const files = downloadsForVersion(map.id, h.storage_key);
    return {
      versionId: h.version_id, version: h.storage_key,
      publishedAt: h.published_at, approver: h.approver_email || null,
      decisionNote: h.decision_note || '',
      isCurrent: !!h.is_current,
      files,
      // No rendered files (pruned/lost) ⇒ nothing to serve ⇒ not revertable.
      revertable: !h.is_current && files.length > 0,
    };
  });
}

app.get('/api/review/maps/:id/published-history', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const m = getMap(Number(req.params.id));
  if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
  const history = publishedHistoryFor(m);
  return {
    ok: true,
    map: {
      id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject,
      customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
      publishedVersion: m.pub_key || null, currentVersion: m.cur_key || null,
      publicListed: !!m.public_listed,
      publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
    },
    history,
  };
});

app.post('/api/review/maps/:id/revert', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const m = getMap(Number(req.params.id));
  if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
  if (!m.published_version_id) {
    return reply.code(409).send({ ok: false, error: 'This map has no published version, so there is nothing to revert.' });
  }
  const b = req.body || {};
  const reason = str(b.reason, 2000);
  if (!reason) {
    return reply.code(400).send({ ok: false, error: 'Please record why you are reverting — it goes in the audit trail and the incident log.', fields: ['reason'] });
  }
  // An open publish request would leave an approver reviewing a version while the
  // pointer moves under them; make the order explicit rather than racing it.
  const open = getOpenRequestForMap(m.id);
  if (open) {
    return reply.code(409).send({ ok: false, error: 'A version of this map is awaiting review. Decide that request first, then revert.' });
  }

  // Which version to serve again (default: the one published before this). The
  // rules live in src/publish so they are unit-tested away from HTTP.
  const chosen = chooseRevertTarget(publishedHistoryFor(m), b.versionId != null ? Number(b.versionId) : null);
  if (chosen.error) return reply.code(chosen.code).send({ ok: false, error: chosen.error });
  const target = chosen.target;

  const from = getVersionById(m.published_version_id);
  // Move the public-current pointer back. The editor's working head is untouched:
  // reverting is about what the public is served, not about undoing their edits.
  setVersionState(m.published_version_id, 'superseded');
  setVersionState(target.versionId, 'published');
  setPublishedVersion(m.id, target.versionId);
  setMapStatus(m.id, 'published');
  bumpSearchIndex(); // P9 — the reverted-to version has its own places.json from when it was published

  req.log.warn({ mapId: m.id, from: from ? from.storage_key : null, to: target.version, by: user.email }, 'published version reverted');
  logAudit(req, 'version.revert', {
    mapId: m.id, versionId: target.versionId,
    detail: {
      from: from ? from.storage_key : null, to: target.version,
      reason, publishedAt: target.publishedAt, approver: target.approver,
      stillListed: !!m.public_listed,
    },
  });
  return {
    ok: true,
    publishedVersion: target.version,
    revertedFrom: from ? from.storage_key : null,
    downloads: downloadsForVersion(m.id, target.version),
    publicUrl: getPublicMapBySlug(m.slug) ? mapPageUrl(m.slug) : null,
    publicListed: !!m.public_listed,
  };
});

// ===========================================================================
// Admin console (P3) — application review, map-request lifecycle, customers.
// Every route is admin-only (403 for signed-in non-admins, 401 for anon).
// ===========================================================================

app.get('/api/admin/summary', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  return { ok: true, summary: { ...adminSummary(), ...publicCounts() } };
});

// The To-do list: every queue above, ranked by who is blocked, in one response.
// The admin console's landing tab renders this, and the operator's bus-work
// skill consumes the same shape (importing src/worklist/index.js directly when
// it runs beside the portal, GETting this when the portal is remote) — so the
// console and the laptop can never show two different lists.
//
// Links are absolute against the request's own origin so they stay clickable
// when the caller is a terminal on another machine.
app.get('/api/admin/worklist', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const baseUrl = `${req.protocol}://${req.headers.host}`;
  return { ok: true, worklist: buildWorklist({ baseUrl }) };
});

app.get('/api/admin/applications', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const status = ['pending', 'approved', 'rejected'].includes((req.query || {}).status) ? req.query.status : undefined;
  return { ok: true, applications: listApplications({ status }) };
});

// Approve an application: create the customer, its first editor user, and issue
// a passwordless invite (printed to the server console; surfaced to the admin in
// dev so the loop is demoable without email).
app.post('/api/admin/applications/:id/approve', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const appn = getApplication(Number(req.params.id));
  if (!appn) return reply.code(404).send({ ok: false, error: 'No such application.' });
  if (appn.status !== 'pending') return reply.code(409).send({ ok: false, error: `Already ${appn.status}.` });

  const email = str(appn.email, 200).toLowerCase();
  if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'The application has no valid contact email.' });
  if (getUserByEmail(email)) {
    return reply.code(409).send({ ok: false, error: `${email} already has an account. Approve this organisation manually or ask them to sign in.` });
  }

  const b = req.body || {};
  const type = ORG_TYPES.includes(appn.org_type) ? appn.org_type : 'other';
  const quota_areas = b.quotaAreas != null ? Math.max(0, Number(b.quotaAreas) | 0) : 1;
  const quota_places = b.quotaPlaces != null ? Math.max(0, Number(b.quotaPlaces) | 0) : 3;

  const customerId = insertCustomer({ name: appn.org_name, type, quota_areas, quota_places });
  insertUser({ customer_id: customerId, email, name: str(b.editorName, 120) || appn.contact_name, role: 'editor' });
  setApplicationReviewed(appn.id, 'approved', customerId);

  const token = requestMagicLink(email);
  const link = token ? authLink(req, token) : null;
  if (link) {
    try {
      const r = await sendMagicLink({ to: email, link, kind: 'invite' });
      if (!r.sent) console.log(`\n🔗  Invite (sign-in) link for ${email}:\n    ${link}\n`);
    } catch (e) {
      req.log.error({ email, err: e.message }, 'invite email failed to send');
    }
  }
  req.log.info({ applicationId: appn.id, customerId, email }, 'application approved → customer + editor created');
  logAudit(req, 'application.approve', { detail: { applicationId: appn.id, customerId, org: appn.org_name, email, quotaAreas: quota_areas, quotaPlaces: quota_places } });

  return {
    ok: true,
    customer: { id: customerId, name: appn.org_name, type, quotaAreas: quota_areas, quotaPlaces: quota_places },
    user: { email },
    inviteLink: DEV_LINKS ? link : undefined,
  };
});

app.post('/api/admin/applications/:id/reject', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const appn = getApplication(Number(req.params.id));
  if (!appn) return reply.code(404).send({ ok: false, error: 'No such application.' });
  if (appn.status !== 'pending') return reply.code(409).send({ ok: false, error: `Already ${appn.status}.` });
  setApplicationReviewed(appn.id, 'rejected', null);
  req.log.info({ applicationId: appn.id }, 'application rejected');
  logAudit(req, 'application.reject', { detail: { applicationId: appn.id, org: appn.org_name } });
  return { ok: true };
});

// Map-request queue + lifecycle. Approving accepts the request (the central
// pipeline builds the data later); rejecting archives it and frees the quota slot.
//
// `awaitingBuild` is the other half of that lifecycle: approved requests the
// pipeline has yet to build. The importer fulfils one IN PLACE
// (`import-map.mjs --request <id>`), so the placeholder row becomes the built map
// — no duplicate row to archive, and quota counts the map once. Each row carries
// the exact command, so the admin console is the single place the build starts.
app.get('/api/admin/map-requests', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const shape = (m) => ({
    id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject, requestNote: m.request_note,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    requestedBy: m.requested_by_email || null, createdAt: m.created_at, status: m.status,
  });
  return {
    ok: true,
    requests: listMapsByStatus(['requested']).map(shape),
    awaitingBuild: listAwaitingBuild().map((m) => ({
      ...shape(m),
      importCommand: `node scripts/import-map.mjs --request ${m.id} --src "<S5-render dir>"`,
    })),
  };
});

app.post('/api/admin/maps/:id/approve', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const m = getMap(Number(req.params.id));
  if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
  if (m.status !== 'requested') return reply.code(409).send({ ok: false, error: `This map is "${m.status}", not a pending request.` });
  setMapStatus(m.id, 'approved');
  req.log.info({ mapId: m.id }, 'map request approved');
  logAudit(req, 'maprequest.approve', { mapId: m.id, detail: { name: m.name, kind: m.kind } });
  return { ok: true, status: 'approved' };
});

// Archive a request. Valid for a request still pending AND for one already
// approved but never built (plans change) — either way the quota slot is freed.
// Once a map has been built it has renders and possibly a public page, so it
// leaves this lifecycle: archiving it is not a request decision.
app.post('/api/admin/maps/:id/reject', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const m = getMap(Number(req.params.id));
  if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
  const unbuiltApproved = m.status === 'approved' && !m.current_version_id;
  if (m.status !== 'requested' && !unbuiltApproved) {
    return reply.code(409).send({
      ok: false,
      error: m.current_version_id
        ? `"${m.name}" has already been built (${m.cur_key}) — it is no longer a request.`
        : `This map is "${m.status}", not a pending or awaiting-build request.`,
    });
  }
  setMapStatus(m.id, 'archived');
  req.log.info({ mapId: m.id, from: m.status }, 'map request archived');
  logAudit(req, 'maprequest.reject', { mapId: m.id, detail: { name: m.name, kind: m.kind, from: m.status } });
  return { ok: true, status: 'archived' };
});

app.get('/api/admin/customers', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const rows = listCustomersAdmin().map((c) => ({
    id: c.id, name: c.name, type: c.type, status: c.status, plan: c.plan,
    quotaAreas: c.quota_areas, quotaPlaces: c.quota_places,
    usedAreas: c.area_used, usedPlaces: c.place_used, users: c.users, createdAt: c.created_at,
    // P6 — where the organisation appears publicly, and how it has branded itself.
    slug: c.slug || null, publicUrl: c.slug ? orgPageUrl(c.slug) : null,
    branding: parseJson(c.branding_json),
    hideOperatorsEnabled: !!c.hide_operators_enabled,
    watermarkEnabled: !!c.watermark_enabled,
  }));
  return { ok: true, customers: rows };
});

app.patch('/api/admin/customers/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const cust = getCustomer(Number(req.params.id));
  if (!cust) return reply.code(404).send({ ok: false, error: 'No such customer.' });
  const b = req.body || {};
  const ok = updateCustomerAdmin(cust.id, {
    quota_areas: b.quotaAreas, quota_places: b.quotaPlaces, status: b.status, plan: b.plan,
    hide_operators_enabled: b.hideOperatorsEnabled, watermark_enabled: b.watermarkEnabled,
  });
  if (!ok) return reply.code(400).send({ ok: false, error: 'Nothing valid to update.' });
  if (b.status !== undefined) bumpSearchIndex(); // P9 — a suspended org's maps must stop being searchable
  req.log.info({ customerId: cust.id }, 'customer updated by admin');
  const c = getCustomer(cust.id);
  logAudit(req, 'customer.update', { detail: { customerId: c.id, name: c.name, quotaAreas: c.quota_areas, quotaPlaces: c.quota_places, status: c.status, plan: c.plan, hideOperatorsEnabled: !!c.hide_operators_enabled, watermarkEnabled: !!c.watermark_enabled } });
  return { ok: true, customer: { id: c.id, name: c.name, status: c.status, plan: c.plan, quotaAreas: c.quota_areas, quotaPlaces: c.quota_places, hideOperatorsEnabled: !!c.hide_operators_enabled, watermarkEnabled: !!c.watermark_enabled } };
});

// User CRUD (admin-only). Invite adds another person to an existing customer
// (or, with no customerId, a platform admin); update/disable are the same
// PATCH — status:'disabled' is how an account is switched off, mirroring the
// customer status pattern above. No delete: disabling is the reversible,
// audit-preserving equivalent (sessions and history keep referencing the row).
const userShape = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  customerId: u.customer_id, customerName: u.customer_name || null, createdAt: u.created_at,
});

app.get('/api/admin/users', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const q = req.query || {};
  const customerId = q.customerId != null && q.customerId !== '' ? Number(q.customerId) : undefined;
  return { ok: true, users: listUsersAdmin(customerId).map(userShape) };
});

app.post('/api/admin/users', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const b = req.body || {};
  const email = str(b.email, 200).toLowerCase();
  if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'A valid email is required.' });
  if (getUserByEmail(email)) return reply.code(409).send({ ok: false, error: `${email} already has an account.` });

  let customerId = null;
  if (b.customerId != null && b.customerId !== '') {
    const cust = getCustomer(Number(b.customerId));
    if (!cust) return reply.code(404).send({ ok: false, error: 'No such customer.' });
    customerId = cust.id;
  }
  const role = ['editor', 'approver', 'admin'].includes(b.role) ? b.role : 'editor';

  const userId = insertUser({ customer_id: customerId, email, name: str(b.name, 120) || null, role });
  const token = requestMagicLink(email);
  const link = token ? authLink(req, token) : null;
  if (link) {
    try {
      const r = await sendMagicLink({ to: email, link, kind: 'invite' });
      if (!r.sent) console.log(`\n🔗  Invite (sign-in) link for ${email}:\n    ${link}\n`);
    } catch (e) {
      req.log.error({ email, err: e.message }, 'invite email failed to send');
    }
  }
  req.log.info({ userId, customerId, email, role }, 'user invited by admin');
  logAudit(req, 'user.invite', { detail: { userId, customerId, email, role } });
  return { ok: true, user: userShape(getUser(userId)), inviteLink: DEV_LINKS ? link : undefined };
});

app.patch('/api/admin/users/:id', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const u = getUser(Number(req.params.id));
  if (!u) return reply.code(404).send({ ok: false, error: 'No such user.' });
  const b = req.body || {};
  if (b.status === 'disabled' && u.id === req.user.id) {
    return reply.code(400).send({ ok: false, error: 'You cannot disable your own account.' });
  }
  let customerId; // undefined = leave alone
  if ('customerId' in b) {
    if (b.customerId == null || b.customerId === '') {
      customerId = null;
    } else {
      const cust = getCustomer(Number(b.customerId));
      if (!cust) return reply.code(404).send({ ok: false, error: 'No such customer.' });
      customerId = cust.id;
    }
  }
  const fromCustomer = u.customer_id ? getCustomer(u.customer_id) : null;
  const ok = updateUserAdmin(u.id, { name: b.name, role: b.role, status: b.status, customerId });
  if (!ok) return reply.code(400).send({ ok: false, error: 'Nothing valid to update.' });
  const updated = getUser(u.id);
  req.log.info({ userId: u.id }, 'user updated by admin');
  logAudit(req, 'user.update', { detail: { userId: u.id, email: updated.email, role: updated.role, status: updated.status, customerId: updated.customer_id } });
  if (customerId !== undefined && customerId !== u.customer_id) {
    const toCustomer = customerId ? getCustomer(customerId) : null;
    req.log.info({ userId: u.id, from: u.customer_id, to: customerId }, 'user reassigned to another organisation by admin');
    logAudit(req, 'user.reassign', {
      detail: {
        userId: u.id, email: updated.email,
        fromCustomerId: u.customer_id, fromCustomerName: fromCustomer ? fromCustomer.name : null,
        toCustomerId: customerId, toCustomerName: toCustomer ? toCustomer.name : null,
      },
    });
  }
  return { ok: true, user: userShape(updated) };
});

app.get('/api/admin/messages', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  return { ok: true, messages: listMessages() };
});

// Read-only view of the monthly-refresh queue (P5) — proposed updates awaiting a
// customer's accept/decline. Staged by the central pipeline (propose-update.mjs).
app.get('/api/admin/proposed-updates', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const updates = listPendingProposedUpdates().map((pu) => ({
    id: pu.id, createdAt: pu.created_at, sourceNote: pu.source_note || '',
    summary: parseJson(pu.summary_json),
    map: { id: pu.map_id, name: pu.map_name, kind: pu.map_kind, subject: pu.map_subject },
    customer: pu.customer_name || null,
  }));
  return { ok: true, updates };
});

// One grouped "N maps published" email per customer, for a scripted batch that
// published several maps with suppressNotify:true on each individual approve
// (see the comment on /api/review/:id/approve). Never called by the UI — the
// review screen always sends its own single notify('published', ...) inline.
// Grouping happens HERE, server-side, so the digest wording and the recipient
// lookup stay in one tested place (src/email/notify.js) rather than being
// duplicated in a laptop script that has no access to EMAIL_PROVIDER anyway.
app.post('/api/admin/notify-published-batch', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const items = Array.isArray((req.body || {}).items) ? (req.body || {}).items : [];
  const byCustomer = new Map();
  for (const it of items) {
    if (it == null || it.customerId == null || !it.mapName || !it.mapUrl) continue;
    if (!byCustomer.has(it.customerId)) byCustomer.set(it.customerId, []);
    byCustomer.get(it.customerId).push({ mapName: it.mapName, versionKey: it.versionKey, mapUrl: it.mapUrl });
  }
  const results = [];
  for (const [customerId, maps] of byCustomer) {
    const r = await notify('published-batch', { customerId, maps, log: req.log });
    results.push({ customerId, maps: maps.length, ...r });
  }
  req.log.info({ customers: results.length, items: items.length }, 'published-batch digest sent');
  return { ok: true, results };
});

// Operational snapshot (P7): readiness, disk usage per map, and the counts an
// operator watches. Same numbers as /metrics, shaped for the admin console.
app.get('/api/admin/ops', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  return { ok: true, ops: await opsSnapshot(VERSION) };
});

// Append-only governance audit trail (publish reviews + P3 actions).
app.get('/api/admin/audit', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const limit = Math.max(1, Math.min(1000, Number((req.query || {}).limit) || 200));
  const rows = listAudit({ limit }).map((a) => ({
    id: a.id, at: a.created_at, actor: a.actor_email || 'system', action: a.action,
    mapId: a.map_id, mapName: a.map_name || null, versionId: a.version_id,
    detail: parseJson(a.detail_json),
  }));
  return { ok: true, audit: rows };
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`BusMaps.uk portal (${VERSION}) → http://${HOST}:${PORT}`);
  setInterval(() => { try { purgeExpiredSessions(); } catch {} }, 3_600_000).unref();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
