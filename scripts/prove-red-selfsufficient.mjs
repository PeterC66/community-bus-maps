// prove-red-selfsufficient.mjs — falsify the widened self-sufficiency gate.
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-selfsufficient
//
// WHY THIS EXISTS. `test-engine-selfsufficient.mjs` rendered ONE sheet of the
// four it certified, and printed the same tick for one that it would have for
// four. It was widened on 2026-08-30 (OA-051) to run every generator the
// fixture's routes.json declares. **A widened gate that has only ever been seen
// green is the exact fault it was widened to fix**, one rung along: the old gate
// was green about three sheets it never touched, and a new arm that silently
// never runs would be green about them too.
//
// So each arm is broken ON PURPOSE and required to go red BY ITSELF.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `engine/` and `scripts/` are
// copied into a scratch tree and the copy is damaged; the gate resolves its own
// root from `import.meta.url`, so running the copy tests the copy's engine. No
// file here is moved aside and restored, because a harness that restores in a
// `finally` still leaves the repository broken if it is killed between the two.
//
// FOUR RUNS. One control and three mutations, and the control is not decoration
// — every arm going red at once would mean the copy is broken, not the gate.
//
//   0  control — an intact copy                  -> exit 0, every arm green
//   1  engine/dash_fit.js removed                -> the EXTERNAL arm red,
//                                                    the internal arm still green
//   2  engine/expert/schematize_internal.js gone -> the SCHEMATIC arm red,
//                                                    the internal arm still green
//   3  a fixture that declares no internalDiagram-> the gate reports THREE sheets
//
// 1 IS THE CASE THE ROW NAMED. `gen_external_radial.js` began requiring
// `dash_fit.js` at load on 2026-08-30; a delivered pack has no sibling modules,
// so that require has to resolve through SKILL_ASSETS into `engine/`. Before the
// widening, deleting `dash_fit.js` from the portal broke every area map's
// external sheet at preview time and this gate still printed its tick.
//
// 2 IS THE CASE NOBODY WOULD HAVE THOUGHT OF, and it earned itself on the first
// run of the widened gate. The P7 arms spawn child processes two deep, so the
// module recorder has to travel in NODE_OPTIONS; a recorder that failed to
// arrive would leave those arms reporting a render nobody watched. Breaking a
// module that ONLY the schematic path loads is what proves that arm is really
// executing the thing it names.
//
// 3 IS THE COVERAGE PROPERTY ITSELF, and it is the one a verdict cannot express.
// The gate must count its sheets off the fixture, not off a constant — otherwise
// the next sheet family added to a map is certified by a number.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

/** A scratch copy of the portal's engine and scripts, ready to be damaged. */
function scratchPortal() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'prove-selfsuff-'));
  cpSync(path.join(ROOT, 'engine'), path.join(tmp, 'engine'), { recursive: true });
  cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function runGate(tmp, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  const res = spawnSync(process.execPath, ['--env-file-if-exists=.env', path.join(tmp, 'scripts', 'test-engine-selfsufficient.mjs')],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}

/** Split the gate's output into one block per `— <sheet>` heading. */
function arms(out) {
  const map = new Map();
  let cur = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^— (\S+)/);
    if (m) { cur = m[1]; map.set(cur, []); continue; }
    if (cur) map.get(cur).push(line);
  }
  return map;
}
const armRed = (out, sheet) => (arms(out).get(sheet) || []).some((l) => l.includes('✗'));
const armSeen = (out, sheet) => arms(out).has(sheet);

