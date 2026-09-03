// The recursive size of a folder, and nothing else.
//
// OA-232 Tier 1.6, and the same argument as `src/db/paths.js` (OA-224 Tier 3.3).
// `dirSize` lived in `src/ops/index.js`, which imports `db` and so opens the
// SQLite file, applies `schema.sql` and runs every migration at module load.
// Two scripts wanted only this function: `scripts/backup.mjs`, whose whole job
// is to copy a database it must not first migrate, and `scripts/prune-staged.mjs`.
// The 2026-09-03 review recorded `backup.mjs` as reaching a database through its
// `DATA_DIR` import (portal-ops D6); moving that import to `db/paths.js` was
// only half the chain, because `dirSize` came from `ops/index.js` and dragged
// the migration in behind it. Measured, not reasoned: `scripts/test-portal-lib.mjs`
// spawns a child with a scratch `DATA_DIR`, imports `backup.mjs`'s dependencies
// and asserts nothing is created.
//
// This module imports nothing but `node:fs` and `node:path`.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Recursive size of a folder in bytes (0 when it does not exist). */
export function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else { try { total += statSync(p).size; } catch { /* vanished */ } }
    }
  }
  return total;
}
