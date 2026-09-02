// Where the portal's data lives — and NOTHING ELSE.
//
// OA-224 Tier 3.3. `DATA_DIR` was exported from `src/db/index.js`, which opens
// the SQLite file, applies `schema.sql` and runs every migration at module load.
// Three scripts imported that module for this one constant and never touched
// `db`: `fix-badge-contrast.mjs`, `rerasterize-stored.mjs` and
// `restamp-renders.mjs` each migrated the live database as a side effect of
// wanting to know where `data/maps` is. Two more — `track-engine.mjs` and
// `backfill-engine-source.mjs` — had already noticed and worked around it by
// re-deriving the path, each with its own copy and a comment saying why, which
// is the duplication this tier exists to end and the reason a fourth spelling
// was one script away.
//
// This module imports nothing but `node:path` and `node:url`. Importing it
// cannot open a database, create a directory or run a migration.
//
// `index.js` re-exports `DATA_DIR` so every existing importer keeps working; new
// code that only wants a path should import it from here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The data root: `$DATA_DIR`, else `<repo>/data`. Resolved from this file's own
 *  location rather than the cwd, so a script run from anywhere agrees with the
 *  server about where the store is. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

/** The database file: `$DB_PATH`, else `portal.sqlite` inside DATA_DIR. */
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'portal.sqlite');

/** The stored maps: one directory per map id. */
export const MAPS_DIR = path.join(DATA_DIR, 'maps');