/* ---- 0: the control ---------------------------------------------------- */
console.log('\n0  an intact copy — the control');
{
  const tmp = scratchPortal();
  const { out, code } = runGate(tmp);
  if (code !== 0) fail(`the intact copy exits ${code}. Nothing below can be trusted: the copy is broken, not the gate.\n${out}`);
  else ok('exit 0');
  for (const sheet of ['internal.svg', 'external.svg', 'internal-schematic.svg', 'internal-diagram.svg']) {
    if (!armSeen(out, sheet)) fail(`no arm for ${sheet} — the fixture this ran against does not declare all four, so cases 1 and 2 prove less than they claim`);
    else if (armRed(out, sheet)) fail(`${sheet} is red on an intact copy`);
    else ok(`${sheet} green`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 1: the case the row named ----------------------------------------- */
console.log('\n1  engine/dash_fit.js removed — the EXTERNAL arm must go red alone');
{
  const tmp = scratchPortal();
  const victim = path.join(tmp, 'engine', 'dash_fit.js');
  if (!existsSync(victim)) fail('engine/dash_fit.js is not there to remove — if it was deliberately un-vendored, this case needs rewriting round whatever gen_external_radial.js requires now');
  else {
    rmSync(victim);
    const { out, code } = runGate(tmp);
    if (code === 0) fail(`exit 0 with dash_fit.js gone. This is the gap OA-051 recorded: the external sheet is uncheckable and the gate still ticks.\n${out}`);
    else ok(`exit ${code}`);
    if (!armRed(out, 'external.svg')) fail('the external arm stayed green without the module it requires at load');
    else ok('the external arm is red');
    if (armRed(out, 'internal.svg')) fail('the internal arm went red too — this mutation is not specific, so it does not prove the external arm runs');
    else ok('the internal arm is still green');
  }
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 2: the arm two processes down ------------------------------------- */
console.log('\n2  engine/expert/schematize_internal.js removed — the SCHEMATIC arm must go red alone');
{
  const tmp = scratchPortal();
  const victim = path.join(tmp, 'engine', 'expert', 'schematize_internal.js');
  if (!existsSync(victim)) fail('engine/expert/schematize_internal.js is not there to remove');
  else {
    rmSync(victim);
    const { out, code } = runGate(tmp);
    if (code === 0) fail(`exit 0 with the schematic pre-stage gone — the P7 arm is not really executing.\n${out}`);
    else ok(`exit ${code}`);
    if (!armRed(out, 'internal-schematic.svg')) fail('the schematic arm stayed green without its pre-stage');
    else ok('the schematic arm is red');
    if (armRed(out, 'internal.svg')) fail('the internal arm went red too — not specific');
    else ok('the internal arm is still green');
  }
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 3: the coverage property ------------------------------------------ */
console.log('\n3  a fixture declaring no internalDiagram — the gate must certify THREE sheets, not four');
{
  const tmp = scratchPortal();
  // Find the fixture this machine actually uses, by asking the gate.
  const probe = runGate(tmp);
  const m = probe.out.match(/^· fixture: (.+?)\s+\((?:env|committed)\)/m);
  if (!m) fail('could not read the fixture path back out of the gate output');
  else {
    const fixCopy = path.join(tmp, 'fixture');
    cpSync(m[1].trim(), fixCopy, { recursive: true });
    const rjp = path.join(fixCopy, 'routes.json');
    const rj = JSON.parse(readFileSync(rjp, 'utf8'));
    if (!rj.internalDiagram) fail('this fixture does not declare internalDiagram, so there is nothing to take away');
    else {
      delete rj.internalDiagram;
      writeFileSync(rjp, JSON.stringify(rj, null, 2));
      const { out, code } = runGate(tmp, { FIXTURE_DIR: fixCopy });
      if (!/· sheets : 3 —/.test(out)) fail(`the gate did not drop to three sheets:\n${out.split('\n').filter((l) => l.startsWith('· sheets')).join('\n') || '(no sheets line)'}`);
      else ok('it reports three sheets');
      if (armSeen(out, 'internal-diagram.svg')) fail('it still ran the diagram arm for a fixture that no longer declares one');
      else ok('no diagram arm');
      if (!/on all 3 sheets this fixture declares/.test(out)) fail('the closing line does not say how many sheets it certified — the count is the whole point');
      else ok('the closing line names the count');
      if (code !== 0) fail(`exit ${code} on a fixture that is merely smaller`);
      else ok('exit 0');
    }
  }
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (failures) { console.error(`✗ prove-red-selfsufficient: ${failures} assertion(s) failed.`); process.exitCode = 1; }
else console.log('✓ prove-red-selfsufficient: 3 mutations and 1 control — each arm goes red by itself, and the count follows the fixture.');
