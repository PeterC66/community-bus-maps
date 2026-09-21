#!/usr/bin/env node
// prove-red-vendored-fixtures.mjs — falsify `vendor-fixtures.mjs --check`.
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-vendored-fixtures
//
// WHY. `gate-fixtures/` is a COPY (buses-data OA-398, R5). The gates that read it
// are byte gates, so a copy that has silently fallen behind its source does not
// make them red — it makes them green about last month's artwork, which is the
// quietest way this estate has ever been wrong. `--check` is the only thing that
// notices, it can only run where both trees exist, and on this repository's own
// CI it can never run at all. A check that CI cannot exercise has to be falsified
// deliberately or it is a promise.
//
// EVERY CASE BUILDS BOTH TREES IN THE TEMP DIR. Nothing reads the real
// `gate-fixtures/` and nothing reads buses-data, so this runs in a clone of the
// portal alone — which is the whole point of R5 and is why this file can sit in
// `npm test` while the byte gates sit in `verify.yml`.
//
//   0  identical trees                      -> exit 0, says "in step"   (the control)
//   1  one vendored file's bytes differ     -> exit 1, names it `differs`
//   2  a vendored file is absent            -> exit 1, names it `missing`
//   3  a vendored file the source dropped   -> exit 1, names it `stale`
//   4  a JPG in the source, not vendored    -> exit 0  (the deliberate exclusion)
//   5  a README in the source, not vendored -> exit 0  (the deliberate exclusion)
//   6  no source tree at all                -> exit 2, not 0 and not 1
//   7  no source tree, --allow-skip         -> exit 0 and SAYS nothing was proved
//
// 4 AND 5 ARE THE ONES THAT EARN THEIR PLACE. The exclusions are the half of this
// script that can go wrong quietly: widen them by a character and a real fixture
// file stops being compared, and every case above still passes. They are controls
// in the strict sense — they must stay GREEN, and a red here means the exclusion
// has eaten something it should be checking.
//
// 6 IS NOT PADDING EITHER. The house rule is exit 2 for "used wrongly / could not
// look" and exit 1 for "the thing being checked FAILED". A missing source that
// exited 1 would read, on the board and in a workflow log, exactly like a fixture
// that has gone stale — the estate's named shape *could not look, reported as a
// finding*, in the one script whose whole job is to be believed about a copy.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts', 'vendor-fixtures.mjs');
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

/* A source tree (a stand-in for buses-data) and a portal tree holding the
 * vendored copy, both under the temp dir. The portal tree needs `scripts/lib`
 * because the script under test imports the resolver from beside itself and
 * derives its own root from `import.meta.url` — so a copy of the script run out
 * of `<tmp>/scripts` treats `<tmp>` as the portal. */
function trees({ files, vendored }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'prove-vendored-'));
  const src = path.join(tmp, 'buses-data');
  const portal = path.join(tmp, 'portal');
  cpSync(path.join(ROOT, 'scripts', 'lib'), path.join(portal, 'scripts', 'lib'), { recursive: true });
  cpSync(SCRIPT, path.join(portal, 'scripts', 'vendor-fixtures.mjs'));
  const put = (root, rel, body) => {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  for (const [rel, body] of Object.entries(files)) put(src, rel, body);
  for (const [rel, body] of Object.entries(vendored)) put(path.join(portal, 'gate-fixtures'), rel, body);
  return { tmp, src, portal };
}

