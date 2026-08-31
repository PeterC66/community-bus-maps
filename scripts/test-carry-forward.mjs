// What survives a data refresh — swapInProposedData()'s carry-forward list (OA-199).
//
//   node scripts/test-carry-forward.mjs        (or: npm run test:carry-forward)
//
// A map's live data directory is ARCHIVED and replaced wholesale when a monthly
// refresh is accepted. A short list of files is carried back out of the archive
// because they are facts about the pack rather than part of the monthly payload.
// Until 2026-08-31 that list held exactly one entry — the expert's diagram pins —
// and nothing anywhere tested it, so it had never had to be right about a second.
// It was wrong about the second: `engine-source.json` was written by OA-143 on
// 2026-08-30, eighteen maps were published that evening, and eight of them lost
// the file the same night.
//
// THE ASSERTION THAT MATTERS IS THE ONE ABOUT AN ABSENT FILE. A test that stages a
// payload carrying its own declaration and then finds a declaration in the live
// data would pass against a carry-forward list that does nothing at all. Every
// survival check below stages a payload that does NOT carry one, because that is
// the case that actually happened.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-carry-'));
process.env.DATA_DIR = scratch;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { mapDataDir, proposedDataDir, archiveRoot, DIAGRAM_LAYOUT, ENGINE_SOURCE } = await import('../src/maps/store.js');
const { swapInProposedData, engineSourceVerdict } = await import('../src/maps/engine.js');
const { ENGINE_SOURCE_FILE } = await import('./lib/engine-source.mjs');

/* The two generator stubs carry the same tell the real files do, and the same one
 * `backfill-engine-source.mjs` reads: the busway generator dereferences D.busway[,
 * the radial one never mentions it. */
const RADIAL_SRC = '// radial stub\nconst A = D.spokes[0];\n';
const BUSWAY_SRC = '// busway stub\nconst A = D.busway[0];\n';
const declaration = (rel, how = 'test', at = '2026-01-01T00:00:00.000Z') => JSON.stringify({
  recorded: how, at, generators: { 'gen_external.js': rel },
}, null, 2) + '\n';

let nextId = 0;
/**
 * One map with live data and one staged proposed update, ready to swap.
 * `live` and `staged` are each a plain {filename: contents} — what is IN the
 * staged payload is the whole point of every case below, so nothing is implied.
 */
function world(live, staged) {
  const id = ++nextId;
  const pid = 1;
  const liveDir = mapDataDir(id);
  const stagedDir = proposedDataDir(id, pid);
  mkdirSync(liveDir, { recursive: true });
  mkdirSync(stagedDir, { recursive: true });
  for (const [f, c] of Object.entries(live)) writeFileSync(path.join(liveDir, f), c);
  for (const [f, c] of Object.entries(staged)) writeFileSync(path.join(stagedDir, f), c);
  return { id, pid, liveDir, stagedDir };
}
const read = (dir, f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : null);

console.log('\n== carry-forward: what survives a data refresh (OA-199) ==\n');

// ------------------------------------------------- the duplicated filename
console.log('the filename src/ and scripts/ each hold');
check('src/maps/store.js and scripts/lib/engine-source.mjs name the SAME file',
  ENGINE_SOURCE === ENGINE_SOURCE_FILE, `store.js says ${ENGINE_SOURCE}, engine-source.mjs says ${ENGINE_SOURCE_FILE}`);

// ------------------------------------------------- the case that happened
console.log('\na refresh whose payload brings no declaration');
{
  const w = world(
    { 'routes.json': '{}', 'gen_external.js': RADIAL_SRC, [ENGINE_SOURCE]: declaration('area/gen_external_radial.js'), [DIAGRAM_LAYOUT]: '{"pins":1}' },
    { 'routes.json': '{}', 'gen_external.js': RADIAL_SRC },   // deliberately no declaration, no pins
  );
  const r = swapInProposedData(w.id, w.pid);
  check('the engine-source declaration survives', read(w.liveDir, ENGINE_SOURCE) === declaration('area/gen_external_radial.js'),
    String(read(w.liveDir, ENGINE_SOURCE)));
  check('...and it is reported as carried', r.carried.includes(ENGINE_SOURCE), JSON.stringify(r.carried));
  check('the expert pins still survive too (the entry that was already there)',
    read(w.liveDir, DIAGRAM_LAYOUT) === '{"pins":1}');
  check('the refreshed payload IS the live data', read(w.liveDir, 'routes.json') === '{}' && existsSync(path.join(archiveRoot(w.id), `proposed-${w.pid}-prev`)));
  check('nothing was dropped', r.dropped.length === 0, JSON.stringify(r.dropped));
}

