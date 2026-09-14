// prove-red-delete-map.mjs — falsify test-delete-map.mjs.
//
//   node scripts/prove-red-delete-map.mjs   (or: npm run test:prove-red-delete-map)
//
// The assertion that matters in the test — *a map with a live adviser grant
// actually deletes* — is the kind that is green on a healthy tree whether or not
// it is testing anything. So arm 1 does not invent a fault: it checks out the
// REAL `scripts/delete-map.mjs` as it stood on `main` before the fix and requires
// the test to refuse. If that arm ever goes quiet, the test has stopped being
// about the bug it was written for.
//
//   0  control — the tree as shipped                        -> exit 0
//   1  delete-map.mjs AS IT WAS BEFORE THE FIX (from git)    -> exit 1, and the
//      failures must include both halves: section 1 saying the grant table is
//      unhandled, and section 3 saying the delete did not succeed
//   2  only the DELETE FROM map_adviser_grant line removed   -> exit 1, "clears map_adviser_grant"
//   3  a NEW table referencing map(id) added to the schema   -> exit 1, naming THAT
//      table — which is what proves section 1's population is read from the
//      schema rather than typed into the test
//   4  a foreign key put onto message.map_id                 -> exit 1, "message.map_id"
//   5  delete-map.mjs made to delete from audit_log          -> exit 1, "never deletes"
//   6  the dry run's adviser listing removed                 -> exit 1, "dry run NAMES"
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY: each arm copies `src/` and
// `scripts/` into a scratch tree, edits the copy, and runs the shipped test
// against that tree, which the test accepts as its one positional argument.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-delete-map.mjs');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

