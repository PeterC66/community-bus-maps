// test-portal-lib.mjs — the shared helpers introduced by OA-224 Tier 3.3 and 3.6.
//
//   node scripts/test-portal-lib.mjs        (or: npm run test:portal-lib)
//
// Three things are worth asserting here, and they are not "the helper works":
//
//   1. THE ONE BEHAVIOUR CHANGE. Thirteen scripts read `--name value` with
//      `i >= 0 && i + 1 < argv.length ? argv[i + 1] : def`, which takes the next
//      token whatever it is: `--note --quiet` set the note to `"--quiet"` AND
//      lost `--quiet`, silently, on scripts that write to the VPS. The shared
//      reader takes the stricter rule one of the thirteen already had. That is a
//      change to what every caller does, so it is pinned rather than assumed.
//
//   2. THAT src/db/paths.js OPENS NOTHING. It is the whole reason the module
//      exists: three scripts imported `src/db/index.js` for one constant and
//      migrated the live database as a side effect of wanting to know where
//      `data/maps` is. "It exports a path" is not the property; "importing it
//      cannot touch a database" is, and the way to test that is to import it in
//      a process pointed at a DATA_DIR that does not exist and check that
//      nothing was created.
//
//   3. THAT --add REALLY ADDS. `vendor-engine.mjs --add` writes a manifest row
//      with a placeholder hash and lets restampManifest() fill it in from the
//      bytes that landed — so the case that matters is not that a row appears,
//      it is that the row's sha256 is the hash of the file now on disk and not
//      the string 'PENDING'. Run over a throwaway tree, never the real engine.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, argAllowingDashes, has, all, confirm } from './lib/cli.mjs';
import { sha256, tokenHash } from '../src/hash.js';
import { hashOf } from './lib/vendored.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-portal-lib-'));

console.log('\nlib/cli.mjs — the argument reader');
{
  const av = ['node', 'x.mjs', '--map', 'st-ives', '--note', '--quiet', '--apply'];
  check('a flag takes the next token as its value', arg('map', undefined, av) === 'st-ives');
  check('a flag whose value is another flag falls back to the default',
    arg('note', 'DEFAULT', av) === 'DEFAULT', `got ${JSON.stringify(arg('note', 'DEFAULT', av))}`);
  check('...and the flag it would have swallowed is still visible', has('quiet', av));
  check('an absent flag is the default', arg('missing', 'D', av) === 'D');
  check('a trailing flag with nothing after it is the default', arg('apply', 'D', av) === 'D');
  check('has() is presence, not value', has('apply', av) && !has('nope', av));
  // The escape hatch exists precisely because the rule above is a change.
  check('argAllowingDashes still reads a value that looks like a flag',
    argAllowingDashes('note', 'D', av) === '--quiet');
  check('all() collects a repeated flag',
    JSON.stringify(all('t', ['--t', 'a', '--t', 'b', '--t', '--x'])) === '["a","b"]');
}

console.log('\nlib/cli.mjs — the "really do it" vocabulary');
{
  check('local: reports by default', confirm('local', ['node', 'x']).dryRun === true);
  check('local: --apply writes', confirm('local', ['node', 'x', '--apply']).apply === true);
  check('remote: DOES it by default, because the default is the danger',
    confirm('remote', ['node', 'x']).apply === true);
  check('remote: --dry-run is the opt-out', confirm('remote', ['node', 'x', '--dry-run']).dryRun === true);
  check('remote: --yes is reported separately from apply',
    confirm('remote', ['node', 'x', '--yes']).confirmed === true);
  let threw = false;
  try { confirm('sometimes'); } catch { threw = true; }
  check('an unknown kind is refused rather than guessed at', threw);
}

console.log('\nsrc/hash.js — one sha256, one token hash');
{
  // The published SHA-256 of "abc". Written out rather than computed, so this
  // case is evidence about the algorithm and not just about determinism.
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  check('sha256 is SHA-256', sha256('abc') === ABC, sha256('abc'));
  check('tokenHash is sha256 of the token as a string', tokenHash('abc') === ABC);
  // Caught rather than called bare: node's createHash().update(123) THROWS, and
  // a suite that dies here reports nothing at all — the falsification harness
  // saw exactly that, going red on a stack trace instead of on this line.
  let numeric = null;
  try { numeric = tokenHash(123); } catch { /* the failure IS the answer */ }
  check('tokenHash stringifies, so a numeric token cannot throw', numeric === sha256('123'), String(numeric));
}

console.log('\nsrc/db/paths.js — importing it cannot open a database');
{
  const dataDir = path.join(scratch, 'never-created');
  const r = spawnSync(process.execPath, ['-e',
    `import(${JSON.stringify(new URL('../src/db/paths.js', import.meta.url).href)})`
    + '.then(m => console.log(m.DATA_DIR))'],
    { encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir } });
  check('it resolves DATA_DIR from the environment', r.stdout.trim() === path.resolve(dataDir), r.stdout.trim());
  check('and creates nothing — no directory, no portal.sqlite', !existsSync(dataDir),
    existsSync(dataDir) ? readdirSync(dataDir).join(', ') : '');
  // The control: the module that DOES open a database still does, or this case
  // would pass for a version of paths.js that simply did not work.
  const dataDir2 = path.join(scratch, 'created-by-db');
  spawnSync(process.execPath, ['-e',
    `import(${JSON.stringify(new URL('../src/db/index.js', import.meta.url).href)}).then(() => {})`],
    { encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir2, DB_PATH: path.join(dataDir2, 'portal.sqlite') } });
  check('CONTROL: importing src/db/index.js does create the store', existsSync(dataDir2));
}

