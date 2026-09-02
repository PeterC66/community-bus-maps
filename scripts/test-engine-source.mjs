// Which vendored generator a pack's copy came from (OA-143).
//
//   node scripts/test-engine-source.mjs        (or: npm run test:engine-source)
//
// An AREA pack stores its external generator as `gen_external.js` and the portal
// vendors two of them, so the filename cannot say which. `track-engine.mjs` used
// to skip every such pack — eight of eighteen live maps, every run, which was
// every town's external sheet. The fix records the answer where it is known and
// forbids guessing everywhere else, so these tests are mostly about the REFUSALS:
// a tracker that started guessing would pass every "it tracks" assertion here and
// silently overwrite a busway map with the radial generator.
//
// Runs entirely against throwaway directories; it never touches the real store,
// and it needs no database.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const HERE = import.meta.dirname;
const TRACK = path.resolve(HERE, 'track-engine.mjs');
const BACKFILL = path.resolve(HERE, 'backfill-engine-source.mjs');

/* A whole scratch WORLD: its own data store AND its own engine/, so the two
 * candidate generators are files this test wrote and can tell apart by content.
 * Pointing at the real engine/ would make "did it copy the right one?" depend on
 * two 1,000-line files being different in some way the assertion happens to see. */
function world() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cbm-engine-source-'));
  mkdirSync(path.join(root, 'engine', 'area'), { recursive: true });
  mkdirSync(path.join(root, 'engine', 'place'), { recursive: true });
  // The real busway generator dereferences D.busway[0]; the real radial never
  // mentions .busway. The stubs carry the same tell, because that is the signal
  // the backfill reads.
  writeFileSync(path.join(root, 'engine', 'area', 'gen_external_radial.js'), '// RADIAL v2\n');
  writeFileSync(path.join(root, 'engine', 'area', 'gen_external_busway.js'), '// BUSWAY v2\nconst A=D.busway[0];\n');
  writeFileSync(path.join(root, 'engine', 'place', 'gen_internal.js'), '// INTERNAL v2\n');
  return root;
}

/* One map pack. `style` decides what the STORED generator and routes.json look
 * like — deliberately settable independently, so a pack whose two signals
 * disagree can be built and the refusal tested. */
function pack(root, id, { data = 'radial', code = 'radial', declares = undefined, engineDir = null } = {}) {
  const d = path.join(root, 'data', 'maps', String(id), 'data');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'routes.json'),
    JSON.stringify(data === 'busway' ? { busway: [['A'], ['B']] } : { town: 'Somewhere' }));
  writeFileSync(path.join(d, 'gen_external.js'),
    code === 'busway' ? '// FROZEN BUSWAY v1\nconst A=D.busway[0];\n' : '// FROZEN RADIAL v1\n');
  // Deliberately ALREADY CURRENT, so the "1 BEHIND" asserted below can only be
  // the external one — an internal that also needed tracking would make the
  // count ambiguous and let the assertion pass for the wrong reason.
  writeFileSync(path.join(d, 'gen_internal.js'), '// INTERNAL v2\n');
  if (declares !== undefined) {
    writeFileSync(path.join(d, 'engine-source.json'),
      typeof declares === 'string' ? declares
        : JSON.stringify({ recorded: 'test', at: '2026-01-01T00:00:00.000Z', generators: declares }));
  }
  void engineDir;
  return d;
}

function run(script, root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, DATA_DIR: path.join(root, 'data') },
      cwd: root,
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

/* track-engine.mjs and backfill resolve engine/ relative to their OWN location,
 * so the scratch world gets its own copy of both scripts beside its engine/ —
 * and of everything they import, because a module that is not here fails with
 * ERR_MODULE_NOT_FOUND on every case at once, which reads as nine broken
 * assertions rather than as one missing file. `lib/vendored.mjs` and
 * `src/db/paths.js` joined the list on 2026-09-02 (OA-224 Tier 3.3 and 3.6),
 * when the two scripts stopped carrying their own copies of the CRLF-normalised
 * file hash and of the DATA_DIR resolution. That is the cost of sharing a
 * helper, paid once here, against two more copies of a hash rule in the tree. */
