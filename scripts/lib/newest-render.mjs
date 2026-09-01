// A `$FIXTURE_DIR` entry names a TOWN, not a folder (OA-211).
//
// WHY THIS EXISTS. Every entry in `.env`'s FIXTURE_DIR is a path of the form
// `Areas/<Town>/S5-render/v6.59_2026-08-30_0606`, and a path with a version
// number in it goes stale at every rollout. So the ordinary local run gates a
// different pack from the one CI gates and reports `DIFFERS` about a fixture
// that is perfectly good — a false red on a determinism gate, which is the one
// kind of red that must never be routine.
//
// It has now happened twice in two days. On 2026-09-01 `.env` pointed at St
// Ives `v6.59_2026-08-30_0606` while the newest render was `v6.67`; that was
// cleared by repointing `.env` at three current renders, and by the evening of
// the same day the landmark-chooser rollout had made it `v6.68` and `.env` was
// stale again. OA-180 had already escalated this class from silence to a
// warning, and the warning is accurate, prominent and ignorable — the run still
// goes red afterwards, which trains a reader to skip a red on the one gate
// whose whole job is to be believed. A banner is not a guard.
//
// THE FIX IS TO REMOVE THE STALENESS CLASS, NOT TO NAG ABOUT IT. Read the entry
// as naming the town and gate that town's newest render. `.env` then stops
// carrying a fact that expires, the run gates what the operator meant, and
// nobody has to edit a file after every rollout — which matters because the
// person who would have to is Peter. Advancing is the only direction anybody
// ever wants: FIXTURE_DIR exists to gate a render NEWER than the committed
// fixture during a rollout, so a resolution that only ever moves forward cannot
// weaken the gate.
//
// THE ANSWER COMES FROM `manifest.json`, NEVER FROM A DIRECTORY LISTING. Sorting
// `S5-render/` as strings puts `v6.9` after `v6.67` and `v10.0` before `v2.0`,
// and that bug shipped twice already — in `status.js`'s freshness check and in
// the old area-fixture recipe. The manifest names the current run outright, in
// `stages.S5.latest`, and its `runs[]` say where each one lives.
//
// EVERY WAY OF NOT KNOWING LEAVES THE ENTRY EXACTLY AS IT WAS, and says so.
// There is no map root, no manifest, no S5 stage, a `latest` naming a run the
// manifest does not list, a run folder that is not on this disk (S5-render is
// gitignored, so a fresh clone has none), or an entry the manifest has never
// heard of because somebody built it by hand: all of them keep the operator's
// own path. Substituting on a guess would be the "check that lies about what it
// read" this file was written to avoid.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The map root and run id for a path shaped `<root>/S5-render/<runId>`.
 * Anything else — a committed `_portal-fixture` pack, a bare folder, a path
 * with no `S5-render` segment — returns null and is left alone. That is what
 * keeps PLACE_FIXTURE_DIR untouched: it points straight at
 * `Places/_portal-fixture/<Place>`, which has no version in it to go stale.
 */
function versionedRender(fixtureDir) {
  const abs = path.resolve(fixtureDir);
  const parent = path.dirname(abs);
  if (path.basename(parent) !== 'S5-render') return null;
  return { mapRoot: path.dirname(parent), runId: path.basename(abs) };
}

/**
 * Where the map says its newest S5 run lives, or null with the reason.
 * @returns {{dir: string, runId: string} | {why: string} | null}
 */
function newestFromManifest(mapRoot) {
  const manifestPath = path.join(mapRoot, 'manifest.json');
  if (!existsSync(manifestPath)) return { why: `no manifest.json in ${mapRoot}` };
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (e) { return { why: `manifest.json in ${mapRoot} could not be read (${e.message})` }; }

  const s5 = manifest?.stages?.S5;
  const latest = s5?.latest;
  if (!latest) return { why: `manifest.json names no current S5 render for ${path.basename(mapRoot)}` };

  const run = (s5.runs || []).find((r) => r?.id === latest);
  if (!run?.dir) return { why: `manifest.json calls ${latest} the current render and lists no run for it` };

  const dir = path.join(mapRoot, run.dir);
  if (!existsSync(dir)) return { why: `${run.dir} is the current render and is not on this disk (S5-render is gitignored)` };
  return { dir, runId: latest };
}

/**
 * Advance each `$FIXTURE_DIR` entry to its map's current render, and say so.
 *
 * Called from `resolveFixtures()` for env-supplied fixtures only, so an unset
 * variable — CI, a fresh clone — never reaches it and CI keeps gating exactly
 * the committed pack. Never throws. Every entry it cannot resolve is returned
 * unchanged, which is the pre-2026-09-01 behaviour.
 *
 * @param {string[]} envFixtures  entries that won, already existence-checked
 * @returns {string[]} the same list, with stale versioned entries advanced
 */
export function advanceToNewestRender(envFixtures) {
  return envFixtures.map((fixture) => {
    const parsed = versionedRender(fixture);
    if (!parsed) return fixture;                       // not a versioned render — nothing to advance

    const newest = newestFromManifest(parsed.mapRoot);
    if (!newest) return fixture;
    if (newest.why) {
      // Only worth a line when the entry LOOKED resolvable. A tree with no
      // manifest at all is the shape a scratch fixture has, and printing on it
      // would put a notice on runs that are perfectly fine.
      if (!/no manifest\.json in /.test(newest.why)) {
        console.log(`· could not read the current render for ${path.basename(parsed.mapRoot)} — ${newest.why}.`);
        console.log(`  Gating $FIXTURE_DIR exactly as it is written: ${parsed.runId}`);
        console.log('');
      }
      return fixture;
    }
    if (newest.runId === parsed.runId) return fixture; // already current — silence is correct

    // PRINTED, ALWAYS. The rejected alternative was to substitute quietly, and a
    // verification tool that swaps its own input without saying so is a check
    // that lies about what it read, however right the swap is.
    console.log(`· $FIXTURE_DIR names ${path.basename(parsed.mapRoot)} ${parsed.runId}; gating its current render instead.`);
    console.log(`    ${parsed.runId}  ->  ${newest.runId}   (from manifest.json, stages.S5.latest)`);
    console.log('  A path with a version number in it goes stale at every rollout, so the entry names the');
    console.log('  town and this resolves the version (OA-211). Nothing in .env needs editing.');
    console.log('');
    return newest.dir;
  });
}
