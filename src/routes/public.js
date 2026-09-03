// The PUBLIC FRONT, as a Fastify plugin (OA-232 Tier 3.2, codebase review
// 2026-09-03 portal-src F25). Nineteen routes registered by src/server.js with
// NO prefix, because this is the only block whose URLs are not one namespace:
// the shopfront POSTs (P0), the four rendered pages, the /api/public read model,
// the generated banner script and the two crawler files.
//
// NO PREFIX IS THE INTERESTING PART, and it is why this plugin's guard story is
// the opposite of every other route file's. src/routes/admin.js, review.js and
// proposed.js each carry ONE preHandler because everything under their prefix is
// refused to the same people; src/routes/pages.js carries one because every page
// under /app needs a session. Everything here is UNAUTHENTICATED AND READ-ONLY
// BY DESIGN, so there is no guard to hoist and none to forget — which is exactly
// why the 2026-09-02 rule reserving the guarded cuts for a larger model does not
// reach this one, and the review says so in its own words.
//
// WHAT REPLACES A GUARD HERE IS THE SQL. A public route can only ever reach a map
// that (a) has a published version, (b) belongs to an active customer and (c) the
// customer has left listed, and all three are enforced in src/db/index.js's P6
// queries, not in this file. The files served are the very bytes an approver
// reviewed, because publishing never re-renders (P4). The one place a REQUEST'S
// identity changes the answer is the watermark on a published JPG, and the note
// on that route says why it may not be cached publicly.
//
// THE ORACLE FOR THIS CUT is scripts/route-table.json, recorded from the UNSPLIT
// server before OA-231 and asserted by scripts/test-admin-plugin.mjs: nineteen
// routes moved file and not one moved URL, or that test goes red. Do not re-record
// it. scripts/test-public-plugin.mjs holds what the table cannot see — that these
// routes are still served to an anonymous caller, that the four not-found paths
// still answer with a HANDLER 404 rather than a router one, and that no route
// outside this file claims a public URL. scripts/test-ssr.mjs is unchanged and
// still asserts that /maps and /m/:slug/services arrive with their bodies in them.
//
// TWO THINGS MOVED OUT BEFORE THIS CUT RATHER THAN DURING IT, which is the order
// src/routes/pages.js's header records for VIEWS_DIR and xmlEscape(): rateLimited()
// to src/http/helpers.js, because the auth sign-in POST is a fourth caller and is
// not in this file; and notFoundPage() to src/public/notFound.js, because
// src/server.js's setNotFoundHandler and setErrorHandler are the app's last resort
// and cannot import out of a route file.
//
// TWO OF THE APP'S THREE CACHES ARE HERE — the shell cache and the inline-SVG
// cache — and they are inside the plugin function, not at module scope. That is
// a deliberate choice to keep this a MOVE: the block below is in the order it
// was in src/server.js, every helper still beside the routes it serves and every
// comment still attached to the code it explains, which is worth more than the
// cosmetic tidiness of hoisting the six declarations out. It is one cache per
// REGISTRATION rather than one per process, and the plugin is registered exactly
// once with no prefix, so the two are the same object — but if this file ever
// grows a second registration, that is the line to read. The readiness cache is
// the third of the three and stays with the ops routes in src/server.js.
//
// Route files import from src/http/helpers.js and src/paths.js and never reach
// into src/server.js.

import path from 'node:path';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  insertApplication, insertMessage, listPublicMaps, getPublicMapBySlug, listPublicOrgs, getCustomerBySlug,
} from '../db/index.js';
import { publicMap, publicMaps, publicOrg, publicOutputs, mapPageUrl, orgPageUrl, webPreviewPath, PUBLIC_BASES } from '../public/index.js';
import { factsForPublicMap, publicServices, servicesPageUrl } from '../public/services.js';
import { setInner, setAttr, setClass, removeBooleanAttr } from '../public/shell.js';
import { grid } from '../../public/js/shared/map-card.mjs';
import { servicesView } from '../../public/js/shared/services-view.mjs';
import { inlineSvg } from '../public/inlineSvg.js';
import { notFoundPage } from '../public/notFound.js';
import { robotsTxt } from '../public/robots.js';
import { STATIC_PAGES } from '../public/staticPages.js';
import { escapeHtml } from '../html.js';
import { versionDir, OUTPUT_FILES } from '../maps/store.js';
import { ensureWatermarked } from '../render/watermark.js';
import { searchPlaces } from '../search/index.js';
import { PILOT, INDEXING, ENVIRONMENT } from '../config.js'; // PILOT: remove PILOT with docs/PILOT.md; INDEXING and ENVIRONMENT stay
import { APP_VERSION, GIT_SHA } from '../version.js';
import { ORG_TYPES, MSG_KINDS, str, isEmail, baseUrl, rateLimited, xmlEscape } from '../http/helpers.js';
import { dbDateToIso } from '../db/dates.js';
import { PUBLIC_DIR } from '../paths.js';

export default async function publicRoutes(app) {
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
      `<title>${escapeHtml(title)} — BusMaps.uk</title>`,
      `<link rel="canonical" href="${escapeHtml(canonical)}">`,
      `<meta name="description" content="${escapeHtml(desc)}">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(desc)}">`,
      `<meta property="og:url" content="${escapeHtml(canonical)}">`,
      card ? `<meta property="og:image" content="${escapeHtml(card)}">` : '',
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
      ...maps.map((m) => url(mapPageUrl(m.slug), dbDateToIso(m.publishedAt))),
      // P8a — the text alternative is a page in its own right, and the one most
      // worth finding in a search for "buses in <town>".
      ...maps.filter((m) => m.servicesUrl).map((m) => url(m.servicesUrl, dbDateToIso(m.publishedAt))),
      ...orgs.map((o) => url(orgPageUrl(o.slug))),
      '</urlset>',
      '',
    ].join('\n');
  });
}
