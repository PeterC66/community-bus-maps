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
// WHAT IT RENDERS THROUGH, and why it is not verify:place. A map's generators
// travel WITH the map, in `data/maps/<id>/data/`, with no sibling modules and
// SKILL_ASSETS pointing at `engine/`. This reproduces that layout exactly — json
// inputs plus the generator, nothing else — so it covers the path a newly
// IMPORTED map takes. `verify:place` renders from `engine/place/` directly, and
// on this laptop neither of them can tell you the difference, because the skill
// tree is right there to catch anything that falls through.
//
// Run from the repository root (no placeholders):
//     npm run test:selfsufficient
//     node --env-file-if-exists=.env scripts/test-engine-selfsufficient.mjs
// The `--env-file` part matters: BUSES_DIR / FIXTURE_DIR live in `.env`, and
// without them there is no fixture to render. `--allow-skip` is honoured the way
// the verify gates honour it, for a clone of the portal on its own.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const tmp = mkdtempSync(path.join(os.tmpdir(), 'selfsuff-'));
try {
  // Lay the scratch folder out the way a map's own data pack is: the json
  // inputs and the generator, and no sibling modules for it to find first.
  for (const n of readdirSync(FIXTURE)) {
    const p = path.join(FIXTURE, n);
    if (statSync(p).isFile() && n.endsWith('.json')) copyFileSync(p, path.join(tmp, n));
  }
  copyFileSync(path.join(ENGINE, 'place', 'gen_internal.js'), path.join(tmp, 'gen_internal.js'));

  // A loader shim that records every module path Node actually resolves.
  const log = path.join(tmp, '_resolved.txt');
  writeFileSync(path.join(tmp, '_run.js'), [
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
    `require(${JSON.stringify(path.join(tmp, 'gen_internal.js'))});`,
  ].join('\n'));

  const env = { ...process.env, SKILL_ASSETS: ENGINE };
  delete env.LEAFLET_DIR; delete env.OVERRIDES_FILE; delete env.EDITOR_KEYS;
  const res = spawnSync(process.execPath, [path.join(tmp, '_run.js')], { cwd: tmp, env, encoding: 'utf8' });

  console.log('');
  const firstError = (res.stderr || '').split('\n').find((l) => /Error|Cannot find module/.test(l)) || '';
  check('the generator runs to completion', res.status === 0, firstError.slice(0, 160));
  check('and writes a sheet', existsSync(path.join(tmp, 'internal.svg')));

  const resolved = existsSync(log)
    ? [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean))]
    : [];
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
  const inside = (p, dir) => norm(p).startsWith(`${norm(dir)}/`);
  const fromEngine = resolved.filter((p) => inside(p, ENGINE));
  const fromPack = resolved.filter((p) => inside(p, tmp));
  const outside = resolved.filter((p) => !inside(p, ENGINE) && !inside(p, tmp));

  // Without this one the check below passes vacuously on a shim that recorded
  // nothing at all, which is the failure mode of every observation-based test.
  check('it loaded modules out of engine/ at all', fromEngine.length > 0,
    'nothing resolved from engine/ — the shim is not recording');
  check('every module came from engine/ or the map data pack, and none from anywhere else',
    outside.length === 0, outside.join(', '));

  console.log(`\n  from engine/ (${fromEngine.length}): ` +
    fromEngine.map((p) => path.relative(ENGINE, p).replace(/\\/g, '/')).sort().join(', '));
  console.log(`  from the data pack (${fromPack.length}): ` +
    fromPack.map((p) => path.basename(p)).sort().join(', '));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n✗ ${failures} self-sufficiency check(s) failed — the engine reaches outside this repository, ` +
    'so it renders here and throws MODULE_NOT_FOUND wherever the skill tree is absent.');
  process.exitCode = 1;
} else {
  console.log('\n✓ the vendored engine is self-sufficient');
}