console.log('\nvendor-engine.mjs --add — the row, and its hash');
{
  // A throwaway portal + skill tree. The script resolves ROOT from its own
  // location, so it is copied into the scratch tree rather than pointed at it.
  const base = path.join(scratch, 'addtree');
  const engineDir = path.join(base, 'engine');
  const skillRoot = path.join(base, 'skills');
  const srcDir = path.join(skillRoot, 'make-bus-leaflet', 'assets');
  mkdirSync(engineDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(path.join(base, 'scripts', 'lib'), { recursive: true });
  for (const f of ['vendor-engine.mjs', 'lib/vendored.mjs', 'lib/cli.mjs']) {
    writeFileSync(path.join(base, 'scripts', f), readFileSync(path.join(ROOT, 'scripts', f)));
  }
  const body = '// icons\nmodule.exports = { icon: () => "x" };\n';
  const newBody = '// dash_fit\nmodule.exports = { fit: () => 1 };\n';
  writeFileSync(path.join(engineDir, 'icons.js'), body);
  writeFileSync(path.join(srcDir, 'icons.js'), body);
  writeFileSync(path.join(srcDir, 'dash_fit.js'), newBody);
  const manifestPath = path.join(engineDir, 'vendored.json');
  const manifest = {
    files: [{ path: 'icons.js', kind: 'vendored', source: 'make-bus-leaflet/assets/icons.js', sha256: hashOf(path.join(engineDir, 'icons.js')), vendoredOn: '2026-08-25' }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const run = (...args) => spawnSync(process.execPath,
    [path.join(base, 'scripts', 'vendor-engine.mjs'), '--skills', skillRoot, ...args],
    { encoding: 'utf8', env: { ...process.env, SKILL_ROOT: '' } });

  const missingSource = run('--add', 'dash_fit.js');
  check('--add with no --source is a usage error, exit 2', missingSource.status === 2, String(missingSource.status));

  const wrongSource = run('--add', 'dash_fit.js', '--source', 'make-bus-leaflet/assets/nope.js');
  check('--source naming a file the skill tree lacks exits 3 (bad input)', wrongSource.status === 3, String(wrongSource.status));
  check('...and nothing was written to the manifest',
    !readFileSync(manifestPath, 'utf8').includes('dash_fit'));

  const dry = run('--add', 'dash_fit.js', '--source', 'make-bus-leaflet/assets/dash_fit.js', '--dry-run');
  check('--dry-run says what it would do and writes nothing',
    dry.status === 0 && !readFileSync(manifestPath, 'utf8').includes('dash_fit'), dry.stdout);

  const ok = run('--add', 'dash_fit.js', '--source', 'make-bus-leaflet/assets/dash_fit.js');
  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const row = (after.files || []).find((f) => f.path === 'dash_fit.js');
  check('--add copies the file into engine/', existsSync(path.join(engineDir, 'dash_fit.js')), ok.stdout + ok.stderr);
  check('--add writes a manifest row', !!row);
  check('THE ONE THAT MATTERS: the row carries the hash of the bytes that landed, not "PENDING"',
    !!row && row.sha256 === hashOf(path.join(engineDir, 'dash_fit.js')), row && row.sha256);

  const again = run('--add', 'dash_fit.js', '--source', 'make-bus-leaflet/assets/dash_fit.js');
  check('adding a file that already has a row is refused rather than duplicated',
    again.status === 2 && (after.files || []).filter((f) => f.path === 'dash_fit.js').length === 1);
}

console.log('\nengine/vendored.json — no laptop path in a tracked file');
{
  const m = JSON.parse(readFileSync(path.join(ROOT, 'engine', 'vendored.json'), 'utf8'));
  check('skillRootDefault is gone from the manifest', m.skillRootDefault === undefined, m.skillRootDefault);
  const ex = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  check('...and SKILL_ROOT is documented in .env.example instead', /^SKILL_ROOT=/m.test(ex));
  // A default that is read from .env by a script CI runs without .env has to
  // survive both; the npm script is what loads it, so the npm script is checked.
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const s of ['check:vendored', 'vendor:engine']) {
    check(`npm run ${s} loads .env, or SKILL_ROOT would never be seen`,
      pkg.scripts[s].includes('--env-file-if-exists=.env'), pkg.scripts[s]);
  }
}

rmSync(scratch, { recursive: true, force: true });
console.log(failures ? `\n✗ ${failures} check(s) failed.` : '\n✓ all checks passed.');
process.exit(failures ? 1 : 0);
