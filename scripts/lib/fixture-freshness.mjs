// Both verify fixtures went stale on 2026-08-09 in different shapes — a
// versioned area fixture pointed at an old sibling, a flat place fixture with
// one file re-staged and another left behind — and both times the gate
// reported a "determinism failure" that was really bookkeeping (GO-LIVE.md
// §2.6). A gate that cries wolf gets ignored, so these two checks print a
// WARNING ahead of the real comparison instead of silently letting a stale
// fixture masquerade as a regression. Neither check fails the gate: staleness
// is a hint to a human, not proof the generator is broken.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Never throws — permission-denied children (real case, 2026-08-09: FIXTURE_DIR
// mounted at /fixture inside a container means its "parent" is / itself, whose
// siblings include things like /root that the container's non-root user can't
// read) are treated as "can't tell", not as a fatal error in what is only ever
// an advisory warning.
function newestMtime(dir) {
  let max;
  try { max = statSync(dir).mtimeMs; } catch { return null; }
  let entries;
  try { entries = readdirSync(dir); } catch { return max; }
  for (const f of entries) {
    try {
      const m = statSync(path.join(dir, f)).mtimeMs;
      if (m > max) max = m;
    } catch { /* transient entry or permission-denied child, ignore */ }
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
  if (fixtureMtime == null) return;
  const newer = entries
    .filter((name) => name !== self)
    .map((name) => path.join(parent, name))
    .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } })
    .map((p) => ({ p, m: newestMtime(p) }))
    .filter(({ m }) => m != null && m > fixtureMtime)
    .sort((a, b) => b.m - a.m);
  if (newer.length) {
    console.log(`⚠ FIXTURE_DIR is not the newest render in ${parent} — ${path.basename(newer[0].p)} is newer.`);
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

/* -------------------------------------------------------------------------
 * The third staleness shape, and the one neither check above could see.
 *
 * OA-180, found 2026-08-30 by a side effect rather than by a check. This
 * laptop's `.env` aimed FIXTURE_DIR at `Areas/St Ives/S5-render/v6.55_…`
 * while the committed fixture had been refreshed from `v6.59_…` six days
 * later — so `npm run verify` gated one pack here and a different one in CI,
 * from the same command, and nothing said so. `warnIfStaleSibling()` above
 * asks whether a SIBLING render is newer inside the same tree; it cannot ask
 * this, because the committed fixture is not a sibling of anything.
 *
 * It is a warning and not a failure for the reason at the head of this file:
 * pointing the local gate at the live render tree is a legitimate and
 * STRONGER choice than gating the committed pack, which is why the env
 * variable wins in the first place. What failed here was not the choice but
 * the silence.
 *
 * IT COMPARES `build-meta.json`'s `builtAt`, NOT MTIMES. A committed fixture
 * in a fresh clone carries checkout mtimes — every file "modified" the moment
 * git wrote it — so an mtime comparison would report every live render as
 * behind, on every clone, for ever. `builtAt` is content: it travels with the
 * fixture through git and says when the pack was actually generated. When
 * either side lacks it the answer is "cannot tell", and that is PRINTED
 * rather than swallowed — a resolver that goes quiet when it cannot compare
 * is how this row came to exist.
 * ------------------------------------------------------------------------- */

/** `<root>/<dirName>/_portal-fixture` — the nearest ancestor of `fixtureDir` that has one. */
function busesRootFor(fixtureDir, dirName) {
  let dir = path.resolve(fixtureDir);
  for (let i = 0; i < 16; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;          // reached the filesystem root
    dir = parent;
    if (existsSync(path.join(dir, dirName, '_portal-fixture'))) return dir;
  }
  return null;
}

/** When this pack was generated, off its own `build-meta.json`. Null if it cannot be read. */
function builtAtOf(dir) {
  try {
    const meta = JSON.parse(readFileSync(path.join(dir, 'build-meta.json'), 'utf8'));
    return typeof meta.builtAt === 'string' ? meta.builtAt : null;
  } catch { return null; }
}

const shown = new Set();

/**
 * Warn when a `$FIXTURE_DIR` entry is older than the committed fixture that
 * would otherwise have been used — i.e. when this machine and CI are gating
 * different packs from the same command.
 *
 * Called by `resolveFixtures()` and only when the env variable won, so an
 * unset variable (CI, a fresh clone) never reaches it. Never throws, never
 * changes what was resolved, and prints at most once per kind per process.
 *
 * @param {'area'|'place'} kind
 * @param {string[]} envFixtures  the entries that won, already existence-checked
 */
export function warnIfBehindCommitted(kind, envFixtures) {
  if (shown.has(kind)) return;
  shown.add(kind);
  const envVar = kind === 'place' ? 'PLACE_FIXTURE_DIR' : 'FIXTURE_DIR';
  const dirName = kind === 'place' ? 'Places' : 'Areas';

  for (const fixture of envFixtures) {
    const root = busesRootFor(fixture, dirName);
    if (!root) continue;                       // not inside a buses-data tree — nothing to compare with
    const committedRoot = path.join(root, dirName, '_portal-fixture');
    // The town is the first segment under `Areas/` or `Places/`, and the pack to
    // compare with is that town's committed fixture. TWO shapes leave by the same
    // door and both are correct silences: a town with no committed fixture at all
    // (`verify:defaults` names three and only St Ives is committed — a warning on
    // the other two would be noise on every run), and an env path that already IS
    // a committed fixture, which is how PLACE_FIXTURE_DIR is set — its "town"
    // reads as `_portal-fixture`, whose counterpart cannot exist. An explicit
    // identity guard was written here first and then removed: it was never
    // reachable, because this line had already answered every case it claimed.
    const town = path.relative(path.join(root, dirName), path.resolve(fixture)).split(path.sep)[0];
    const committed = path.join(committedRoot, town);
    if (!town || town === '..' || !existsSync(committed)) continue;

    const mine = builtAtOf(fixture);
    const theirs = builtAtOf(committed);
    if (!mine || !theirs) {
      console.log(`⚠ cannot tell whether $${envVar} is current for ${town} — no readable build-meta.json in ${mine ? committed : fixture}.`);
      console.log(`  The drift check below the gate did not run for this entry. It is not evidence that the pack is current.`);
      console.log('');
      continue;
    }
    if (Date.parse(mine) >= Date.parse(theirs)) continue;  // current, or ahead of the committed pack

    console.log(`⚠ $${envVar} is BEHIND the committed fixture for ${town} — this machine and CI are gating different packs.`);
    console.log(`    yours     : ${path.basename(fixture)}   built ${mine}`);
    console.log(`    committed : ${dirName}/_portal-fixture/${town}   built ${theirs}`);
    console.log(`  Repoint ${envVar} at the current render in ${path.join(root, dirName, town)}, or unset it to gate`);
    console.log(`  exactly what CI gates. A path with a version number in it goes stale at every rollout (OA-180).`);
    console.log('');
  }
}
