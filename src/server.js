// Community Bus Maps — portal server (P0).
// Serves the public shopfront and accepts applications + contact/feedback.
// No authenticated app, no public render endpoint yet (those are later phases).

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  insertApplication, insertMessage, counts,
  listMaps, getMap, nextVersion, insertVersion, setCurrentVersion, listVersions,
} from './db/index.js';
import { readRoutesMeta, enumeratePois, readOverrides, preview, renderVersion } from './maps/engine.js';
import { sanitizeOverrides } from './maps/safeSubset.js';
import { versionDir, OUTPUT_FILES } from './maps/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = '0.1.0-P1';

const ORG_TYPES = ['council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt', 'other'];
const MSG_KINDS = ['enquiry', 'question', 'feedback'];

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

const app = Fastify({ logger: true, bodyLimit: 256 * 1024 });

await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });

// --- tiny in-memory per-IP rate limit for /api/* (responsible defaults on a public form) ---
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
  status: 'ok',
  service: 'community-bus-maps',
  version: VERSION,
  time: new Date().toISOString(),
  ...counts(),
}));

app.post('/api/apply', async (req, reply) => {
  if (rateLimited(req.ip)) return reply.code(429).send({ ok: false, error: 'Too many requests — please try again shortly.' });
  const b = req.body || {};
  if (str(b.website_hp)) return { ok: true, id: 0 }; // honeypot: pretend success, drop

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
    phone: str(b.phone, 60),
    website: str(b.website, 200),
    wants: str(b.wants, 2000),
    message: str(b.message, 4000),
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

// ---------------------------------------------------------------------------
// P1 — editor spine (one map, no auth yet; tenant scoping + magic-link arrive
// in P2). Serves the safe-subset editor and its JSON API. The safe-subset gate
// (sanitizeOverrides) runs on EVERY preview/save, so only recolour + POI-toggle
// edits can ever reach the generator.
// ---------------------------------------------------------------------------

// Serialise generator runs per map: preview and save both make the generator
// write into the map's data/ folder, so they must not overlap.
const mapLocks = new Map();
function withMapLock(id, fn) {
  const prev = mapLocks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  mapLocks.set(id, next.finally(() => { if (mapLocks.get(id) === next) mapLocks.delete(id); }));
  return next;
}

function downloadsFor(id, storageKey, files) {
  return Object.keys(OUTPUT_FILES)
    .filter((f) => !files || files[f])
    .map((f) => ({ file: f, url: `/api/maps/${id}/versions/${storageKey}/${f}` }));
}

function mapDetail(id) {
  const m = getMap(id);
  if (!m) return null;
  const meta = readRoutesMeta(id);
  const saved = readOverrides(id);
  const savedColors = saved.routeColors || {};
  const savedPois = (saved.internal && saved.internal.pois) || {};
  const order = (meta.routeOrder && meta.routeOrder.length ? meta.routeOrder : Object.keys(meta.palette));
  const routes = order
    .filter((r) => meta.palette[r])
    .map((r) => ({
      id: r,
      defaultColor: meta.palette[r],
      color: savedColors[r] || meta.palette[r],
      customised: !!savedColors[r],
      textOn: meta.textOn[r] || '#111',
      desc: meta.internalDesc[r] || null,
    }));
  const pois = enumeratePois(id).map((p) => ({ ...p, hidden: !!(savedPois[p.key] && savedPois[p.key].hide) }));
  return {
    id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject, status: m.status,
    town: meta.town,
    currentVersion: m.cur_key || null,
    overrides: saved,
    routes, pois,
    versions: listVersions(id),
    downloads: m.cur_key ? downloadsFor(id, m.cur_key, null) : [],
  };
}

app.get('/app', (req, reply) => reply.sendFile('app/index.html'));
app.get('/app/maps/:id', (req, reply) => reply.sendFile('app/editor.html'));

app.get('/api/maps', async () => ({
  ok: true,
  maps: listMaps().map((m) => ({
    id: m.id, slug: m.slug, name: m.name, kind: m.kind, subject: m.subject,
    status: m.status, currentVersion: m.cur_key || null,
  })),
}));

app.get('/api/maps/:id', async (req, reply) => {
  const d = mapDetail(Number(req.params.id));
  if (!d) return reply.code(404).send({ ok: false, error: 'No such map.' });
  return { ok: true, map: d };
});

app.post('/api/maps/:id/preview', async (req, reply) => {
  const id = Number(req.params.id);
  if (!getMap(id)) return reply.code(404).send({ ok: false, error: 'No such map.' });
  const meta = readRoutesMeta(id);
  const poiKeys = enumeratePois(id).map((p) => p.key);
  const { overrides, rejected } = sanitizeOverrides((req.body || {}).overrides, { palette: meta.palette, poiKeys });
  try {
    const svg = await withMapLock(id, () => preview(id, overrides));
    return { ok: true, overrides, rejected, svg };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Preview render failed: ' + e.message });
  }
});

app.post('/api/maps/:id/save', async (req, reply) => {
  const id = Number(req.params.id);
  if (!getMap(id)) return reply.code(404).send({ ok: false, error: 'No such map.' });
  const meta = readRoutesMeta(id);
  const poiKeys = enumeratePois(id).map((p) => p.key);
  const b = req.body || {};
  const { overrides, rejected } = sanitizeOverrides(b.overrides, { palette: meta.palette, poiKeys });
  const { major, minor } = nextVersion(id);
  const storageKey = `v${major}.${minor}`;
  try {
    const r = await withMapLock(id, () => renderVersion(id, overrides, storageKey));
    const versionId = insertVersion({
      map_id: id, major, minor, note: str(b.note, 500), overrides, storage_key: storageKey,
    });
    setCurrentVersion(id, versionId);
    req.log.info({ mapId: id, version: storageKey }, 'saved new map version');
    return { ok: true, version: storageKey, rejected, files: r.files, downloads: downloadsFor(id, storageKey, r.files) };
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: 'Render failed: ' + e.message });
  }
});

app.get('/api/maps/:id/versions/:key/:file', async (req, reply) => {
  const id = Number(req.params.id);
  const { key, file } = req.params;
  if (!/^v\d+\.\d+$/.test(key) || !Object.prototype.hasOwnProperty.call(OUTPUT_FILES, file)) {
    return reply.code(400).send({ ok: false, error: 'Bad version or file.' });
  }
  const p = path.join(versionDir(id, key), file);
  if (!existsSync(p)) return reply.code(404).send({ ok: false, error: 'Not found.' });
  reply.header('Content-Type', OUTPUT_FILES[file]);
  if (req.query && 'download' in req.query) {
    const slug = (getMap(id) || {}).slug || 'map';
    reply.header('Content-Disposition', `attachment; filename="${slug}-${key}-${file}"`);
  }
  return reply.send(createReadStream(p));
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Community Bus Maps portal (${VERSION}) → http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