function install(root) {
  mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'db'), { recursive: true });
  for (const f of ['track-engine.mjs', 'backfill-engine-source.mjs']) {
    writeFileSync(path.join(root, 'scripts', f), readFileSync(path.join(HERE, f)));
  }
  for (const f of ['engine-source.mjs', 'vendored.mjs']) {
    writeFileSync(path.join(root, 'scripts', 'lib', f), readFileSync(path.join(HERE, 'lib', f)));
  }
  writeFileSync(path.join(root, 'src', 'db', 'paths.js'),
    readFileSync(path.resolve(HERE, '..', 'src', 'db', 'paths.js')));
  return {
    track: path.join(root, 'scripts', 'track-engine.mjs'),
    backfill: path.join(root, 'scripts', 'backfill-engine-source.mjs'),
  };
}

console.log('\n== engine-source: which external generator a pack came from (OA-143) ==\n');

// ---------------------------------------------------------------- the tracker
{
  const root = world(); const S = install(root);
  pack(root, 1, { declares: { 'gen_external.js': 'area/gen_external_radial.js' } });
  const before = run(S.track, root);
  check('a pack that DECLARES its external generator is reported as behind, not skipped',
    /gen_external\.js/.test(before.stdout) && /1 BEHIND/.test(before.stdout) && /0 skipped/.test(before.stdout),
    before.stdout);
  check('...and the report names the vendored file it will use',
    /area\/gen_external_radial\.js/.test(before.stdout), before.stdout);

  run(S.track, root, ['--apply']);
  const got = readFileSync(path.join(root, 'data', 'maps', '1', 'data', 'gen_external.js'), 'utf8');
  check('--apply copies the declared generator', got === '// RADIAL v2\n', JSON.stringify(got));
  check('...and NOT the other candidate', !/BUSWAY/.test(got), got);
  const after = run(S.track, root);
  check('a tracked pack then reports current, and the run exits 0',
    /0 BEHIND/.test(after.stdout) && after.code === 0, after.stdout);
  rmSync(root, { recursive: true, force: true });
}

// A busway pack must get the BUSWAY file. Without this, "it tracks" is satisfied
// by a tracker hardcoded to radial — which is the corruption this row refuses.
{
  const root = world(); const S = install(root);
  pack(root, 1, { data: 'busway', code: 'busway', declares: { 'gen_external.js': 'area/gen_external_busway.js' } });
  run(S.track, root, ['--apply']);
  const got = readFileSync(path.join(root, 'data', 'maps', '1', 'data', 'gen_external.js'), 'utf8');
  check('a busway pack is given the BUSWAY generator, not the radial one',
    got.includes('BUSWAY v2'), JSON.stringify(got));
  rmSync(root, { recursive: true, force: true });
}

