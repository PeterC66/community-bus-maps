// Community Bus Maps — portal server.
//   P0: public shopfront (apply / contact / health).
//   P1: safe-subset editor (object store, versioned save→render→download).
//   P2: passwordless auth, multi-customer tenant isolation, per-map output toggles.

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  insertApplication, insertMessage, counts, authCounts,
  listMaps, getMap, getMapBySlug, insertMap, nextVersion, insertVersion, setCurrentVersion, listVersions,
  setMapOutputs, setMapStatus, listMapsByStatus, quotaUsage, getCustomer, purgeExpiredSessions,
  listApplications, getApplication, setApplicationReviewed, listMessages,
  insertCustomer, insertUser, getUserByEmail,
  listCustomersAdmin, updateCustomerAdmin, adminSummary,
  getVersionById, setVersionState, setPublishedVersion,
  insertPublishRequest, getOpenRequestForMap, getPublishRequest, listPendingPublishRequests,
  decidePublishRequest, withdrawPublishRequest, listPublishRequestsForMap, listAudit,
} from './db/index.js';
import {
  readRoutesMeta, enumeratePois, readOverrides, preview, renderVersion, outputsForClient,
} from './maps/engine.js';
import { sanitizeOverrides } from './maps/safeSubset.js';
import { versionDir, OUTPUTS, OUTPUT_FILES } from './maps/store.js';
import {
  requestMagicLink, verifyMagicLink, resolveUser, logout, sessionCookie, clearCookie,
} from './auth/index.js';
import { CHECKLIST, CHECKLIST_VERSION, validateChecklist, changeSummary } from './publish/index.js';
import { logAudit } from './audit/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = '0.4.0-P4';

const ORG_TYPES = ['council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt', 'other'];
const MSG_KINDS = ['enquiry', 'question', 'feedback'];
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

const app = Fastify({ logger: true, bodyLimit: 256 * 1024 });

await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });

// Resolve the signed-in user (from the session cookie) for app/api/auth routes.
app.addHook('preHandler', async (req) => {
  req.user = null;
  const u = req.url;
  if (u.startsWith('/api/') || u.startsWith('/app') || u.startsWith('/auth/')) req.user = resolveUser(req);
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

app.get('/health', async () => ({
  status: 'ok', service: 'community-bus-maps', version: VERSION,
  time: new Date().toISOString(), ...counts(), ...authCounts(),
}));

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
// Auth (P2) — passwordless magic links + server-side sessions
// ===========================================================================

app.post('/api/auth/request', async (req, reply) => {
  if (rateLimited(req.ip, 10)) return reply.code(429).send({ ok: false, error: 'Too many requests — please wait a moment.' });
  const email = str((req.body || {}).email, 200).toLowerCase();
  if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'Please enter a valid email address.', fields: ['email'] });

  const token = requestMagicLink(email);
  if (token) {
    const link = `${req.protocol}://${req.headers.host}/auth/verify?token=${token}`;
    // DEV: no email provider yet — print the link to the SERVER CONSOLE.
    console.log(`\n🔗  Sign-in link for ${email}:\n    ${link}\n`);
    req.log.info({ email }, 'magic link issued (see console)');
  } else {
    req.log.info({ email }, 'magic link requested for unknown/inactive email (no-op)');
  }
  // Identical response whether or not the email is registered (no enumeration).
  return { ok: true, message: 'If that address is registered, a sign-in link has been sent. In local dev the link is printed to the server console.' };
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
      } : null,
    },
  };
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

// Publishing is a platform sign-off (separation of duties from the customer who
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
// print-ready files to sign it off — but cannot edit it.
function loadReadableMap(id, user) {
  const m = getMap(id);
  if (!m) return { code: 404, error: 'No such map.' };
  const owner = user.customer_id != null && m.customer_id === user.customer_id;
  if (user.role === 'admin' || user.role === 'approver' || owner) return { map: m };
  return { code: 403, error: 'You do not have access to this map.' };
}

function downloadsForVersion(id, storageKey) {
  const dir = versionDir(id, storageKey);
  return Object.keys(OUTPUT_FILES)
    .filter((f) => existsSync(path.join(dir, f)))
    .map((f) => ({ file: f, url: `/api/maps/${id}/versions/${storageKey}/${f}` }));
}

