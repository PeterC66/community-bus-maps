// Both verify fixtures went stale on 2026-08-09 in different shapes — a
// versioned area fixture pointed at an old sibling, a flat place fixture with
// one file re-staged and another left behind — and both times the gate
// reported a "determinism failure" that was really bookkeeping (GO-LIVE.md
// §2.6). A gate that cries wolf gets ignored, so these two checks print a
// WARNING ahead of the real comparison instead of silently letting a stale
// fixture masquerade as a regression. Neither check fails the gate: staleness
// is a hint to a human, not proof the generator is broken.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function newestMtime(dir) {
  let max = statSync(dir).mtimeMs;
  for (const f of readdirSync(dir)) {
    try {
      const m = statSync(path.join(dir, f)).mtimeMs;
      if (m > max) max = m;
    } catch { /* transient entry, ignore */ }
  }
  return max;
}

/** Area-style fixture: FIXTURE_DIR is one versioned subfolder (e.g.
 * S5-render/v6.22_...) among siblings in the same parent. Warn if a sibling
 * is newer — the .env-repointing bug from §2.6. */
export function warnIfStaleSibling(fixtureDir) {
  const parent = path.dirname(fixtureDir);
  if (!existsSync(parent)) return;
  const self = path.basename(fixtureDir);
  let entries;
  try { entries = readdirSync(parent); } catch { return; }
  const fixtureMtime = newestMtime(fixtureDir);
  const newer = entries
    .filter((name) => name !== self)
    .map((name) => path.join(parent, name))
    .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } })
    .filter((p) => newestMtime(p) > fixtureMtime)
    .sort((a, b) => newestMtime(b) - newestMtime(a));
  if (newer.length) {
    console.log(`⚠ FIXTURE_DIR is not the newest render in ${parent} — ${path.basename(newer[0])} is newer.`);
    console.log('  A DIFFERS result below may just mean the fixture needs repointing, not a real regression.');
    console.log('');
  }
}

/** Place-style fixture: FIXTURE_DIR is a flat folder of reference files that
 * get re-staged together. Warn if one file lags well behind the rest — the
 * leftover-schematic bug from §2.6. */
export function warnIfFileSkew(fixtureDir, fileNames, thresholdMs = 10 * 60 * 1000) {
  const stats = fileNames
    .map((f) => path.join(fixtureDir, f))
    .filter((p) => existsSync(p))
    .map((p) => ({ f: path.basename(p), mtime: statSync(p).mtimeMs }));
  if (stats.length < 2) return;
  const newest = Math.max(...stats.map((s) => s.mtime));
  const stale = stats.filter((s) => newest - s.mtime > thresholdMs);
  if (stale.length) {
    console.log(`⚠ some fixture files in ${fixtureDir} are older than the rest of the fixture:`);
    for (const s of stale) {
      console.log(`    ${s.f} — ${Math.round((newest - s.mtime) / 60000)} min older than the newest file here`);
    }
    console.log('  A DIFFERS result below may be stale bookkeeping, not a real regression — re-stage the fixture.');
    console.log('');
  }
}
