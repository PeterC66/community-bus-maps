// prove-red-portal-lib.mjs — falsify test-portal-lib.mjs (OA-224 Tier 3.3 / 3.6).
//
// Run from the repository root (`C:\Claude\community-bus-maps`, no placeholders):
//     npm run test:prove-red-portal-lib
//
// WHY. `test-portal-lib.mjs` is a suite of small assertions about three helpers
// that fourteen scripts now depend on. Small assertions about a helper are
// exactly the kind that pass because the helper exists rather than because it is
// right, and this repository has been caught by that shape before. So each
// mutation below breaks ONE property in a scratch copy of the code and requires
// the suite to object — and, because "it went red" and "it went red for this
// reason" are different claims, each case also asserts WHICH line reported it.
//
// Nothing under scripts/ or src/ is touched. The whole repository is copied to a
// temp directory (node_modules excluded — the suite imports nothing from it),
// one file is edited there, and the copy's suite is run.
//
//   0  control: the tree unmutated              -> exit 0, no ✗
//   1  arg() takes the next token whatever it is -> the value-is-a-flag case
//   2  arg() ignores the caller's argv           -> the reader stops being testable
//   3  confirm('local') writes by default        -> the safety inverts
//   4  tokenHash stops stringifying              -> a numeric token throws
//   5  sha256 becomes sha1                       -> the published-vector case
//   6  paths.js creates DATA_DIR at import       -> the side effect comes back
//   7  --add writes a literal hash               -> the row describes nothing
//
// Case 6 is the one this file is really for. `src/db/paths.js` exists so that a
// script wanting a path does not open and migrate a database; adding one
// `mkdirSync` to it would restore the fault, break no other test in the
// repository, and leave the module looking correct.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-portal-lib-'));
const TREE = path.join(scratch, 'repo');
cpSync(ROOT, TREE, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !rel.startsWith('node_modules') && !rel.startsWith('.git') && !rel.startsWith('data')
      && !rel.startsWith('backups');
  },
});

/** Apply one anchored edit in the scratch tree, run the suite there, restore. */
function mutate({ label, file, find, to, expect }) {
  const p = path.join(TREE, file);
  const before = readFileSync(p, 'utf8');
  const n = before.split(find).length - 1;
  if (n !== 1) { fail(`${label}: anchor matched ${n} times in ${file}, not once — the mutation did not do what it says`); return; }
  writeFileSync(p, before.replace(find, to));
  const r = spawnSync(process.execPath, [path.join(TREE, 'scripts', 'test-portal-lib.mjs')], { encoding: 'utf8' });
  writeFileSync(p, before);
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) { fail(`${label}: SURVIVED — the suite passed against broken code`); return; }
  if (!out.includes(expect)) {
    fail(`${label}: went red, but not on the assertion that names it (wanted "${expect}")`);
    return;
  }
  ok(`${label} -> "${expect}"`);
}

console.log('control');
{
  const r = spawnSync(process.execPath, [path.join(TREE, 'scripts', 'test-portal-lib.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) fail(`the unmutated copy is already red — every case below would be meaningless\n${r.stdout}${r.stderr}`);
  else ok('the unmutated scratch copy passes');
}

console.log('\nmutations');
mutate({
  label: 'arg() takes the next token whatever it is (the pre-3.3 majority body)',
  file: 'scripts/lib/cli.mjs',
  find: "  return v !== undefined && !v.startsWith('--') ? v : def;",
  to: '  return v !== undefined ? v : def;',
  expect: 'a flag whose value is another flag falls back to the default',
});

mutate({
  label: 'arg() ignores the argv it was handed and reads the process',
  file: 'scripts/lib/cli.mjs',
  find: 'export function arg(name, def = undefined, argv = process.argv) {\n  const i = argv.indexOf(`--${name}`);',
  to: 'export function arg(name, def = undefined, argv = process.argv) {\n  argv = process.argv;\n  const i = argv.indexOf(`--${name}`);',
  expect: 'a flag takes the next token as its value',
});

mutate({
  label: "confirm('local') writes unless told not to — the safety inverted",
  file: 'scripts/lib/cli.mjs',
  find: "    const apply = has('apply', argv);\n    return { apply, dryRun: !apply };",
  to: "    const apply = !has('dry-run', argv);\n    return { apply, dryRun: !apply };",
  expect: 'local: reports by default',
});

mutate({
  label: 'tokenHash stops stringifying, so a numeric token throws',
  file: 'src/hash.js',
  find: '  return sha256(String(token));',
  to: '  return sha256(token);',
  expect: 'tokenHash stringifies, so a numeric token cannot throw',
});

mutate({
  label: 'sha256 is quietly sha1',
  file: 'src/hash.js',
  find: "  return createHash('sha256').update(input).digest('hex');",
  to: "  return createHash('sha1').update(input).digest('hex');",
  expect: 'sha256 is SHA-256',
});

/*
 * The paths.js case needs TWO edits — the import and the call — so it does not
 * go through mutate(), which is deliberately one anchor. Written out rather than
 * generalised, because an inert half of a mutation (an unused import) SURVIVES
 * and would read as a hole in the suite rather than as a mutation that did
 * nothing.
 */
console.log('\nthe two-edit case: the side effect paths.js exists to remove');
{
  const p = path.join(TREE, 'src', 'db', 'paths.js');
  const before = readFileSync(p, 'utf8');
  const mutated = before
    .replace("import path from 'node:path';", "import path from 'node:path';\nimport { mkdirSync } from 'node:fs';")
    .replace("export const MAPS_DIR = path.join(DATA_DIR, 'maps');",
      "export const MAPS_DIR = path.join(DATA_DIR, 'maps');\nmkdirSync(DATA_DIR, { recursive: true });");
  if (mutated === before) fail('paths.js: neither anchor matched — the mutation did not do what it says');
  else {
    writeFileSync(p, mutated);
    const r = spawnSync(process.execPath, [path.join(TREE, 'scripts', 'test-portal-lib.mjs')], { encoding: 'utf8' });
    writeFileSync(p, before);
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0) fail('paths.js mkdirSync at import: SURVIVED');
    else if (!out.includes('✗ and creates nothing')) fail('paths.js mkdirSync at import: red on the wrong line');
    else ok('paths.js creating DATA_DIR at import -> "and creates nothing — no directory, no portal.sqlite"');
  }
}

/*
 * AN EQUIVALENT MUTANT, AND WHY IT IS NOT HERE. The first version of this case
 * replaced --add's `sha256: 'PENDING'` placeholder with a literal 64 zeros and
 * expected the suite to object. It SURVIVED, and the survivor was right:
 * `restampManifest()` rewrites every row's hash from the bytes on disk, so the
 * placeholder is not load-bearing and ANY string would do. The property is not
 * "the placeholder is the right placeholder" — it is "the restamp runs after an
 * --add", which is what this mutation actually removes.
 */
mutate({
  label: '--add adds the row and skips the restamp, so the hash stays a placeholder',
  file: 'scripts/vendor-engine.mjs',
  find: 'if (moved.length) {\n  const today',
  to: 'if (false) {\n  const today',
  expect: 'the row carries the hash of the bytes that landed',
});

rmSync(scratch, { recursive: true, force: true });
console.log(failures
  ? `\n✗ ${failures} case(s) did not behave as claimed.`
  : '\n✓ every mutation was caught, by the assertion that names it, and the control stayed green.');
process.exit(failures ? 1 : 0);
