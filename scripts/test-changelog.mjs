#!/usr/bin/env node
/*
 * test-changelog.mjs — the changelog is CHANGELOG.d/, and the four ways that
 * could quietly stop being true.
 *
 *     node scripts/test-changelog.mjs
 *
 * On 2026-09-03 CHANGELOG.md stopped being in git. It is generated from
 * CHANGELOG.head.md plus CHANGELOG.d/, and it was removed because every commit
 * regenerated it — 60 of the last 60 — so two concurrent sessions collided on
 * one line of index every time. Four things have to hold for that to keep
 * working, and each of them fails silently:
 *
 *   1. IT MUST STAY UNTRACKED. One `git add -A` from a session whose ignore
 *      rules are stale puts it straight back, and the very next pair of
 *      concurrent branches conflicts again. Nothing else would notice.
 *
 *   2. THE IMAGE MUST CARRY WHAT THE ADMIN PAGE READS. The Dockerfile used to
 *      `COPY ... CHANGELOG.md ./`, which after this change would have FAILED
 *      THE BUILD on any machine that had not run the generator — the build
 *      context is the working tree, not git, so it passed here and would have
 *      broken in CI. It must copy CHANGELOG.d/ instead, and not the generated
 *      file. This is the assertion that catches the near-miss.
 *
 *   3. THE ADMIN PAGE MUST GENERATE, NOT READ. Reading a gitignored file that
 *      is not in the image degrades to "(not found on this instance)" — a page
 *      that looks like it works and shows nothing.
 *
 *   4. THE VALIDATOR MUST STILL REFUSE A BAD FRAGMENT. `--check` changed from
 *      "is the committed index stale?" to "are the fragments well formed?", and
 *      a validator that accepts everything reports exactly what a correct one
 *      does on a good tree. So the bad cases are built here and required to
 *      throw — that is this file's own falsification, and without them the rest
 *      of it would pass with the parser deleted.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistinct, entriesFromDir, renderIndex } from '../src/changelog.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const throws = (name, fn, want) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!want || msg.includes(want)), msg === null ? 'it was accepted' : `threw: ${msg}`);
};

console.log('\nthe generated index is not in git, and stays that way');
{
  const r = spawnSync('git', ['ls-files', '--error-unmatch', 'CHANGELOG.md'], { cwd: ROOT, encoding: 'utf8' });
  check('git does not track CHANGELOG.md', r.status !== 0,
    'it is tracked again — one `git add -A` with stale ignore rules undoes the whole fix');
  const ignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('...and .gitignore is what keeps it out', /^CHANGELOG\.md$/m.test(ignore),
    'the ignore rule is gone, so the next `git add -A` re-adds it');
  const r2 = spawnSync('git', ['ls-files', '--error-unmatch', 'CHANGELOG.head.md'], { cwd: ROOT, encoding: 'utf8' });
  check('but the prose template IS tracked', r2.status === 0,
    'CHANGELOG.head.md is the only copy of the page prose — losing it loses the page');
}

console.log('\nthe deployed image carries the fragments, not the generated file');
{
  const df = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const copies = df.split(/\r?\n/).filter(l => /^COPY\b/.test(l));
  check('the Dockerfile copies CHANGELOG.d/', copies.some(l => /\bCHANGELOG\.d\b/.test(l)),
    'the admin /changelog page reads the fragments at runtime and would find none');
  check('...and does NOT copy the generated CHANGELOG.md',
    !copies.some(l => /\bCHANGELOG\.md\b/.test(l)),
    'a COPY of a gitignored file fails the build on any machine that has not generated it');
  check('...and copies the prose template it is built from',
    copies.some(l => /\bCHANGELOG\.head\.md\b/.test(l)), 'CHANGELOG.head.md is missing from the image');
}

console.log('\nthe admin page builds its list rather than reading a file');
{
  const src = readFileSync(path.join(ROOT, 'src', 'routes', 'pages.js'), 'utf8');
  check('/changelog imports the fragment reader', /entriesFromDir/.test(src) && /from '\.\.\/changelog\.js'/.test(src),
    'the route must generate, not read a file that is not in the image');
  // The MENTION is fine and is a useful comment; the READ is what must be gone.
  check('...and no longer reads CHANGELOG.md off disk', !/readFileSync\([^)]*CHANGELOG\.md/.test(src),
    'reading a gitignored file degrades to "(not found)" and looks like a working page');
}

console.log('\nand a malformed fragment is still refused');
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-changelog-'));
  const d = path.join(tmp, 'CHANGELOG.d');
  mkdirSync(d);
  const write = (n, body) => writeFileSync(path.join(d, n), body);
  const good = '---\ndate: 2026-09-03\ntitle: "A good one"\n---\n\nBody.\n';
  try {
    write('2026-09-03-good.md', good);
    write('README.md', '# not an entry\n');
    const ok = entriesFromDir(d);
    check('a well-formed fragment is read, and README.md is not an entry', ok.length === 1 && ok[0].title === 'A good one',
      JSON.stringify(ok));
    check('and it renders as one index line', renderIndex(ok).count === 1 &&
      renderIndex(ok).block.includes('- **2026-09-03** — [A good one](CHANGELOG.d/2026-09-03-good.md)'),
      renderIndex(ok).block);

    write('2026-09-03-nofm.md', 'No front matter here.\n');
    throws('a fragment with no front matter', () => entriesFromDir(d), 'no front matter');
    rmSync(path.join(d, '2026-09-03-nofm.md'));

    write('2026-09-03-notitle.md', '---\ndate: 2026-09-03\n---\n\nBody.\n');
    throws('a fragment with no title', () => entriesFromDir(d), "missing 'title:'");
    rmSync(path.join(d, '2026-09-03-notitle.md'));

    write('2026-09-03-wrongdate.md', '---\ndate: 2026-09-01\ntitle: "Mismatched"\n---\n\nBody.\n');
    throws('a filename that disagrees with its own date', () => entriesFromDir(d), 'does not start with its own date');
    rmSync(path.join(d, '2026-09-03-wrongdate.md'));

    // Asked of the FUNCTION, not of the filesystem. Writing the second name on
    // this laptop overwrites the first, readdir returns one file, and the arm
    // would pass for the wrong reason on the only machine that runs it.
    throws('two fragment names differing only in case',
      () => assertDistinct(['2026-09-03-good.md', '2026-09-03-Good.md']), 'differs only in case');
    check('...and distinct names are waved through',
      assertDistinct(['a.md', 'b.md']).length === 2, 'the guard refuses names it should accept');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (failures) {
  console.error(`\n✗ ${failures} changelog check(s) failed`);
  process.exit(1);
}
console.log('\n✓ the changelog is CHANGELOG.d/, the image carries it, and bad fragments are refused');
