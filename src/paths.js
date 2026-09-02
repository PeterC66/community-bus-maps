// Where the portal's OWN files live — the repository root, the public assets and
// the signed-in app's HTML shells. Nothing else, and no side effects.
//
// The sibling of `src/db/paths.js` and for the same reason (OA-224 Tier 3.3):
// this module imports nothing but `node:path` and `node:url`, so importing it
// cannot open a database, create a directory or run a migration. That one is the
// DATA root; this one is the CODE root.
//
// The three constants were declared in `src/server.js` until 2026-09-02, where
// they were fine while every route lived in that file. `src/routes/pages.js` is
// the first route file to serve an HTML shell, and a route file may not reach
// into `server.js` (docs/CONVENTIONS.md, Routes), so they moved out BEFORE the
// cut rather than during it — otherwise the new file would have closed over
// module scope instead of importing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repository root — one level above `src/`. `CHANGELOG.md` is read from here. */
export const ROOT_DIR = path.resolve(HERE, '..');

/** Everything `@fastify/static` serves to anybody: the marketing site, and the
 *  signed-in app's `.js` and `.css`. */
export const PUBLIC_DIR = path.resolve(HERE, '../public');

/**
 * The signed-in app's HTML shells. OUTSIDE public/ on purpose
 * (technical-audit_2026-08-19 S7): @fastify/static serves the whole of
 * PUBLIC_DIR, so while these lived at public/app/*.html the guarded route
 * `/app/admin` correctly 302'd an anonymous visitor to the login page and
 * `/app/admin.html` handed the same file to anybody who asked. No data leaked —
 * every API behind those shells returns 401, checked at the time across
 * /api/maps, /api/me, /api/admin/* and /api/review/pending — but a role check on
 * the pretty URL that reads like an access control and is not one is exactly the
 * thing a reviewer tests. Now the only way to a shell is through its route.
 *
 * The app's .js and .css stay under public/app/ and stay public: the browser has
 * to be able to fetch them, they are the same code every signed-in user runs,
 * and nothing in them is a secret. It is the shells that carried the false
 * promise, not the assets.
 */
export const VIEWS_DIR = path.resolve(HERE, '../views');