const parseJson = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

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

  // Publish gate (P4): the pending request (if any) locks editing; the published
  // pointer + a diff of "what publishing the current head would change".
  const open = getOpenRequestForMap(id);
  const pendingVer = open ? getVersionById(open.version_id) : null;
  const pending = open ? {
    id: open.id, versionKey: pendingVer ? pendingVer.storage_key : null,
    note: open.note || '', createdAt: open.created_at,
  } : null;
  const summary = m.cur_key
    ? changeSummary(saved, parseJson(m.pub_overrides), { palette: meta.palette, hasBaseline: !!m.pub_key })
    : null;

  return {
    id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject, status: m.status,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    town: meta.town, currentVersion: m.cur_key || null, overrides: saved,
    routes, pois, outputs: outputsForClient(parseOutputs(m.outputs), id),
    versions: listVersions(id),
    downloads: m.cur_key ? downloadsForVersion(id, m.cur_key) : [],
    // --- publish gate ---
    headState: m.cur_state || null,
    publishedVersion: m.pub_key || null,
    publishedDownloads: m.pub_key ? downloadsForVersion(id, m.pub_key) : [],
    pendingRequest: pending,
    editable: !pending, // locked while a publish request awaits sign-off
    changeSummary: summary,
    publishHistory: listPublishRequestsForMap(id),
  };
}

app.get('/app', async (req, reply) => (req.user ? reply.sendFile('app/index.html') : reply.redirect('/app/login.html')));
app.get('/app/maps/:id', async (req, reply) => (req.user ? reply.sendFile('app/editor.html') : reply.redirect('/app/login.html')));
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
  const s = sanitizeOverrides((req.body || {}).overrides, { palette: meta.palette, poiKeys });
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
  // Editing is frozen while a version awaits publication sign-off — withdraw the
  // request first, so the version an approver reviews is always the head.
  if (getOpenRequestForMap(id)) {
    return reply.code(409).send({ ok: false, error: 'This map is awaiting publication sign-off. Withdraw the request to make further changes.' });
  }
  const meta = readRoutesMeta(id);
  const poiKeys = enumeratePois(id).map((p) => p.key);
  const b = req.body || {};
  const s = sanitizeOverrides(b.overrides, { palette: meta.palette, poiKeys });
  const { major, minor } = nextVersion(id);
  const storageKey = `v${major}.${minor}`;
  try {
    const r = await withMapLock(id, () => renderVersion(id, s.overrides, storageKey, parseOutputs(map.outputs)));
    const versionId = insertVersion({ map_id: id, major, minor, note: str(b.note, 500), overrides: s.overrides, storage_key: storageKey });
    setCurrentVersion(id, versionId);
    req.log.info({ mapId: id, version: storageKey, by: user.email }, 'saved new map version');
    logAudit(req, 'version.save', { mapId: id, versionId, detail: { version: storageKey, note: str(b.note, 500) } });
    return { ok: true, version: storageKey, rejected: s.rejected, files: r.files, downloads: downloadsForVersion(id, storageKey) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Render failed: ' + e.message });
  }
});

// --- publish gate: the editor submits the current head for sign-off, or
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
    return reply.code(409).send({ ok: false, error: 'This map is already awaiting publication sign-off.' });
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
app.patch('/api/maps/:id/outputs', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const incoming = (req.body || {}).outputs || {};
  const clean = {};
  for (const [key, meta] of Object.entries(OUTPUTS)) {
    if (!meta.portal) continue; // schematic/diagram not selectable yet
    clean[key] = typeof incoming[key] === 'boolean' ? incoming[key] : true;
  }
  if (!Object.values(clean).some(Boolean)) return reply.code(400).send({ ok: false, error: 'A map must produce at least one output.' });
  setMapOutputs(map.id, clean);
  req.log.info({ mapId: map.id, outputs: clean }, 'updated map outputs');
  return { ok: true, outputs: outputsForClient(clean, map.id) };
});

app.get('/api/maps/:id/versions/:key/:file', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadReadableMap(Number(req.params.id), user);
  if (!map) return reply.code(code).send({ ok: false, error });
  const { key, file } = req.params;
  if (!/^v\d+\.\d+$/.test(key) || !Object.prototype.hasOwnProperty.call(OUTPUT_FILES, file)) {
    return reply.code(400).send({ ok: false, error: 'Bad version or file.' });
  }
  const p = path.join(versionDir(map.id, key), file);
  if (!existsSync(p)) return reply.code(404).send({ ok: false, error: 'Not found.' });
  reply.header('Content-Type', OUTPUT_FILES[file]);
  if (req.query && 'download' in req.query) {
    reply.header('Content-Disposition', `attachment; filename="${map.slug}-${key}-${file}"`);
  }
  return reply.send(createReadStream(p));
});

// ===========================================================================
// Review & publish gate (P4) — approvers/admins sign off a submitted version.
// The customer who edits never publishes (separation of duties). Publishing
// requires a completed sign-off checklist, records the change-summary evidence,
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
    { palette: meta.palette, hasBaseline: !!pub },
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

