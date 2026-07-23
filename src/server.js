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
  listMaps, getMap, nextVersion, insertVersion, setCurrentVersion, listVersions,
  setMapOutputs, getCustomer, purgeExpiredSessions,
} from './db/index.js';
import {
  readRoutesMeta, enumeratePois, readOverrides, preview, renderVersion, outputsForClient,
} from './maps/engine.js';
import { sanitizeOverrides } from './maps/safeSubset.js';
import { versionDir, OUTPUTS, OUTPUT_FILES } from './maps/store.js';
import {
  requestMagicLink, verifyMagicLink, resolveUser, logout, sessionCookie, clearCookie,
} from './auth/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = '0.2.0-P2';

const ORG_TYPES = ['council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt', 'other'];
const MSG_KINDS = ['enquiry', 'question', 'feedback'];

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const isHttps = (req) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
const parseOutputs = (json) => { try { return JSON.parse(json || '{}') || {}; } catch { return {}; } };

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
  return {
    ok: true,
    user: {
      id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role,
      customer: cust ? { id: cust.id, name: cust.name, type: cust.type, quotaAreas: cust.quota_areas, quotaPlaces: cust.quota_places } : null,
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

// Load a map only if the user may see it. Admins see all; everyone else is
// scoped to their own customer. Returns { map } or { code, error }.
function loadOwnedMap(id, user) {
  const m = getMap(id);
  if (!m) return { code: 404, error: 'No such map.' };
  if (user.role !== 'admin' && (user.customer_id == null || m.customer_id !== user.customer_id)) {
    return { code: 403, error: 'You do not have access to this map.' };
  }
  return { map: m };
}

function downloadsForVersion(id, storageKey) {
  const dir = versionDir(id, storageKey);
  return Object.keys(OUTPUT_FILES)
    .filter((f) => existsSync(path.join(dir, f)))
    .map((f) => ({ file: f, url: `/api/maps/${id}/versions/${storageKey}/${f}` }));
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
  return {
    id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject, status: m.status,
    customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    town: meta.town, currentVersion: m.cur_key || null, overrides: saved,
    routes, pois, outputs: outputsForClient(parseOutputs(m.outputs), id),
    versions: listVersions(id),
    downloads: m.cur_key ? downloadsForVersion(id, m.cur_key) : [],
  };
}

app.get('/app', async (req, reply) => (req.user ? reply.sendFile('app/index.html') : reply.redirect('/app/login.html')));
app.get('/app/maps/:id', async (req, reply) => (req.user ? reply.sendFile('app/editor.html') : reply.redirect('/app/login.html')));

app.get('/api/maps', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  if (user.role !== 'admin' && user.customer_id == null) return { ok: true, isAdmin: false, maps: [] };
  const scope = user.role === 'admin' ? {} : { customerId: user.customer_id };
  return {
    ok: true, isAdmin: user.role === 'admin',
    maps: listMaps(scope).map((m) => ({
      id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
      status: m.status, currentVersion: m.cur_key || null,
      customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
    })),
  };
});

app.get('/api/maps/:id', async (req, reply) => {
  const user = requireUser(req, reply); if (!user) return;
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
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
    return { ok: true, version: storageKey, rejected: s.rejected, files: r.files, downloads: downloadsForVersion(id, storageKey) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Render failed: ' + e.message });
  }
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
  const { map, code, error } = loadOwnedMap(Number(req.params.id), user);
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

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Community Bus Maps portal (${VERSION}) → http://${HOST}:${PORT}`);
  setInterval(() => { try { purgeExpiredSessions(); } catch {} }, 3_600_000).unref();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