/** A scratch tree holding the two folders the script and the test read. */
function scratch(mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prdelmap-'));
  for (const sub of ['src', 'scripts']) {
    cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  if (mutate) {
    mutate({
      read: (rel) => readFileSync(path.join(dir, rel), 'utf8'),
      write: (rel, s) => writeFileSync(path.join(dir, rel), s),
    });
  }
  return dir;
}

function run(dir) {
  const res = spawnSync(process.execPath, [TEST, dir], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

/**
 * One arm: break something, require exit 1, and require the REASON to be each of
 * the assertions we broke. An arm that goes red for some other reason has proved
 * nothing about the assertion it was aimed at.
 */
function arm(n, what, mutate, expects) {
  console.log(`\n${n}  ${what}`);
  let dir;
  try {
    dir = scratch(mutate);
    const { out, code } = run(dir);
    if (code === 0) { fail('the test still passed — this fault is invisible to it'); return; }
    const lines = reds(out);
    for (const expect of [].concat(expects)) {
      const named = lines.filter((l) => expect.test(l));
      if (!named.length) {
        fail(`exit ${code}, but no failure mentions ${expect}:\n     ${lines.join('\n     ') || '(no ✗ lines)'}`);
        return;
      }
    }
    ok(`exit ${code} — ${lines.length} failure(s), including: ${lines[0]}`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

const cut = (s, needle, replacement = '') => {
  if (!s.includes(needle)) throw new Error(`prove-red is stale: ${JSON.stringify(needle.slice(0, 60))} is no longer in the source`);
  return s.replace(needle, replacement);
};

console.log('\n0  the control — the tree as shipped');
{
  const dir = scratch(null);
  const { out, code } = run(dir);
  rmSync(dir, { recursive: true, force: true });
  if (code !== 0) fail(`the shipped test exits ${code}; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

// THE ARM WORTH HAVING. Not an invented fault — the file as it actually stood,
// fetched from git, on the day a handover of a town with a local adviser would
// have failed. `main` is the merge base this branch was cut from; if the fix has
// landed there, this arm has to be pinned to a commit instead, and the harness
// says so rather than going quietly green.
console.log('\n1  delete-map.mjs exactly as it was before the fix');
{
  const before = spawnSync('git', ['show', 'origin/main:scripts/delete-map.mjs'], { cwd: ROOT, encoding: 'utf8' });
  if (before.status !== 0) {
    fail(`could not read the pre-fix file from git: ${(before.stderr || '').trim()}`);
  } else if (before.stdout.includes('map_adviser_grant')) {
    fail('origin/main already handles map_adviser_grant — this arm is no longer about the bug. '
      + 'Pin it to the commit before the fix and say which one in this comment.');
  } else {
    let dir;
    try {
      dir = scratch(({ write }) => write(path.join('scripts', 'delete-map.mjs'), before.stdout));
      const { out, code } = run(dir);
      const lines = reds(out);
      const saysUnhandled = lines.some((l) => /clears map_adviser_grant/.test(l));
      const saysItThrew = lines.some((l) => /delete SUCCEEDS with a live grant/.test(l));
      if (code === 0) fail('the pre-fix script PASSED the test — the test is not about this bug');
      else if (!saysUnhandled) fail(`exit ${code}, but nothing said the grant table was unhandled:\n     ${lines.join('\n     ')}`);
      else if (!saysItThrew) fail(`exit ${code}, and section 1 fired, but section 3 did NOT — the functional half is not exercising the fault:\n     ${lines.join('\n     ')}`);
      else ok(`exit ${code} — both halves fired: the static check and the real delete`);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

arm(2, 'only the DELETE FROM map_adviser_grant line is removed',
  ({ read, write }) => write(path.join('scripts', 'delete-map.mjs'),
    cut(read(path.join('scripts', 'delete-map.mjs')), "  db.prepare('DELETE FROM map_adviser_grant WHERE map_id = ?').run(map.id);\n")),
  [/clears map_adviser_grant/, /delete SUCCEEDS with a live grant/]);

arm(3, 'a NEW table references map(id) — the population must come from the schema',
  ({ read, write }) => write(path.join('src', 'db', 'schema.sql'),
    read(path.join('src', 'db', 'schema.sql'))
    + '\nCREATE TABLE IF NOT EXISTS map_sticker (\n'
    + '  id     INTEGER PRIMARY KEY,\n'
    + '  map_id INTEGER NOT NULL REFERENCES map(id)\n'
    + ');\n'),
  /clears map_sticker/);

arm(4, 'a foreign key is put onto message.map_id',
  ({ read, write }) => {
    const s = read(path.join('src', 'db', 'schema.sql'));
    const line = s.split('\n').find((l) => /^\s*map_id\s+INTEGER\s+$/.test(l) || /^\s*map_id\s+INTEGER\s{2,}--/.test(l));
    if (!line) throw new Error('prove-red is stale: could not find message.map_id');
    write(path.join('src', 'db', 'schema.sql'), s.replace(line, line.replace('INTEGER', 'INTEGER REFERENCES map(id)')));
  },
  /message\.map_id/);

arm(5, 'delete-map.mjs starts deleting from the append-only audit log',
  ({ read, write }) => write(path.join('scripts', 'delete-map.mjs'),
    cut(read(path.join('scripts', 'delete-map.mjs')),
      "  db.prepare('DELETE FROM map WHERE id = ?').run(map.id);\n",
      "  db.prepare('DELETE FROM audit_log WHERE map_id = ?').run(map.id);\n"
      + "  db.prepare('DELETE FROM map WHERE id = ?').run(map.id);\n")),
  /never deletes from audit_log/);

arm(6, 'the dry run stops naming the advisers it is about to drop',
  ({ read, write }) => {
    const s = read(path.join('scripts', 'delete-map.mjs'));
    return write(path.join('scripts', 'delete-map.mjs'),
      cut(s, '    console.log(`    ${g.email}${g.name', '    console.log(`    (an adviser)${\'\'}${g.name'));
  },
  /dry run NAMES the live adviser/);

console.log('');
if (failures) {
  console.error(`${failures} arm(s) did not go red as required.`);
  process.exit(1);
}
console.log('test-delete-map.mjs has been seen to refuse the real bug, and each fault around it.');
