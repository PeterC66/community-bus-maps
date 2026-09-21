// prove-red-fixture-drift.mjs — falsify the FIXTURE_DIR drift warning.
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-fixture-drift
//
// WHY THIS EXISTS. The warning it falsifies exists because a check went quiet:
// this laptop's `.env` aimed FIXTURE_DIR at a six-day-old render while CI gated
// the committed fixture, and `npm run verify` printed the same thing on both
// machines while proving different things (OA-180). Adding a warning to fix a
// silence and never watching it speak is the same fault one rung along, and a
// warning is a softer target than a gate: it changes no exit code, so nothing
// downstream notices when it stops firing.
//
// So the drift check is driven over seven scratch trees and required to speak on
// exactly the two that deserve it — and, just as hard, to stay SILENT on the
// five that do not. A warning that fires on a current fixture is a warning
// nobody reads by the end of the week.
//
//   0  env == the committed pack        -> silent, and resolution unchanged
//   1  env OLDER than committed         -> warns, and NAMES the town
//   2  env NEWER than committed         -> silent (a rollout not yet mirrored
//                                          into the committed fixture is not a
//                                          fault, and crying wolf there is)
//   3  env pack with no build-meta.json -> says it CANNOT TELL, not nothing
//   4  env town with no committed twin  -> silent (Huntingdon has no committed
//                                          fixture; it cannot be behind one)
//   5  FIXTURE_DIR unset (the CI shape) -> silent, source `committed`
//   6  a place env path that IS the committed fixture -> silent (how
//                                          PLACE_FIXTURE_DIR is actually set on
//                                          this laptop; place packs carry no
//                                          build-meta.json, so a version of this
//                                          that compared them would print case
//                                          3's line on every place run for ever)
//
// 0 CARRIES THE PROPERTY A VERDICT CANNOT: the fixtures returned must be exactly
// what they were before the check existed. This warning is advisory by design —
// the whole argument for pointing the local gate at the live render tree is that
// it is STRONGER than the committed pack — so a version of it that quietly
// repointed anything would have broken the thing it was written to protect.
//
// SIX MORE TREES JOINED ON 2026-09-01 (OA-211), thirteen in all, and they belong
// to the RESOLUTION that replaced the nagging rather than to the warning. They
// are documented where they are, below case 6. The paragraph above still holds
// exactly as written — every tree up there has no `manifest.json`, so nothing is
// resolvable and nothing moves — but read it as being about this WARNING, not
// about the resolver: what it ruled out was repointing QUIETLY, and away from
// the live tree. The resolver moves an entry only FORWARD, only within the tree
// the variable already chose, and prints what it did.
//
// IT TOUCHES NOTHING REAL. Every tree is built under os.tmpdir() from a handful
// of one-line JSON files; the repository's own fixtures are never read, and the
// ambient FIXTURE_DIR / PLACE_FIXTURE_DIR / BUSES_DIR are stripped from the
// child environment so a developer's .env cannot make this pass or fail.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIB = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'fixtures.mjs')).href;
let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

const OLD = '2026-08-24T15:03:42.985Z';
const CURRENT = '2026-08-30T05:06:52.178Z';
const AHEAD = '2026-09-01T06:00:00.000Z';

/** One pack: a folder, optionally with a build-meta.json carrying `builtAt`. */
function pack(dir, builtAt) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'routes.json'), '{}');
  if (builtAt) writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify({ generator: 'gen_internal.js', builtAt }));
  return dir;
}

/** A buses-data-shaped tree: a committed St Ives fixture and five live renders. */
function tree() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'prove-drift-'));
  pack(path.join(tmp, 'Areas', '_portal-fixture', 'St Ives'), CURRENT);
  pack(path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v1.0_old'), OLD);
  pack(path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v2.0_current'), CURRENT);
  pack(path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v3.0_ahead'), AHEAD);
  pack(path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v4.0_nometa'), null);
  pack(path.join(tmp, 'Areas', 'Huntingdon', 'S5-render', 'v1.0_old'), OLD);
  pack(path.join(tmp, 'Places', '_portal-fixture', 'High Wycombe Aldi'), null);
  return tmp;
}

/**
 * Resolve one kind in a child process and hand back everything it printed.
 * The child prints a RESULT line so the resolution itself can be asserted, not
 * only the warning: a check that changed what was resolved would pass a test
 * that only read the warnings.
 */
function resolve(kind, env) {
  const clean = { ...process.env };
  delete clean.FIXTURE_DIR; delete clean.PLACE_FIXTURE_DIR; delete clean.BUSES_DIR;
  const code = `import(${JSON.stringify(LIB)}).then((m) => { const r = m.resolveFixtures(${JSON.stringify(kind)}); console.log('RESULT ' + JSON.stringify(r)); });`;
  const res = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...clean, ...env }, encoding: 'utf8' });
  const lines = ((res.stdout || '') + (res.stderr || '')).split('\n');
  const line = lines.find((l) => l.startsWith('RESULT '));
  // `out` is what the RESOLVER said, with the RESULT line taken back out. It has
  // to be: that line is the fixture path in JSON, so it contains the town name
  // and every "does the warning name X" assertion below would be satisfied by
  // the wrong clause — green with the warning deleted entirely. Measured, not
  // assumed: it was, until the removal mutation was actually run.
  return { out: lines.filter((l) => l !== line).join('\n'), code: res.status, result: line ? JSON.parse(line.slice(7)) : null };
}

