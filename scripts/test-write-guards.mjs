// test-write-guards.mjs — every script buses-data OA-228 gave a look-first
// guard still has it, read from the SOURCE (2026-09-27).
//
//   node scripts/test-write-guards.mjs   (or: npm run test:write-guards)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments and there are no placeholders. It runs no script; it reads them.
//
// OA-228 gave nine writers the guard docs/CONVENTIONS.md prescribes, one pull
// request each, and each has its own test-<script>.mjs that proves the guard by
// running the script. Those tests prove behaviour; this one proves the SHAPE
// survives an edit — that each script still takes its guard from
// scripts/lib/cli.mjs's confirm(), with the right kind, rather than growing a
// private flag reader again. A script that was renamed or deleted fails here
// too, so the list below cannot rot silently.
//
// THE CHECK IS PROVED ABLE TO FAIL before it is trusted: the same function is
// run over three sources that break the rule, and each must be refused.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

// remote: reaches the VPS or the live store, so it does it by default and
// --dry-run is the look. local: writes the repository, so it reports by
// default and --apply is the write.
const GUARDED = {
  'create-admin.mjs': 'remote',
  'build-place-index.mjs': 'remote',
  'check-upcoming-refreshes.mjs': 'remote',
  'seed-demo.mjs': 'remote',
  'publish-baseline.mjs': 'remote',
  'import-map.mjs': 'remote',
  'propose-update.mjs': 'remote',
  'deploy-caddy.mjs': 'remote',
  'apply-chrome.mjs': 'local',
};

/** Why this source breaks the rule for `kind`, or null when it keeps it. */
export function guardFault(src, kind) {
  const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/lib\/cli\.mjs['"]/);
  if (!imp) return 'does not import from ./lib/cli.mjs';
  if (!/\bconfirm\b/.test(imp[1])) return 'imports cli.mjs but not confirm';
  const calls = [...src.matchAll(/\bconfirm\(\s*['"](\w+)['"]\s*\)/g)].map((m) => m[1]);
  if (!calls.length) return 'never calls confirm()';
  if (!calls.includes(kind)) return `calls confirm('${calls[0]}'), expected confirm('${kind}')`;
  return null;
}

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('the check can fail');
const good = "import { arg, confirm } from './lib/cli.mjs';\nconst { dryRun } = confirm('remote');\n";
check('a script that keeps the rule passes', guardFault(good, 'remote') === null, guardFault(good, 'remote'));
check('a private flag reader is refused', guardFault("const dryRun = process.argv.includes('--dry-run');\n", 'remote') !== null);
check('an import that never calls confirm is refused', guardFault("import { confirm } from './lib/cli.mjs';\n", 'remote') !== null);
check('the wrong kind is refused', guardFault(good, 'local') !== null);

console.log('\nthe guarded scripts');
for (const [name, kind] of Object.entries(GUARDED)) {
  const file = path.join(SCRIPTS, name);
  if (!existsSync(file)) { check(`${name} exists`, false, 'renamed or deleted: update GUARDED and say why'); continue; }
  const fault = guardFault(readFileSync(file, 'utf8'), kind);
  check(`${name} takes confirm('${kind}') from cli.mjs`, fault === null, fault);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
