// The signed-in app's HTML SHELLS, as a Fastify plugin (OA-231, codebase review
// Tier 4.4). Ten routes under the prefix /app, registered by src/server.js.
//
// These are pages, not API: every one of them answers a browser navigation with
// a file or a REDIRECT, where the /api plugins answer with 401 and 403. That
// difference is the whole reason this is a second plugin rather than more of
// src/routes/editor.js — one file, one refusal vocabulary.
//
// ONE REDIRECT, NOT NINE. Each handler used to open with
// `if (!req.user) return reply.redirect('/app/login.html')`, which is the fault
// this section has already had once: /app/review-services.html was reachable by
// ANYBODY until 2026-08-20 because it was a static file with no route of its own
// (technical-audit_2026-08-19 S7) — the clearest single case in that audit. A
// shell that forgets its guard does not fail loudly; it just serves. The hook
// below runs before every handler in this file, so an eleventh page cannot be
// added without it.
//
// THE ONE EXCEPTION IS THE SIGN-IN PAGE, and it is declared as route config the
// hook reads rather than as an early return — the same shape /api/admin/worklist
// uses for the operator token. A hook that redirected the login page to itself
// would loop.
//
// THE HOOK IS ONLY PART OF THE DECISION, and this file has the same shape as
// src/routes/proposed.js: four of these pages are further restricted by ROLE —
// /admin and /changelog to admins, /review and /review-services.html to
// approvers and admins, /maps/:id/diagram to admins — and those checks stay in
// the handlers. They redirect rather than refuse: a signed-in editor who follows
// a stale link to /app/admin lands on /app, not on an error. scripts/test-pages-plugin.mjs
// asserts the door AND every role redirect, because a cut that hoisted the cheap
// guard and lost the role checks would pass every anonymous assertion while
// handing the admin console's shell to any customer who typed the URL.
//
// /maps/:id/diagram CAME FROM THE P7 SECTION, not from the editor spine, and that
// is the prefix rule rather than a land grab: this plugin is registered under
// /app, so a page shell under /app left behind in server.js would make the prefix
// a claim that is not true. P7 keeps its API routes; it is one page that moved.
//
// Route files import from src/http/helpers.js and src/paths.js and never reach
// into server.js — which is why VIEWS_DIR, ROOT_DIR and xmlEscape() moved out
// BEFORE this cut rather than during it.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ROOT_DIR, VIEWS_DIR } from '../paths.js';
import { entriesFromDir } from '../changelog.js';
import { xmlEscape } from '../http/helpers.js';

export default async function pageRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.config.anonymous) return;
    if (!req.user) return reply.redirect('/app/login.html');
  });


  // Anonymous by design — it is the sign-in page. It needs a route only because
  // it is no longer a static file; the URL is unchanged so every existing
  // redirect, bookmark and `location.href` in the app keeps working.
  app.get('/login.html', { config: { anonymous: true } }, async (req, reply) => reply.sendFile('app/login.html', VIEWS_DIR));

  app.get('/', { prefixTrailingSlash: 'no-slash' }, async (req, reply) => reply.sendFile('app/index.html', VIEWS_DIR));
  app.get('/maps/:id', async (req, reply) => reply.sendFile('app/editor.html', VIEWS_DIR));
  app.get('/maps/:id/landmarks', async (req, reply) => reply.sendFile('app/landmarks.html', VIEWS_DIR));
  app.get('/branding', async (req, reply) => reply.sendFile('app/branding.html', VIEWS_DIR));
  app.get('/admin', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.redirect('/app');
    return reply.sendFile('app/admin.html', VIEWS_DIR);
  });
  app.get('/review', async (req, reply) => {
    if (req.user.role !== 'approver' && req.user.role !== 'admin') return reply.redirect('/app');
    return reply.sendFile('app/review.html', VIEWS_DIR);
  });

  // The services-and-stops list a reviewer opens in a second tab from
  // /app/review. It was reachable by anyone until 2026-08-20 because it was a
  // static file with no route of its own — the clearest single case of S7. Same
  // guard as the review page that links to it. The `.html` stays in the URL
  // because review.js links to it by that name.
  app.get('/review-services.html', async (req, reply) => {
    if (req.user.role !== 'approver' && req.user.role !== 'admin') return reply.redirect('/app');
    return reply.sendFile('app/review-services.html', VIEWS_DIR);
  });

  // Admin-only view of the developer changelog. NOT public: entries name real
  // past security findings (e.g. the S6 self-approval bypass, the S4 /health
  // disclosure) in the same detail as the rest of this repo's docs, so
  // publishing them verbatim would hand a visitor a list of things that used to
  // be wrong. The public-facing counterpart is /changelog.html, fed by the small
  // curated file at public/data/whats-new.json instead of this one.
  //
  // BUILT FROM CHANGELOG.d/ ON EVERY REQUEST, not read from CHANGELOG.md, since
  // 2026-09-03. That file is generated and gitignored now — the committed index
  // was touched by 60 of the last 60 commits and conflicted between concurrent
  // sessions every time — so it is not in the deployed image at all. Reading it
  // here would have degraded to "(not found on this instance)" the moment this
  // shipped. Generating instead makes the page ALWAYS CURRENT, which the
  // committed file never was: it was only ever as fresh as the last person to
  // remember `npm run changelog`.
  //
  // Titles only, deliberately. The prose of each entry is one click away in the
  // repository, and rendering 88 fragments of markdown here would need a
  // markdown dependency for a read-only convenience for one person.
  app.get('/changelog', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.redirect('/app');
    let body;
    try {
      const entries = entriesFromDir(path.join(ROOT_DIR, 'CHANGELOG.d'));
      body = entries.length
        ? entries.map(e => `${e.date}  ${e.title}`).join('\n')
        : '(no changelog fragments found on this instance.)';
    } catch {
      body = '(the changelog fragments could not be read on this instance.)';
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

  // The expert diagram editor's shell. It belongs to P7 (src/server.js's Expert
  // side banner) and lives here because this plugin owns the /app subtree; the
  // admin check is P7's rule and stays with the page.
  app.get('/maps/:id/diagram', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.redirect(`/app/maps/${Number(req.params.id)}`);
    return reply.sendFile('app/diagram.html', VIEWS_DIR);
  });
}
