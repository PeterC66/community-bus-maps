// test-apply-chrome.mjs — apply-chrome.mjs writes nothing unless it is given
// --apply, and does write when it is (buses-data OA-228, 2026-09-27).
//
//   node scripts/test-apply-chrome.mjs   (or: npm run test:apply-chrome)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments and there are no placeholders. It never touches public/: every run
// points the child at a throwaway copy with `--dir`.
//
// apply-chrome.mjs rewrites the nav and footer of every page from
// scripts/lib/site-chrome.mjs. It is a LOCAL mutator, so docs/CONVENTIONS.md
// gives it confirm('local'): report by default, write only on --apply.
//
// THE PROPERTY IS "NOTHING WRITTEN", NOT "EXIT 0". The --apply run is the
// control: a script that never wrote at all would pass every report case
// perfectly, so the control must be seen to repair the page the reports leave.
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPTS, 'apply-chrome.mjs');
const ROOT = path.join(SCRIPTS, '..');
const PUBLIC = path.join(ROOT, 'public');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-apply-chrome-'));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const run = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--dir', scratch, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// Two real pages: one left canonical, one whose nav block has drifted.
const GOOD = 'index.html';
const STALE = 'maps.html';
const read = (name) => readFileSync(path.join(scratch, name), 'utf8');
const seed = () => {
  copyFileSync(path.join(PUBLIC, GOOD), path.join(scratch, GOOD));
  const real = readFileSync(path.join(PUBLIC, STALE), 'utf8');
  const drifted = real.replace(/(  <!-- nav:start -->\n)[\s\S]*?(\n  <!-- nav:end -->)/, '$1  <nav>stale</nav>$2');
  if (drifted === real) throw new Error(`${STALE} has no nav markers to drift — pick another page`);
  writeFileSync(path.join(scratch, STALE), drifted);
  return { good: read(GOOD), stale: read(STALE), canonical: real };
};

try {
  const publicBefore = readFileSync(path.join(PUBLIC, STALE), 'utf8');

  console.log('the control: --apply repairs the drifted page');
  let s = seed();
  const ctl = run(['--apply']);
  check('exits 0', ctl.status === 0, `exit ${ctl.status}: ${ctl.out.slice(0, 300)}`);
  check('rewrites the drifted page to the canonical chrome', read(STALE) === s.canonical);
  check('leaves the canonical page byte-identical', read(GOOD) === s.good);
  check('says it updated one file', /1 file\(s\) updated/.test(ctl.out), ctl.out.slice(-200));

  for (const args of [[], ['--dry-run'], ['--yes']]) {
    console.log(`\n${args.length ? args.join(' ') : '(no flag)'}`);
    s = seed();
    const r = run(args);
    check('exits 0', r.status === 0, `exit ${r.status}: ${r.out.slice(0, 300)}`);
    check('writes nothing to the drifted page', read(STALE) === s.stale);
    check('writes nothing to the canonical page', read(GOOD) === s.good);
    check('names the page it would update', r.out.includes(`${STALE}: chrome would be updated`), r.out.slice(0, 300));
    check('says it is a dry run and how to write', /Dry run: 1 file\(s\) would be updated[\s\S]*--apply/.test(r.out), r.out.slice(-200));
  }

  console.log('\nthe repository');
  check('public/ itself is untouched', readFileSync(path.join(PUBLIC, STALE), 'utf8') === publicBefore);

  console.log('\nnpm run chrome:apply is the command that writes');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('its npm script passes --apply', /apply-chrome\.mjs --apply\b/.test(pkg.scripts['chrome:apply'] || ''), pkg.scripts['chrome:apply']);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