const warned = (out) => out.includes('⚠');

/* ---- 0: the control ---------------------------------------------------- */
console.log('\n0  FIXTURE_DIR at a render as new as the committed fixture — silent, and unchanged');
{
  const tmp = tree();
  const dir = path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v2.0_current');
  const { out, result } = resolve('area', { FIXTURE_DIR: dir });
  if (warned(out)) fail(`a current fixture produced a warning. Nothing below can be trusted — this is the case that must be quiet.\n${out}`);
  else ok('no warning');
  if (!result || result.source !== 'env') fail(`source is ${result && result.source}, not env — the drift check changed what was resolved`);
  else ok('source is still env');
  if (!result || result.fixtures.length !== 1 || result.fixtures[0] !== dir) fail('the resolved fixture list is not the one FIXTURE_DIR named');
  else ok('the resolved list is untouched');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 1: the case the row named ----------------------------------------- */
console.log('\n1  FIXTURE_DIR six days behind the committed fixture — must warn, and name the town');
{
  const tmp = tree();
  const dir = path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v1.0_old');
  const { out, result } = resolve('area', { FIXTURE_DIR: dir });
  if (!warned(out)) fail(`silent on a stale FIXTURE_DIR. This is exactly OA-180: the laptop and CI gate different packs and nothing says so.\n${out}`);
  else ok('warned');
  if (!out.includes('BEHIND')) fail('the warning does not say the fixture is BEHIND — a reader cannot tell which way the drift runs');
  else ok('it says BEHIND');
  if (!out.includes('St Ives')) fail('the warning does not name the town, so a three-town list would not say which entry is stale');
  else ok('it names the town');
  if (!out.includes(OLD) || !out.includes(CURRENT)) fail('the warning does not print both builtAt stamps, so the reader cannot check it');
  else ok('it prints both builtAt stamps');
  if (!result || result.fixtures[0] !== dir) fail('the stale fixture was not returned — the warning must not repoint anything');
  else ok('the stale fixture is still what was resolved');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 2: the other direction, which must NOT warn ----------------------- */
console.log('\n2  FIXTURE_DIR NEWER than the committed fixture — silent');
{
  const tmp = tree();
  const { out } = resolve('area', { FIXTURE_DIR: path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v3.0_ahead') });
  if (warned(out)) fail(`warned about a fixture that is AHEAD of the committed one. That is the normal state between a rollout and the next fixture refresh, and a warning there is one nobody reads.\n${out}`);
  else ok('no warning');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 3: cannot tell, and says so --------------------------------------- */
console.log('\n3  a pack with no build-meta.json — must say it cannot tell');
{
  const tmp = tree();
  const { out } = resolve('area', { FIXTURE_DIR: path.join(tmp, 'Areas', 'St Ives', 'S5-render', 'v4.0_nometa') });
  if (!out.includes('cannot tell')) fail(`silent when it could not compare. Silence here reads as "current", which is the shape of the original fault.\n${out}`);
  else ok('it says it cannot tell');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 4: no committed counterpart --------------------------------------- */
console.log('\n4  a town with no committed fixture — silent, however old it is');
{
  const tmp = tree();
  const { out } = resolve('area', { FIXTURE_DIR: path.join(tmp, 'Areas', 'Huntingdon', 'S5-render', 'v1.0_old') });
  if (warned(out)) fail(`warned about Huntingdon, which has no committed fixture to be behind. verify:defaults names three towns and only one of them is committed; a warning on the other two is noise on every run.\n${out}`);
  else ok('no warning');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 5: the CI shape --------------------------------------------------- */
console.log('\n5  FIXTURE_DIR unset, BUSES_DIR pointing at the tree — the CI shape, silent');
{
  const tmp = tree();
  const { out, result } = resolve('area', { BUSES_DIR: tmp });
  if (warned(out)) fail(`warned with no FIXTURE_DIR set. CI has none, so this would put a warning on every run of a gate that is doing the right thing.\n${out}`);
  else ok('no warning');
  if (!result || result.source !== 'committed') fail(`source is ${result && result.source}, not committed — this case is not testing what it claims`);
  else ok('source is committed');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 6: the identity case ---------------------------------------------- */
console.log('\n6  PLACE_FIXTURE_DIR pointing AT the committed fixture — silent');
{
  const tmp = tree();
  const { out, result } = resolve('place', { PLACE_FIXTURE_DIR: path.join(tmp, 'Places', '_portal-fixture', 'High Wycombe Aldi') });
  // What delivers this silence is the counterpart clause, not a dedicated
  // identity guard: the "town" of a path inside `_portal-fixture` reads as
  // `_portal-fixture`, and no committed fixture is called that. An explicit
  // guard was written, mutated out, and this case stayed green — so it was
  // removed as dead rather than left in looking load-bearing.
  if (warned(out)) fail(`warned about the committed fixture itself. Place packs carry no build-meta.json, so a check that compared them would print case 3's line on every place run for ever.\n${out}`);
  else ok('no warning');
  if (!result || result.source !== 'env') fail('the place fixture did not resolve from the environment');
  else ok('source is env');
  rmSync(tmp, { recursive: true, force: true });
}

/* =========================================================================
 * OA-211 — RESOLVING THE VERSION INSTEAD OF NAGGING ABOUT IT (2026-09-01).
 *
 * Cases 0-6 above run on a tree with NO manifest.json, which is why every one of
 * them still asserts the resolution is untouched: an entry the resolver cannot
 * place is passed through exactly as written, so the warning still covers every
 * case it covered before. That is worth not relying on by accident, so the cases
 * below build the OTHER tree — one with a real manifest — and assert both halves.
 *
 * THE DANGEROUS DIRECTION IS SUBSTITUTING WHEN IT SHOULD NOT. A resolver that
 * moved an entry on a guess would gate a pack nobody asked for while printing
 * that everything reproduced, so four of the six cases here are ones where
 * nothing may move: a `latest` naming a run that is not listed, a run folder
 * that is not on this disk, an entry already current, and a place path with no
 * version in it at all.
 *
 *   7  env one render behind    -> advanced, and SAYS SO, naming both versions
 *   8  env already the current  -> silent, untouched (a notice on every good run
 *                                  is a notice nobody reads by Friday)
 *   9  latest not on this disk  -> untouched, and says why (S5-render is
 *                                  gitignored, so a fresh clone has none)
 *  10  latest listed in no run  -> untouched, and says why
 *  11  a pack the manifest does -> ADVANCED, deliberately; see the case
 *      not list
 *  12  a place _portal-fixture  -> untouched (no S5-render segment to resolve)
 * ========================================================================= */

/** The same tree, plus a manifest declaring which S5 render is current. */
function treeWithManifest(stagesS5) {
  const tmp = tree();
  writeFileSync(
    path.join(tmp, 'Areas', 'St Ives', 'manifest.json'),
    JSON.stringify({ town: 'St Ives', stages: { S5: { name: 'render', ...stagesS5 } } }),
  );
  return tmp;
}
const RUNS = [
  { id: 'v1.0_old', dir: 'S5-render/v1.0_old' },
  { id: 'v2.0_current', dir: 'S5-render/v2.0_current' },
  { id: 'v3.0_ahead', dir: 'S5-render/v3.0_ahead' },
];
const at = (tmp, v) => path.join(tmp, 'Areas', 'St Ives', 'S5-render', v);

/* ---- 7: the fault this row was filed for ------------------------------- */
console.log('\n7  FIXTURE_DIR one render behind the manifest — advanced, and it says so');
{
  const tmp = treeWithManifest({ latest: 'v3.0_ahead', runs: RUNS });
  const { out, result } = resolve('area', { FIXTURE_DIR: at(tmp, 'v1.0_old') });
  if (!result || result.fixtures[0] !== at(tmp, 'v3.0_ahead')) fail(`the entry was not advanced to the manifest's current render — resolved ${result && result.fixtures[0]}`);
  else ok('advanced to the current render');
  if (!out.includes('v1.0_old') || !out.includes('v3.0_ahead')) fail('the substitution does not print BOTH versions, so the reader cannot see what was swapped');
  else ok('it prints both versions');
  // READ THE SUBSTITUTION LINE, NOT THE WHOLE STREAM. `out.includes('St Ives')`
  // was written here first and it was satisfied by the stale-fixture WARNING,
  // which names the town too — so it stayed green under the mutation that
  // deleted the advance entirely. An assertion a neighbouring clause can satisfy
  // is not evidence about the clause it was written for.
  const line = out.split('\n').find((l) => l.includes('gating its current render instead'));
  if (!line || !line.includes('St Ives')) fail('the substitution line does not name the map, so a three-town list would not say which entry moved');
  else ok('the substitution line names the map');
  if (warned(out)) fail(`it advanced the entry AND warned it was behind. The advance runs first precisely so the warning is left saying something still true.\n${out}`);
  else ok('no stale warning left over after advancing');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 8: the control that keeps case 7 readable ------------------------- */
console.log("\n8  FIXTURE_DIR already at the manifest's current render — silent, untouched");
{
  const tmp = treeWithManifest({ latest: 'v3.0_ahead', runs: RUNS });
  const { out, result } = resolve('area', { FIXTURE_DIR: at(tmp, 'v3.0_ahead') });
  if (!result || result.fixtures[0] !== at(tmp, 'v3.0_ahead')) fail('a current entry was changed');
  else ok('untouched');
  if (out.includes('gating its current render instead')) fail(`it announced a substitution it did not make. A notice on every correct run is one nobody reads.\n${out}`);
  else ok('silent');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 9: the fresh-clone shape ------------------------------------------ */
console.log("\n9  the manifest's current render is not on this disk — untouched, and says why");
{
  const tmp = treeWithManifest({ latest: 'v9.9_gone', runs: [...RUNS, { id: 'v9.9_gone', dir: 'S5-render/v9.9_gone' }] });
  const { out, result } = resolve('area', { FIXTURE_DIR: at(tmp, 'v1.0_old') });
  if (!result || result.fixtures[0] !== at(tmp, 'v1.0_old')) fail('it resolved to a folder that does not exist');
  else ok('untouched');
  if (!out.includes('could not read the current render')) fail(`silent when it could not resolve. Silence here reads as "this entry is current", which is the shape of the original fault.\n${out}`);
  else ok('it says why it could not');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 10: a manifest that contradicts itself ---------------------------- */
console.log('\n10 the manifest names a current render it lists no run for — untouched, and says why');
{
  const tmp = treeWithManifest({ latest: 'v3.0_ahead', runs: [RUNS[0], RUNS[1]] });
  const { out, result } = resolve('area', { FIXTURE_DIR: at(tmp, 'v1.0_old') });
  if (!result || result.fixtures[0] !== at(tmp, 'v1.0_old')) fail('it moved the entry on a manifest that does not say where to');
  else ok('untouched');
  if (!out.includes('could not read the current render')) fail(`silent on a self-contradictory manifest.\n${out}`);
  else ok('it says why it could not');
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 11: a pack the manifest has never heard of ------------------------ */
console.log('\n11 FIXTURE_DIR names a render the manifest does not list — advanced anyway, on purpose');
{
  const tmp = treeWithManifest({ latest: 'v3.0_ahead', runs: RUNS });
  const dir = pack(at(tmp, 'v5.0_byhand'), OLD);
  const { result } = resolve('area', { FIXTURE_DIR: dir });
  // ASSERTED SO THAT IT IS A DECISION RATHER THAN AN ACCIDENT. A hand-built pack
  // under `S5-render/` is still that map's render tree, and the manifest is
  // still the authority on which render is current, so advancing it is the same
  // answer as case 7 rather than a special case. If somebody later wants a pack
  // the manifest does not list left alone, this is the assertion to flip and
  // `newest-render.mjs` is where the clause would go.
  if (!result || result.fixtures[0] !== at(tmp, 'v3.0_ahead')) fail(`an unlisted pack resolved to ${result && result.fixtures[0]} — expected the manifest's current render`);
  else ok("advanced to the manifest's current render, like any other entry");
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 12: places have no version to resolve ----------------------------- */
console.log('\n12 PLACE_FIXTURE_DIR at a committed pack — no S5-render segment, untouched');
{
  const tmp = treeWithManifest({ latest: 'v3.0_ahead', runs: RUNS });
  const dir = path.join(tmp, 'Places', '_portal-fixture', 'High Wycombe Aldi');
  const { out, result } = resolve('place', { PLACE_FIXTURE_DIR: dir });
  if (!result || result.fixtures[0] !== dir) fail('a committed place pack was repointed — it carries no version and has nothing to advance to');
  else ok('untouched');
  if (out.includes('gating its current render instead')) fail(`it announced a substitution on a place pack.\n${out}`);
  else ok('silent');
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`x ${failures} check(s) failed — the FIXTURE_DIR resolution does not do what OA-180 and OA-211 asked of it.`);
  process.exit(1);
}
console.log('+ the drift warning speaks on both cases that deserve it and stays silent on the five that do not,');
console.log('  and the version resolution moves an entry on exactly one of its six trees');
console.log('  (13 trees, nothing touched outside the temp dir).');
