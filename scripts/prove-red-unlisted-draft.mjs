// prove-red-unlisted-draft.mjs — falsify the OA-295 half of test-worklist.mjs.
//
// Run from the repository root (`C:\Claude\community-bus-maps`, no placeholders):
//     npm run test:prove-red-unlisted-draft
//
// WHY. OA-295 is a check that reported on a predicate it never evaluated: the
// unsent-draft row read `published_version_id` and spoke for all four clauses
// of PUBLIC_WHERE, so it told Peter "the public still has v7.0" about Ramsey
// while /m/ramsey was a 404. The four cases added to `test-worklist.mjs` are
// assertions about the WORDING of a sentence, and a wording assertion is the
// easiest kind to satisfy by accident — a row that shouted "NOT LISTED" at
// every draft would pass three of them. So each mutation below restores one
// way of getting it wrong in a scratch copy and requires the suite to object
// on the named assertion, and case 4 is the one that proves the row still
// discriminates rather than merely shouts.
//
//   0  control: the tree unmutated                -> exit 0, no x
//   1  the bug verbatim: published read as public  -> the un-listed case
//   2  public_listed consulted, customer ignored   -> the suspended case
//   3  the rank left in housekeeping               -> the band case
//   4  the visibility columns dropped from the SQL -> the LISTED case
//
// Nothing under scripts/ or src/ is touched. The whole repository is copied to
// a temp directory (node_modules, .git and .claude excluded) and one file is
// edited there.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-unlisted-draft-'));
const TREE = path.join(scratch, 'repo');
cpSync(ROOT, TREE, {
  recursive: true,
  // By SEGMENT rather than by prefix, for the reason prove-red-portal-lib.mjs
  // records: a nested node_modules under a sibling worktree threw EPERM and
  // made this shape of harness pass or fail by what another session had open.
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    if (!rel) return true;
    const segs = rel.split(/[\/]/);
    if (segs.some((seg) => seg === 'node_modules' || seg === '.git' || seg === '.claude')) return false;
    return !['data', 'backups'].includes(segs[0]);
  },
});

const suite = () => spawnSync(process.execPath, [path.join(TREE, 'scripts', 'test-worklist.mjs')], { encoding: 'utf8' });

/** Apply one anchored edit in the scratch tree, run the suite there, restore. */
function mutate({ label, file, find, to, expect }) {
  const p = path.join(TREE, file);
  const before = readFileSync(p, 'utf8');
  const n = before.split(find).length - 1;
  if (n !== 1) { fail(`${label}: anchor matched ${n} times in ${file}, not once — the mutation did not do what it says`); return; }
  writeFileSync(p, before.replace(find, to));
  const r = suite();
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
  const r = suite();
  if (r.status !== 0) fail(`the unmutated copy is already red — every case below would be meaningless\n${r.stdout}${r.stderr}`);
  else ok('the unmutated scratch copy passes');
}

console.log('\nmutations');

// 1. The code exactly as it stood before OA-295: one clause, four claims.
mutate({
  label: 'the bug verbatim — published_version_id read as "public"',
  file: 'src/worklist/index.js',
  find: "    const unlisted = !!d.published_key && !(d.public_listed && d.customer_status === 'active');",
  to: '    const unlisted = false;',
  expect: '✗ un-listing it stops the row claiming the public has anything',
});

// 2. The half-fix. public_listed is the clause somebody would think of; a
//    suspended organisation hides the map just as completely and is the one
//    that gets forgotten, because nothing on the map itself records it.
mutate({
  label: 'public_listed consulted and the customer status forgotten',
  file: 'src/worklist/index.js',
  find: "    const unlisted = !!d.published_key && !(d.public_listed && d.customer_status === 'active');",
  to: '    const unlisted = !!d.published_key && !d.public_listed;',
  expect: '✗ a suspended customer hides the map too, and the row says so',
});

// 3. Item 2 of the action: the sentence can be right and the row still sit in
//    the tidy-up band, where nobody reads it.
mutate({
  label: 'the wording fixed and the rank left in housekeeping',
  file: 'src/worklist/index.js',
  find: '      key: `draft-${d.id}`, rank: unlisted ? 4 : stale ? 8 : 9, type: \'draft-unsubmitted\',',
  to: '      key: `draft-${d.id}`, rank: stale ? 8 : 9, type: \'draft-unsubmitted\',',
  expect: '✗ … and leaves the housekeeping band, because it is the tail of an incident',
});

// 4. THE CONTROL DIRECTION, and the reason this file exists. Drop the two
//    columns from the query and every published map reads un-listed, because
//    `undefined` is falsy — the row then says NOT LISTED about maps that are
//    on the site, and three of the four wording cases above still pass.
mutate({
  label: 'the visibility columns dropped from the query, so every draft shouts',
  file: 'src/db/index.js',
  find: '              pv.storage_key AS published_key,\n              m.public_listed, c.status AS customer_status',
  to: '              pv.storage_key AS published_key',
  expect: '✗ a published, listed map still says the public has the old version',
});

console.log(`\n${failures ? `x ${failures} case(s) failed` : '+ every case reddens the suite on its own assertion'}\n`);
process.exit(failures ? 1 : 0);