app.post('/api/review/:id/approve', async (req, reply) => {
  const user = requireApprover(req, reply); if (!user) return;
  const pr = getPublishRequest(Number(req.params.id));
  if (!pr) return reply.code(404).send({ ok: false, error: 'No such publish request.' });
  if (pr.status !== 'pending') return reply.code(409).send({ ok: false, error: `This request was already ${pr.status}.` });

  // The sign-off gate: every checklist item must be confirmed. No exceptions —
  // it is public transit information people rely on.
  const { ok, missing, checklist } = validateChecklist((req.body || {}).checklist);
  if (!ok) return reply.code(400).send({ ok: false, error: 'Please confirm every item on the sign-off checklist before publishing.', missing });

  const meta = readRoutesMeta(pr.map_id);
  const pub = pr.published_version_id ? getVersionById(pr.published_version_id) : null;
  const summary = changeSummary(
    parseJson(pr.version_overrides), parseJson(pub ? pub.overrides_json : '{}'),
    { palette: meta.palette, hasBaseline: !!pub },
  );
  const decisionNote = str((req.body || {}).note, 2000);
  const evidence = { checklistVersion: CHECKLIST_VERSION, checklist, changeSummary: summary, decidedAt: new Date().toISOString() };

  decidePublishRequest(pr.id, { status: 'approved', reviewedBy: user.id, decisionNote, evidence });
  // Advance the public-current pointer; retire the previous published version.
  if (pr.published_version_id && pr.published_version_id !== pr.version_id) setVersionState(pr.published_version_id, 'superseded');
  setVersionState(pr.version_id, 'published');
  setPublishedVersion(pr.map_id, pr.version_id);
  setMapStatus(pr.map_id, 'published');

  req.log.info({ mapId: pr.map_id, requestId: pr.id, version: pr.version_key, by: user.email }, 'version published');
  logAudit(req, 'version.publish', { mapId: pr.map_id, versionId: pr.version_id, detail: { requestId: pr.id, version: pr.version_key, changeSummary: summary, note: decisionNote } });
  return { ok: true, publishedVersion: pr.version_key, downloads: downloadsForVersion(pr.map_id, pr.version_key) };
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
  return { ok: true };
});

// ===========================================================================
// Admin console (P3) — application review, map-request lifecycle, customers.
// Every route is admin-only (403 for signed-in non-admins, 401 for anon).
// ===========================================================================

app.get('/api/admin/summary', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  return { ok: true, summary: adminSummary() };
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
  if (link) console.log(`\n🔗  Invite (sign-in) link for ${email}:\n    ${link}\n`);
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
app.get('/api/admin/map-requests', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const rows = listMapsByStatus(['requested']).map((m) => ({
    id: m.id, name: m.name, kind: m.kind, subject: m.subject, requestNote: m.request_note,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    requestedBy: m.requested_by_email || null, createdAt: m.created_at,
  }));
  return { ok: true, requests: rows };
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

app.post('/api/admin/maps/:id/reject', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const m = getMap(Number(req.params.id));
  if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
  if (m.status !== 'requested') return reply.code(409).send({ ok: false, error: `This map is "${m.status}", not a pending request.` });
  setMapStatus(m.id, 'archived');
  req.log.info({ mapId: m.id }, 'map request rejected (archived)');
  logAudit(req, 'maprequest.reject', { mapId: m.id, detail: { name: m.name, kind: m.kind } });
  return { ok: true, status: 'archived' };
});

app.get('/api/admin/customers', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const rows = listCustomersAdmin().map((c) => ({
    id: c.id, name: c.name, type: c.type, status: c.status, plan: c.plan,
    quotaAreas: c.quota_areas, quotaPlaces: c.quota_places,
    usedAreas: c.area_used, usedPlaces: c.place_used, users: c.users, createdAt: c.created_at,
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
  });
  if (!ok) return reply.code(400).send({ ok: false, error: 'Nothing valid to update.' });
  req.log.info({ customerId: cust.id }, 'customer updated by admin');
  const c = getCustomer(cust.id);
  logAudit(req, 'customer.update', { detail: { customerId: c.id, name: c.name, quotaAreas: c.quota_areas, quotaPlaces: c.quota_places, status: c.status, plan: c.plan } });
  return { ok: true, customer: { id: c.id, name: c.name, status: c.status, plan: c.plan, quotaAreas: c.quota_areas, quotaPlaces: c.quota_places } };
});

app.get('/api/admin/messages', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  return { ok: true, messages: listMessages() };
});

// Append-only governance audit trail (publish sign-offs + P3 actions).
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
  app.log.info(`Community Bus Maps portal (${VERSION}) → http://${HOST}:${PORT}`);
  setInterval(() => { try { purgeExpiredSessions(); } catch {} }, 3_600_000).unref();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