// ------------------------------------------------- a fresh answer must win
//
// THE TWO DECLARATIONS HERE NAME THE SAME GENERATOR, AND THAT IS THE POINT. The
// first draft of this case had the payload switch the pack to busway, which made
// it pass under a swap carrying NO existence guard at all - the verdict was
// refusing the archived radial declaration, and the assertion was reading that
// refusal as the guard working. `prove-red-carry-forward.mjs` caught it: the
// mutation that deletes the guard SURVIVED. With both declarations radial the
// verdict has nothing to say, so the guard is the only thing that can leave the
// fresh answer standing.
console.log('\na refresh whose payload brings its own declaration');
{
  const fresh = declaration('area/gen_external_radial.js', 'import', '2026-06-06T00:00:00.000Z');
  const w = world(
    { 'routes.json': '{}', 'gen_external.js': RADIAL_SRC, [ENGINE_SOURCE]: declaration('area/gen_external_radial.js') },
    { 'routes.json': '{}', 'gen_external.js': RADIAL_SRC, [ENGINE_SOURCE]: fresh },
  );
  const r = swapInProposedData(w.id, w.pid);
  check('the payload\'s own declaration is NOT overwritten by the archived one',
    read(w.liveDir, ENGINE_SOURCE) === fresh, String(read(w.liveDir, ENGINE_SOURCE)));
  check('...and nothing claims to have carried it', !r.carried.includes(ENGINE_SOURCE), JSON.stringify(r.carried));
}

// ------------------------------------------------- the hazard the fix could introduce
console.log('\na refresh that changes which external generator the pack holds');
{
  const w = world(
    { 'routes.json': '{}', 'gen_external.js': RADIAL_SRC, [ENGINE_SOURCE]: declaration('area/gen_external_radial.js') },
    { 'routes.json': '{"busway":[["A"],["B"]]}', 'gen_external.js': BUSWAY_SRC },   // no declaration of its own
  );
  const r = swapInProposedData(w.id, w.pid);
  check('a stale radial declaration is NOT carried onto a busway pack',
    read(w.liveDir, ENGINE_SOURCE) === null, String(read(w.liveDir, ENGINE_SOURCE)));
  check('...and the refusal says which way round it disagreed',
    r.dropped.length === 1 && /declared radial/.test(r.dropped[0].why) && /busway generator/.test(r.dropped[0].why),
    JSON.stringify(r.dropped));
}

// ------------------------------------------------- the verdict on its own
console.log('\nengineSourceVerdict, directly');
{
  const d = path.join(scratch, 'verdict');
  mkdirSync(d, { recursive: true });
  const declPath = path.join(scratch, 'decl.json');

  writeFileSync(declPath, declaration('area/gen_external_radial.js'));
  writeFileSync(path.join(d, 'gen_external.js'), RADIAL_SRC);
  check('radial declared, radial on disk → kept', engineSourceVerdict(declPath, d).keep === true);

  writeFileSync(path.join(d, 'gen_external.js'), BUSWAY_SRC);
  check('radial declared, busway on disk → dropped', engineSourceVerdict(declPath, d).keep === false);

  writeFileSync(declPath, declaration('area/gen_external_busway.js'));
  check('busway declared, busway on disk → kept', engineSourceVerdict(declPath, d).keep === true);

  // Moot, not wrong: a declaration about a file this pack does not have says
  // nothing false about the pack, and a place map that somehow carries one must
  // not be punished for it.
  rmSync(path.join(d, 'gen_external.js'));
  check('the declared file is absent → moot, still kept', engineSourceVerdict(declPath, d).keep === true);

  writeFileSync(declPath, '{ this is not json');
  check('an unreadable declaration is dropped, not carried',
    engineSourceVerdict(declPath, d).keep === false && /will not parse/.test(engineSourceVerdict(declPath, d).why));

  writeFileSync(declPath, JSON.stringify({ recorded: 'test', generators: {} }));
  check('a declaration naming no generator is dropped', engineSourceVerdict(declPath, d).keep === false);
}

// Best-effort: importing src/maps/store.js opens the SQLite store in the scratch
// dir, and Windows will not unlink a file the process still holds. The scratch
// lives in the OS temp dir, so a leftover is swept there rather than left in the
// repository - and a cleanup failure must not turn a green suite red.
try { rmSync(scratch, { recursive: true, force: true }); } catch { /* OS temp dir */ }
console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nall carry-forward checks passed\n');
process.exit(failures ? 1 : 0);
