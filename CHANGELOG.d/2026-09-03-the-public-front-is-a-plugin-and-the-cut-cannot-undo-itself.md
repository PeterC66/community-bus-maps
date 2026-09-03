---
date: 2026-09-03
title: "The public front is a plugin, and the cut cannot undo itself"
---

- **The last unplugged block of `src/server.js` is now `src/routes/public.js`.** Nineteen routes — the two shopfront POSTs, the four rendered public pages, eleven `/api/public` reads, the generated banner script, `robots.txt` and `sitemap.xml` — registered with **no prefix**, because this is the one block whose URLs are not a single namespace. `src/server.js` goes from 1,532 lines to 918, and what is left in it is bootstrap, hooks, auth, ops and the expert side. OA-232 Tier 3.2, the last structural seam the 2026-09-03 codebase review named (portal-src F25).

- **No prefix and no guard are the same fact.** Every other plugin here carries one `preHandler` because everything under its prefix is refused to the same people; everything in this one is unauthenticated and read-only by design, and what stands in for a guard is the P6 SQL in `src/db/index.js`, which cannot reach a map that is not published, listed and owned by an active customer. That is why the 2026-09-02 rule reserving the guarded cuts for a larger model does not reach this one.

- **Two things moved out BEFORE the cut rather than during it**, which is the order `src/routes/pages.js`'s header records for `VIEWS_DIR` and `xmlEscape()`: `rateLimited()` to `src/http/helpers.js`, because the auth sign-in POST is a fourth caller and is not in the plugin, and `notFoundPage()` to `src/public/notFound.js`, because `setNotFoundHandler` and `setErrorHandler` are the app's last resort and cannot import out of a route file.

- **Nothing on the wire moved.** `scripts/route-table.json` — recorded from the unsplit server and not re-recorded — reproduces exactly, and twenty-one public responses were captured from a clean checkout at `7ffe42f` and again after the cut and are **byte-for-byte identical**, `/js/site-banner.js` included. That last one was the real risk: the banner is built from three multi-line template literals, and re-indenting one line inside them would have changed the JavaScript served to every visitor. The move indents only outside a template literal.

- **`scripts/test-public-plugin.mjs` is the check that keeps the cut adopted**, which is the whole point of this round: a public route added back into `src/server.js` would serve the right bytes, keep the route table identical, refuse nobody, and quietly undo the cut. So the test reads the **source** and asserts that no public URL is registered outside the plugin — joining each route file's registered prefix first, because a route literal inside a prefixed plugin is not a URL, and the first version of that check said `src/routes/pages.js` claimed `/maps` when it serves `/app/maps/:id`.

- **`scripts/prove-red-public-plugin.mjs` breaks it nine ways and found a hole on the first run.** The arm that renames `/maps` survived, because the predicate matched `/maps-disabled` by prefix; exact URLs and namespaces are separate lists now. Eight mutations are caught by the assertion that claims to be about them, and the ninth is a **control that must stay green** — a legitimate `/maps/summary` added to the admin plugin, which is `/api/admin/maps/summary` and not public.

- **Sixty-three of `src/server.js`'s imports were already dead**, every one of them left behind by a route moving out under OA-231 while its import stayed, and nothing could see them: a dead import is invisible to the route table and to every runtime test. All 102 dead specifiers are gone, and the suite now asserts that every import in `src/server.js` is used.
