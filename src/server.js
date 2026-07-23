// Community Bus Maps — portal server (P0).
// Serves the public shopfront and accepts applications + contact/feedback.
// No authenticated app, no public render endpoint yet (those are later phases).

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertApplication, insertMessage, counts } from './db/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = '0.0.1-P0';

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

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Community Bus Maps portal (${VERSION}) → http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
