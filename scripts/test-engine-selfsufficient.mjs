// test-engine-selfsufficient.mjs — render a real map through the PORTAL's engine
// and prove that not one module resolves outside this repository.
//
// WHY THIS EXISTS, and why it is not the same check as check-vendored.mjs.
// `requireScan()` in scripts/lib/vendored.mjs answers a similar question by
// PATTERN-MATCHING the engine's source for the idiom a resolver is written in.
// That is a heuristic, and on 2026-08-27 it was shown to be one: it had never
// seen `gen_boarding.js`, which factors its resolver into a `_dep(name)` helper
// so no module name sits beside SKILL_ASSETS, nor `gen_external_places.js`,
// which writes a third form. When `gen_internal.js` was tidied into the same
// helper it went blind to that too, and reported "every module they require is
// here" about a generator requiring four modules this repository did not have.
//
// The patterns are fixed and still worth having — they name the missing file
// before anything is run, which is a better error than a stack trace. But a
// pattern over source text can only cover the forms somebody thought of. This
// file asks the question the other way round: it LOADS the thing and records
// what Node actually resolved. A new idiom, a lazy require inside another
// module, a path built by arithmetic — all of it shows up here without anyone
// extending a regex.
//
// WHAT WOULD GO WRONG WITHOUT IT. Every generator's last-resort branch is a
// hardcoded path into the skill checkout, `C:/u3a St Ives/.claude/skills/…`.
// That folder exists on the laptop where this is developed and does not exist on
// the server where it runs, so a missing module resolves happily here and throws
// MODULE_NOT_FOUND in production. A require that resolves is not a require that
// is portable.
//
// ---------------------------------------------------------------------------
// IT USED TO CERTIFY FOUR SHEETS AND RENDER ONE. WIDENED 2026-08-30 (OA-051).
//
// Until today this file copied `engine/place/gen_internal.js` into a scratch pack
// and rendered it, then printed `✓ the vendored engine is self-sufficient`. That
// verdict was true of the INTERNAL sheet. Nothing in it said anything about the
// external, the schematic or the diagram — and the external is the one that
// moved: `gen_external_radial.js` started requiring `dash_fit.js` at load on
// 2026-08-30. A delivered pack carries no sibling modules, so that require has to
// resolve through SKILL_ASSETS into `engine/`. Had it not, every area map
// delivered after that date would have failed to render its external sheet at
// preview time, and the gate whose whole job is this question would still have
// printed its tick. It is the same shape as `rollout.js`'s up-to-date test
// reading two sheets of four while the tool built four (OA-147), one level in.
//
// It now runs EVERY generator the fixture's `routes.json` declares, the way
// `verify-reproduce.mjs` already picks its targets, and asserts per sheet: it
// ran, it wrote, and every module it pulled came from `engine/` or the pack.
//
// AND IT MATCHES renderMap.js's INVOCATION, WHICH IS NOT ONE INVOCATION.
// `generateSvg()` runs a map's own generator out of the data pack, and runs the
// portal-owned P7 expert styles from an ABSOLUTE path in `engine/expert/` — and
// those two are not interchangeable. `gen_internal_schematic.js` finds its
// pre-stage with `__dirname`, so copying it into the pack breaks it; the
// pre-stage then spawns the map's OWN `gen_internal.js` out of the pack, so a
// json-only pack breaks it the other way. Both modes are reproduced here rather
// than picked. A gate that renders its subject differently from the way
// production does is a gate on a procedure nobody runs.
//
// THE RECORDER IS A `--require` PRELOAD, FOR THE SAME REASON. Hooking
// `Module._load` inside this process would have seen nothing at all of the
// schematic or the diagram: both spawn child processes, and their real module
// loading happens two processes down. NODE_OPTIONS carries the recorder into
// every child, and the per-sheet "it loaded modules out of engine/ at all" check
// is what says it arrived.
//
// WHAT IT RENDERS THROUGH, and why it is not verify:place. A map's generators
// travel WITH the map, in `data/maps/<id>/data/`, with no sibling modules and
// SKILL_ASSETS pointing at `engine/`. This reproduces that layout exactly — json
// inputs plus the generators, nothing else — so it covers the path a newly
// IMPORTED map takes. `verify:place` renders from `engine/place/` directly, and
// on this laptop neither of them can tell you the difference, because the skill
// tree is right there to catch anything that falls through.
//
// FALSIFY IT AFTER CHANGING IT: `npm run test:prove-red-selfsufficient` hides
// `engine/dash_fit.js` and requires the EXTERNAL arm to go red while the internal
// arm stays green. A widened gate that has only ever been seen green is the very
// thing this file exists to record.
//
// Run from the repository root (no placeholders):
//     npm run test:selfsufficient
//     node --env-file-if-exists=.env scripts/test-engine-selfsufficient.mjs
// The `--env-file` part matters: BUSES_DIR / FIXTURE_DIR live in `.env`, and
// without them there is no fixture to render. `--allow-skip` is honoured the way
// the verify gates honour it, for a clone of the portal on its own.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveFixtures, reportNoFixture } from './lib/fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENGINE = path.join(ROOT, 'engine');

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !extra ? '' : `   ${extra}`}`);
  if (!cond) failures++;
};

const { fixtures, source } = resolveFixtures('area');
if (!fixtures.length) {
  reportNoFixture('area');
  process.exit(0); // only reached under --allow-skip
}
const FIXTURE = fixtures[0];
console.log(`the vendored engine, rendered with nothing but this repository`);
console.log(`· fixture: ${FIXTURE}  (${source})`);
console.log(`· engine : ${ENGINE}`);

const routesJson = (() => {
  try { return JSON.parse(readFileSync(path.join(FIXTURE, 'routes.json'), 'utf8')); } catch { return {}; }
})();

/* WHICH EXTERNAL GENERATOR. There is no config key that says radial or busway —
 * the skill's own `detectExternalStyle()` decides by gating both against the
 * shipped sheet. Byte-matching the pack's own `gen_external.js` against the two
 * vendored candidates answers the same question for a fraction of the work, and
 * when it cannot (a fixture a re-vendor behind), that is reported and radial is
 * used, because every town on the board is radial and busway is drawn by nobody.
 * Reported and not failed: which engine build the fixture was frozen at is
 * `verify-reproduce.mjs`'s question, not this file's. */
function pickExternal() {
  const packGen = path.join(FIXTURE, 'gen_external.js');
  const cands = ['gen_external_radial.js', 'gen_external_busway.js']
    .map((n) => path.join(ENGINE, 'area', n))
    .filter((p) => existsSync(p));
  if (existsSync(packGen)) {
    const want = readFileSync(packGen);
    for (const c of cands) if (readFileSync(c).equals(want)) return { gen: c, note: null };
  }
  return {
    gen: path.join(ENGINE, 'area', 'gen_external_radial.js'),
    note: "the fixture's own gen_external.js matches neither vendored candidate byte-for-byte — using radial",
  };
}
const ext = pickExternal();
if (ext.note) console.log(`· note   : ${ext.note}`);

/* The targets, on verify-reproduce.mjs's terms: the two every area map ships,
 * plus each P7 expert style this fixture's routes.json opts into.
 *   mode 'pack'    — the generator travels with the map; copied in under the
 *                    name renderMap.js expects, and run from the pack.
 *   mode 'inplace' — portal-owned, run from engine/expert/ by absolute path,
 *                    exactly as generateSvg() passes it. */
const EXPERT = path.join(ENGINE, 'expert');
const targets = [
  { sheet: 'internal.svg', mode: 'pack', as: 'gen_internal.js', gen: path.join(ENGINE, 'place', 'gen_internal.js') },
  { sheet: 'external.svg', mode: 'pack', as: 'gen_external.js', gen: ext.gen },
];
if (routesJson.internalSchematic) targets.push({ sheet: 'internal-schematic.svg', mode: 'inplace', gen: path.join(EXPERT, 'gen_internal_schematic.js') });
if (routesJson.internalDiagram) targets.push({ sheet: 'internal-diagram.svg', mode: 'inplace', gen: path.join(EXPERT, 'gen_internal_diagram.js') });

console.log(`· sheets : ${targets.length} — ${targets.map((t) => t.sheet).join(', ')}`);
console.log('');

/* THE POPULATION IS ASSERTED, NOT ONLY THE VERDICTS. Coverage was this gate's
 * actual bug, and a run of ticks cannot express it: one sheet of four printed
 * exactly the same "✓ the vendored engine is self-sufficient" that four of four
 * would have. So the count is a check in its own right. */
const declared = 2 + (routesJson.internalSchematic ? 1 : 0) + (routesJson.internalDiagram ? 1 : 0);
check(`it certifies every sheet the fixture declares (${declared})`, targets.length === declared);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'selfsuff-'));
try {
  // Lay the scratch folder out the way a map's own data pack is: the json inputs
  // and the two generators that travel with a map, and no sibling modules for
  // them to find first.
  for (const n of readdirSync(FIXTURE)) {
    const p = path.join(FIXTURE, n);
    if (statSync(p).isFile() && n.endsWith('.json')) copyFileSync(p, path.join(tmp, n));
  }
  for (const t of targets) if (t.mode === 'pack') copyFileSync(t.gen, path.join(tmp, t.as));

  // The recorder, preloaded into the generator AND into every process it spawns.
  const shim = path.join(tmp, '_record.cjs');
  const log = path.join(tmp, '_resolved.txt');
  writeFileSync(shim, [
    "const Module = require('node:module');",
    "const fs = require('node:fs');",
    'const orig = Module._load;',
    'Module._load = function (request, parent, isMain) {',
    '  try {',
    '    const r = Module._resolveFilename(request, parent, isMain);',
    `    if (/[\\\\/]/.test(r)) fs.appendFileSync(${JSON.stringify(log)}, r + '\\n');`,
    '  } catch (e) {}',
    '  return orig.apply(this, arguments);',
    '};',
  ].join('\n'));

  const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
  const inside = (p, dir) => norm(p).startsWith(`${norm(dir)}/`);

  for (const t of targets) {
    if (existsSync(log)) unlinkSync(log);
    const genPath = t.mode === 'pack' ? path.join(tmp, t.as) : t.gen;
    // generateSvg()'s env, minus the two it only sets when asked. STRICT_GUARDS
    // is set because renderMap.js always sets it on the bytes that go public,
    // and a guard that refuses to draw exits non-zero under it — so "runs to
    // completion" here means what the portal means by it.
    // FORWARD SLASHES IN NODE_OPTIONS, DELIBERATELY. Node parses that variable
    // with shell-like quoting, so a Windows path inside the quotes has its
    // backslashes eaten: `--require "C:\Users\…\_record.cjs"` arrives as
    // `C:UsersPeter…` and every generator dies in the module loader before it
    // runs a line. Measured, not guessed — the first run of this widened gate
    // failed all twelve of its checks that way, and it failed them wearing the
    // face of a real finding ("the recorder did not reach this generator").
    const env = { ...process.env, LEAFLET_DIR: tmp, SKILL_ASSETS: ENGINE, STRICT_GUARDS: '1', NODE_OPTIONS: `--require "${shim.split(path.sep).join('/')}"` };
    delete env.OVERRIDES_FILE;
    delete env.EDITOR_KEYS;
    const res = spawnSync(process.execPath, [genPath], { cwd: tmp, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

    console.log(`— ${t.sheet}  (${t.mode === 'pack' ? `${t.as}, from the pack` : path.relative(ROOT, t.gen).replace(/\\/g, '/')})`);
    const firstError = (res.stderr || '').split('\n').find((l) => /Error|Cannot find module/.test(l)) || '';
    check('the generator runs to completion', res.status === 0, firstError.slice(0, 200));
    check('and writes its sheet', existsSync(path.join(tmp, t.sheet)));

    const resolved = existsSync(log)
      ? [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean))]
      : [];
    const fromEngine = resolved.filter((p) => inside(p, ENGINE));
    const fromPack = resolved.filter((p) => inside(p, tmp));
    const outside = resolved.filter((p) => !inside(p, ENGINE) && !inside(p, tmp));

    // Without this one the check below passes vacuously on a recorder that
    // recorded nothing at all, which is the failure mode of every
    // observation-based test — and it is now per sheet, because the recorder
    // reaching one generator says nothing about it reaching a grandchild
    // process two spawns down.
    check('it loaded modules out of engine/ at all', fromEngine.length > 0,
      'nothing resolved from engine/ — the recorder did not reach this generator');
    check('every module came from engine/ or the map data pack, and none from anywhere else',
      outside.length === 0, outside.join(', '));

    console.log(`    from engine/ (${fromEngine.length}): ` +
      fromEngine.map((p) => path.relative(ENGINE, p).replace(/\\/g, '/')).sort().join(', '));
    console.log(`    from the data pack (${fromPack.length}): ` +
      fromPack.map((p) => path.basename(p)).sort().join(', '));
    console.log('');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`✗ ${failures} self-sufficiency check(s) failed — the engine reaches outside this repository, ` +
    'so it renders here and throws MODULE_NOT_FOUND wherever the skill tree is absent.');
  process.exitCode = 1;
} else {
  console.log(`✓ the vendored engine is self-sufficient, on all ${targets.length} sheets this fixture declares`);
}