function run({ src, portal }, extra = []) {
  const argv = [path.join(portal, 'scripts', 'vendor-fixtures.mjs'), ...extra];
  if (src) argv.push('--buses', src);
  const r = spawnSync(process.execPath, argv, {
    cwd: portal, encoding: 'utf8',
    // BUSES_DIR must not leak in from the developer's shell: case 6 is about a
    // machine with no source, and an inherited value would make it green.
    env: { ...process.env, BUSES_DIR: '' },
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

const A = 'Areas/_portal-fixture/Town/routes.json';
const P = 'Places/_portal-fixture/Place/routes.json';
const BASE = { [A]: '{"a":1}\n', [P]: '{"p":1}\n' };

/* ---- 0: the control ----------------------------------------------------- */
console.log('\n0  identical trees — the control');
{
  const t = trees({ files: BASE, vendored: BASE });
  const { out, code } = run(t);
  if (code !== 0) fail(`exit ${code} on identical trees. Nothing below can be trusted.\n${out}`);
  else ok('exit 0');
  if (!/in step/.test(out)) fail('does not say the copy is in step');
  else ok('says "in step"');
  rmSync(t.tmp, { recursive: true, force: true });
}

/* ---- 1: a byte changed -------------------------------------------------- */
console.log('\n1  one vendored file differs by a byte');
{
  const t = trees({ files: BASE, vendored: { ...BASE, [A]: '{"a":2}\n' } });
  const { out, code } = run(t);
  if (code !== 1) fail(`exit ${code}, expected 1 — a stale copy is a finding, not a usage error`);
  else ok('exit 1');
  if (!/differs\s+Areas\/_portal-fixture\/Town\/routes\.json/.test(out)) fail(`does not name the file as differing:\n${out}`);
  else ok('names the file, and says it differs');
  rmSync(t.tmp, { recursive: true, force: true });
}

/* ---- 2: a file was never vendored --------------------------------------- */
console.log('\n2  a source file was never vendored');
{
  const t = trees({ files: BASE, vendored: { [A]: BASE[A] } });
  const { out, code } = run(t);
  if (code !== 1) fail(`exit ${code}, expected 1`);
  else ok('exit 1');
  if (!/missing\s+Places\/_portal-fixture\/Place\/routes\.json/.test(out)) fail(`does not name the absent file:\n${out}`);
  else ok('names the absent file');
  rmSync(t.tmp, { recursive: true, force: true });
}

/* ---- 3: the source stopped writing a file ------------------------------- */
console.log('\n3  a vendored file the source no longer writes');
{
  const t = trees({ files: BASE, vendored: { ...BASE, 'Areas/_portal-fixture/Town/gone.json': '{}\n' } });
  const { out, code } = run(t);
  if (code !== 1) fail(`exit ${code}, expected 1 — a file the generator stopped writing is drift too`);
  else ok('exit 1');
  if (!/stale\s+Areas\/_portal-fixture\/Town\/gone\.json/.test(out)) fail(`does not name the orphan:\n${out}`);
  else ok('names the orphan');
  rmSync(t.tmp, { recursive: true, force: true });
}

/* ---- 4 and 5: the exclusions, which must stay green --------------------- */
for (const [n, rel, what] of [[4, 'Areas/_portal-fixture/Town/internal.jpg', 'a JPG'],
  [5, 'Areas/_portal-fixture/README.md', 'a README']]) {
  console.log(`\n${n}  ${what} in the source and not vendored — a deliberate exclusion, so still green`);
  const t = trees({ files: { ...BASE, [rel]: 'x' }, vendored: BASE });
  const { out, code } = run(t);
  if (code !== 0) fail(`exit ${code} — the exclusion is not holding, or something else went red:\n${out}`);
  else ok('exit 0');
  if (new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(out)) fail(`${rel} is named in the output, so it is being compared after all`);
  else ok('not named — the exclusion holds');
  rmSync(t.tmp, { recursive: true, force: true });
}

/* ---- 6: no source at all ------------------------------------------------ */
console.log('\n6  no source tree — could not look, which is neither pass nor finding');
{
  const t = trees({ files: {}, vendored: BASE });
  rmSync(t.src, { recursive: true, force: true });
  const { out, code } = run({ ...t, src: null });
  if (code !== 2) fail(`exit ${code}, expected 2. Exit 1 here would read exactly like a stale copy.`);
  else ok('exit 2');
  if (!/cannot answer the question on its own|no buses-data checkout/.test(out)) fail(`does not say what it could not find:\n${out}`);
  else ok('says what it could not find');
  rmSync(t.tmp, { recursive: true, force: true });
}

/* ---- 7: --allow-skip ---------------------------------------------------- */
console.log('\n7  no source tree, --allow-skip — green, and it says what it did not prove');
{
  const t = trees({ files: {}, vendored: BASE });
  rmSync(t.src, { recursive: true, force: true });
  const { out, code } = run({ ...t, src: null }, ['--allow-skip']);
  if (code !== 0) fail(`exit ${code}, expected 0`);
  else ok('exit 0');
  if (!/NOTHING WAS PROVED/.test(out)) fail(`a skip that does not say so out loud is a green tick for a check that did not run:\n${out}`);
  else ok('says NOTHING WAS PROVED');
  rmSync(t.tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n✗ prove-red-vendored-fixtures: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\n✓ prove-red-vendored-fixtures: four drift shapes go red, two exclusions stay green, and an absent source'
  + ' is exit 2 rather than a finding (8 scratch tree pairs, nothing outside the temp dir touched).');