{
  const root = world(); const S = install(root);
  pack(root, 1, {});                                   // declares nothing
  const r = run(S.track, root);
  check('a pack that declares NOTHING is still skipped — the tracker never guesses',
    /1 skipped/.test(r.stdout) && /which one is not recorded/.test(r.stdout), r.stdout);
  const got = readFileSync(path.join(root, 'data', 'maps', '1', 'data', 'gen_external.js'), 'utf8');
  run(S.track, root, ['--apply']);
  check('...and --apply leaves its generator untouched',
    readFileSync(path.join(root, 'data', 'maps', '1', 'data', 'gen_external.js'), 'utf8') === got);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = world(); const S = install(root);
  pack(root, 1, { declares: { 'gen_external.js': 'area/gen_external_nosuch.js' } });
  const r = run(S.track, root);
  check('a pack naming a generator the engine does not vendor is REPORTED, not silently skipped',
    /is not vendored/.test(r.stdout), r.stdout);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = world(); const S = install(root);
  pack(root, 1, { declares: '{ this is not json' });
  const r = run(S.track, root);
  check('an unreadable declaration is "answered but we cannot hear it", not "absent"',
    /will not parse/.test(r.stdout), r.stdout);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the backfill
console.log('');
{
  const root = world(); const S = install(root);
  pack(root, 1, { data: 'radial', code: 'radial' });
  const dry = run(S.backfill, root);
  check('the backfill writes nothing without --apply',
    /1 to record/.test(dry.stdout) && !existsSync(path.join(root, 'data', 'maps', '1', 'data', 'engine-source.json')),
    dry.stdout);

  run(S.backfill, root, ['--apply']);
  const rec = JSON.parse(readFileSync(path.join(root, 'data', 'maps', '1', 'data', 'engine-source.json'), 'utf8'));
  check('two agreeing signals are recorded as radial',
    rec.generators['gen_external.js'] === 'area/gen_external_radial.js', JSON.stringify(rec));
  check('...and the record says it was a backfill, not an import', rec.recorded === 'backfill');

  const again = run(S.backfill, root);
  check('running it twice is a no-op',
    /0 to record/.test(again.stdout) && /1 already declared/.test(again.stdout), again.stdout);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = world(); const S = install(root);
  pack(root, 1, { data: 'busway', code: 'busway' });
  run(S.backfill, root, ['--apply']);
  const rec = JSON.parse(readFileSync(path.join(root, 'data', 'maps', '1', 'data', 'engine-source.json'), 'utf8'));
  check('a genuine busway pack is recorded as BUSWAY — the answer is not hardcoded',
    rec.generators['gen_external.js'] === 'area/gen_external_busway.js', JSON.stringify(rec));
  rmSync(root, { recursive: true, force: true });
}

// THE ONE THAT MATTERS. Either signal alone would happily answer here; the
// migration must refuse instead, and must write nothing at all.
{
  const root = world(); const S = install(root);
  pack(root, 1, { data: 'radial', code: 'busway' });
  const r = run(S.backfill, root, ['--apply']);
  check('when the two signals DISAGREE nothing is written',
    !existsSync(path.join(root, 'data', 'maps', '1', 'data', 'engine-source.json')), r.stdout);
  check('...the disagreement is reported in words',
    /THE TWO SIGNALS DISAGREE/.test(r.stdout), r.stdout);
  check('...and the run exits non-zero', r.code !== 0, `exit ${r.code}`);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = world(); const S = install(root);
  const d = pack(root, 1, {});
  rmSync(path.join(d, 'routes.json'));
  const r = run(S.backfill, root, ['--apply']);
  check('a pack with no readable routes.json is undecided, not assumed',
    /cannot tell/.test(r.stdout) && !existsSync(path.join(d, 'engine-source.json')), r.stdout);
  rmSync(root, { recursive: true, force: true });
}

{
  const root = world(); const S = install(root);
  // A PLACE pack — no gen_external.js at all. It must not be counted as an area
  // pack awaiting an answer, or the migration reports work that does not exist.
  const d = path.join(root, 'data', 'maps', '9', 'data');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'gen_external_places.js'), '// PLACE\n');
  const r = run(S.backfill, root);
  check('a place pack is not counted as an area pack',
    /0 to record/.test(r.stdout) && /1 not area packs/.test(r.stdout), r.stdout);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the importer
