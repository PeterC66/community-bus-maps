/*
 * backfill-engine-source.mjs — answer, once, which external generator each
 * already-imported AREA pack was built from, and WRITE the answer down (OA-143).
 *
 * Every pack imported before `engine-source.json` existed stores its external
 * generator as `gen_external.js` with nothing saying whether it came from
 * `engine/area/gen_external_radial.js` or `..._busway.js`. `track-engine.mjs`
 * will not guess, so those packs are skipped on every run — measured on the live
 * store, eight of eighteen maps, which is every town's external sheet. This is
 * the migration that ends that, and it is the ONLY place in the portal permitted
 * to work the answer out rather than be handed it: from here on `import-map.mjs`
 * records what it staged, because at import the answer is known.
 *
 * TWO INDEPENDENT SIGNALS, AND THEY MUST AGREE.
 *
 *   1. THE MAP'S OWN DATA. `gen_external_busway.js` reads `D.busway[0]` and
 *      `D.busway[1]` at load; a `routes.json` with no `busway` array makes it
 *      throw before it draws anything. So a pack without that key CANNOT be a
 *      busway map — not "is probably not", cannot.
 *   2. THE STORED GENERATOR ITSELF. The busway file dereferences `D.busway[`;
 *      the radial file does not mention `.busway` anywhere. This is asked of the
 *      pack's own copy, whatever engine version it is frozen at, so it keeps
 *      working as the generators move on.
 *
 * A hash comparison against the vendored files was the obvious approach and is
 * the wrong one: these packs are several engine changes behind by construction —
 * that is the entire reason they need tracking — so byte-equality answers "no"
 * for both candidates and tells you nothing.
 *
 * WHEN THE TWO SIGNALS DISAGREE, NOTHING IS WRITTEN and the pack is reported. A
 * migration that resolves its own ambiguity by picking a side is the guess this
 * row exists to refuse; two signals agreeing is evidence, one signal overruling
 * the other is a coin toss with extra steps.
 *
 * Run from the repository root — `C:\\Claude\\community-bus-maps` on the laptop,
 * `/opt/community-bus-maps` inside the container on the VPS. No placeholders:
 *
 *   node scripts/backfill-engine-source.mjs            # report; writes nothing
 *   node scripts/backfill-engine-source.mjs --apply    # write the answers
 *
 * Idempotent: a pack that already declares is left alone and counted as such, so
 * running it twice is a no-op and running it after a fresh import is harmless.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEngineSource, writeEngineSource, ENGINE_SOURCE_FILE } from './lib/engine-source.mjs';
import { MAPS_DIR } from '../src/db/paths.js';

// The path is resolved in src/db/paths.js, which imports nothing but node:path
// and node:url -- importing src/db/index.js for one constant opens and migrates
// the database, which is what this comment used to explain a second copy of
// (OA-224 Tier 3.3).
const MAPS = MAPS_DIR;
const APPLY = process.argv.includes('--apply');

const PACK_FILE = 'gen_external.js';
const CANDIDATES = {
  busway: 'area/gen_external_busway.js',
  radial: 'area/gen_external_radial.js',
};

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(path.join(p, d)).isDirectory()) : []);

if (!existsSync(MAPS)) {
  console.log(`· no map store at ${MAPS} — nothing to do.`);
  process.exit(0);
}

let wrote = 0, already = 0, undecided = 0, notArea = 0;
const rows = [];

for (const id of dirs(MAPS).sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))) {
  const dataDir = path.join(MAPS, id, 'data');
  const packFile = path.join(dataDir, PACK_FILE);
  if (!existsSync(packFile)) { notArea++; continue; }

  const declared = readEngineSource(dataDir);
  if (declared && declared.unreadable) {
    rows.push(['?', id, `${ENGINE_SOURCE_FILE} will not parse — fix or delete it, then re-run`]);
    undecided++;
    continue;
  }
  if (declared && typeof declared.generators[PACK_FILE] === 'string') {
    rows.push(['·', id, `already declares ${declared.generators[PACK_FILE]}`]);
    already++;
    continue;
  }

  // Signal 1 — the map's own data.
  let byData = null, dataWhy;
  try {
    const rj = JSON.parse(readFileSync(path.join(dataDir, 'routes.json'), 'utf8'));
    byData = Array.isArray(rj.busway) && rj.busway.length ? 'busway' : 'radial';
    dataWhy = byData === 'busway' ? 'routes.json has a busway[] corridor' : 'routes.json has no busway[]';
  } catch {
    dataWhy = 'routes.json missing or unreadable';
  }

  // Signal 2 — the stored generator.
  let byCode = null, codeWhy;
  try {
    const src = readFileSync(packFile, 'utf8');
    byCode = /D\.busway\[/.test(src) ? 'busway' : 'radial';
    codeWhy = byCode === 'busway' ? 'its gen_external.js dereferences D.busway[]' : 'its gen_external.js never mentions .busway';
  } catch {
    codeWhy = 'gen_external.js unreadable';
  }

  if (!byData || !byCode) {
    rows.push(['?', id, `cannot tell — ${dataWhy}; ${codeWhy}`]);
    undecided++;
    continue;
  }
  if (byData !== byCode) {
    rows.push(['✗', id, `THE TWO SIGNALS DISAGREE — ${dataWhy} says ${byData}, ${codeWhy} says ${byCode}. Nothing written; this pack needs a person.`]);
    undecided++;
    continue;
  }

  const rel = CANDIDATES[byData];
  rows.push([APPLY ? '→' : '+', id, `${byData} — ${dataWhy}, and ${codeWhy}`]);
  if (APPLY) writeEngineSource(dataDir, { [PACK_FILE]: rel }, 'backfill');
  wrote++;
}

console.log(`\nExternal-generator provenance for area packs — ${MAPS}\n`);
if (!rows.length) console.log('  no area packs found');
for (const [mark, id, note] of rows) console.log(`  ${mark} map ${String(id).padEnd(6)} ${note}`);
console.log(`\n${wrote} ${APPLY ? 'recorded' : 'to record'}, ${already} already declared, ${undecided} undecided, ${notArea} not area packs.`);

if (undecided) {
  console.log('\nAn undecided pack is NOT a failure of this migration — it is the migration');
  console.log('refusing to guess, which is the whole point. Settle it by hand, or re-import');
  console.log('the map, which records the answer at the moment it is known.');
}
if (wrote && !APPLY) {
  console.log('\nWrite them with:  node scripts/backfill-engine-source.mjs --apply');
  console.log('Then re-run:      node scripts/track-engine.mjs');
}
// Non-zero only when a pack could not be settled, so this works as a check as
// well as a migration. Packs merely awaiting --apply are not a failure.
process.exitCode = undecided ? 1 : 0;