//
// THE HALF THAT STOPS THIS RECURRING. Backfilling the eight existing packs fixes
// today; recording the answer at import is what stops the ninth arriving
// undeclared. These two run the real `import-map.mjs` against a throwaway
// DATA_DIR and a throwaway database, because the contract is about what it does
// to a pack on disk and a stub would only test the stub.
console.log('');
{
  const store = mkdtempSync(path.join(os.tmpdir(), 'cbm-engine-source-import-'));
  const src = path.join(store, 'payload');
  mkdirSync(src, { recursive: true });
  // A generator-free area payload — which is EVERY real area delivery, since the
  // skill stopped staging generators on 2026-08-04. This is the path that reaches
  // for the vendored engine, and so the path that knows the answer.
  writeFileSync(path.join(src, 'routes.json'), JSON.stringify({ palette: { 55: '#000000' } }));
  writeFileSync(path.join(src, 'external.svg'), '<svg/>');
  writeFileSync(path.join(src, 'internal.svg'), '<svg/>');

  /* THE IMPORTER EXITS NON-ZERO HERE, AND THAT IS EXPECTED. It copies the
   * payload, records provenance, and THEN renders — and a stub payload cannot
   * draw a sheet, so it dies at renderVersion(). `test-lifecycle.mjs` declines
   * to build a real payload for the same reason ("rendering needs the real
   * engine + a real payload"), and the contract under test here is what the
   * importer writes into the pack, which happens before the render. So every
   * check below asserts pack CONTENTS rather than an exit code, and asserts
   * them positively, so a run that did nothing at all cannot pass. */
  const IMPORTER = path.resolve(HERE, 'import-map.mjs');
  const importRun = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [IMPORTER, ...args],
        { encoding: 'utf8', env: { ...process.env, DATA_DIR: store } }) };
    } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
  };

  const r = importRun(['--src', src, '--name', 'Provenance Town', '--customer', 'Test Council', '--kind', 'area']);
  const packs = existsSync(path.join(store, 'maps')) ? readdirSync(path.join(store, 'maps')) : [];
  const dataDir = packs.length ? path.join(store, 'maps', packs[0], 'data') : null;
  const decl = dataDir && existsSync(path.join(dataDir, 'engine-source.json'))
    ? JSON.parse(readFileSync(path.join(dataDir, 'engine-source.json'), 'utf8')) : null;

  check('importing a generator-free area payload records the external generator it staged',
    decl && decl.generators['gen_external.js'] === 'area/gen_external_radial.js',
    r.code !== 0 ? `import exited ${r.code}: ${r.out.slice(-400)}` : JSON.stringify(decl));
  check('...and records that it came from an import, not a backfill',
    decl && decl.recorded === 'import', JSON.stringify(decl));

  // --external-style busway must reach the record, or the field is decorative on
  // every board where every town happens to be radial.
  const src2 = path.join(store, 'payload2');
  mkdirSync(src2, { recursive: true });
  writeFileSync(path.join(src2, 'routes.json'), JSON.stringify({ palette: { 55: '#000000' }, busway: [['A'], ['B']] }));
  writeFileSync(path.join(src2, 'external.svg'), '<svg/>');
  writeFileSync(path.join(src2, 'internal.svg'), '<svg/>');
  const r2 = importRun(['--src', src2, '--name', 'Busway Town', '--customer', 'Test Council', '--kind', 'area', '--external-style', 'busway']);
  const packs2 = readdirSync(path.join(store, 'maps')).filter((p) => !packs.includes(p));
  const decl2 = packs2.length && existsSync(path.join(store, 'maps', packs2[0], 'data', 'engine-source.json'))
    ? JSON.parse(readFileSync(path.join(store, 'maps', packs2[0], 'data', 'engine-source.json'), 'utf8')) : null;
  check('--external-style busway is recorded as busway, not as the default',
    decl2 && decl2.generators['gen_external.js'] === 'area/gen_external_busway.js',
    r2.code !== 0 ? `import exited ${r2.code}: ${r2.out.slice(-400)}` : JSON.stringify(decl2));

  // A payload carrying its OWN generator may have a hand-edited one, and a
  // hand-edited generator must never be overwritten by the vendored file.
  // Leaving it undeclared is what keeps the tracker off it — a feature, not a gap.
  const src3 = path.join(store, 'payload3');
  mkdirSync(src3, { recursive: true });
  writeFileSync(path.join(src3, 'routes.json'), JSON.stringify({ palette: { 55: '#000000' } }));
  writeFileSync(path.join(src3, 'gen_internal.js'), '// hand-edited\n');
  writeFileSync(path.join(src3, 'gen_external.js'), '// hand-edited\n');
  writeFileSync(path.join(src3, 'external.svg'), '<svg/>');
  writeFileSync(path.join(src3, 'internal.svg'), '<svg/>');
  const before3 = readdirSync(path.join(store, 'maps'));
  const r3 = importRun(['--src', src3, '--name', 'Hand Edited Town', '--customer', 'Test Council', '--kind', 'area']);
  const packs3 = readdirSync(path.join(store, 'maps')).filter((p) => !before3.includes(p));
  const decl3 = packs3.length && existsSync(path.join(store, 'maps', packs3[0], 'data', 'engine-source.json'));
  // Asserted POSITIVELY — the pack must exist and still hold the hand-edited
  // generator — so "nothing happened" cannot satisfy it. See the note below on
  // why the importer's exit code is not the subject here.
  const gen3 = packs3.length && existsSync(path.join(store, 'maps', packs3[0], 'data', 'gen_external.js'))
    ? readFileSync(path.join(store, 'maps', packs3[0], 'data', 'gen_external.js'), 'utf8') : null;
  check('a payload carrying its OWN generator is left undeclared, so the tracker never overwrites it',
    gen3 !== null && /hand-edited/.test(gen3) && !decl3,
    `pack ${packs3[0]}: generator=${JSON.stringify(gen3)} declared=${decl3}`);

  rmSync(store, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall engine-source checks passed\n');
process.exit(failures ? 1 : 0);
