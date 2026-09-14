// prove-red-owner-picker.mjs — falsify test-owner-picker.mjs (buses-data OA-364).
//
//   node scripts/prove-red-owner-picker.mjs   (or: npm run test:prove-red-owner-picker)
//
// A test made of regular expressions over three files it names itself is exactly
// the kind that can be green because it is looking in the wrong place. "The
// subject you named yourself" — a check pointed at an identifier YOU supplied
// cannot report that the identifier was wrong — so every arm below removes one
// thing from a SCRATCH COPY of the tree and requires the shipped test to refuse,
// naming the assertion it must be.
//
// The arms are the faults the test exists to catch, each one a real shape:
//
//   0  control — the tree as shipped                      -> exit 0
//   1  the POST deleted from public/app/editor.js         -> exit 1, "POSTs to"
//      (OA-364 itself: the route complete, nothing calling it)
//   2  one element renamed in views/app/editor.html only  -> exit 1, "#ownerSelect"
//      (the control silently does nothing — the join is what sees it)
//   3  `restamped` never read in the client               -> exit 1, "restamp"
//      (OA-362: an outcome reported that the response never carried)
//   4  the step-up branch removed                         -> exit 1, "step-up"
//      (a recoverable refusal shown as a raw failure)
//   5  the quota branch removed                           -> exit 1, "quota"
//   6  the confirmation's showModal() removed             -> exit 1, "asks before acting"
//      (a picker that moves a map between tenants on one click)
//   7  the route renamed on the SERVER                    -> exit 1, "still declares"
//      (the test would otherwise be about nothing, and say so in green)
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY: each arm copies the three files
// into a scratch tree and runs the shipped test against that tree, which the
// test accepts as its one positional argument.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-owner-picker.mjs');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const FILES = [
  ['public', 'app', 'editor.js'],
  ['views', 'app', 'editor.html'],
  ['src', 'routes', 'admin.js'],
];

/** A scratch tree holding just the three files the test reads. */
function scratch(mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-owner-'));
  for (const parts of FILES) {
    const rel = path.join(...parts);
    cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: false, force: true, errorOnExist: false, mode: 0, dereference: true });
  }
  if (mutate) mutate({
    read: (parts) => readFileSync(path.join(dir, path.join(...parts)), 'utf8'),
    write: (parts, s) => writeFileSync(path.join(dir, path.join(...parts)), s),
  });
  return dir;
}

function run(dir) {
  const res = spawnSync(process.execPath, [TEST, dir], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

/**
 * One arm: break something, require exit 1, and require the REASON to be the
 * assertion we broke. An arm that goes red for some other reason has proved
 * nothing about the assertion it was aimed at.
 */
function arm(n, what, mutate, expect) {
  console.log(`\n${n}  ${what}`);
  let dir;
  try {
    dir = scratch(mutate);
    const { out, code } = run(dir);
    if (code === 0) { fail('the test still passed — this fault is invisible to it'); return; }
    const named = reds(out).filter((l) => expect.test(l));
    if (!named.length) {
      fail(`exit ${code}, but no failure mentions ${expect}. It went red for something else:\n     ${reds(out).join('\n     ') || '(no ✗ lines)'}`);
      return;
    }
    ok(`exit ${code} — ${named[0]}`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// A mutation that does not change the file is a silent no-op that would make an
// arm pass for the wrong reason, so every replacement below is asserted to bite.
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

const JS = FILES[0];
const HTML = FILES[1];
const ADMIN = FILES[2];

arm(1, 'the POST is deleted — the OA-364 fault itself, a complete route nothing calls',
  ({ read, write }) => write(JS, cut(read(JS), 'fetch(`/api/admin/maps/${MAP_ID}/owner`', 'fetch(`/api/admin/maps/${MAP_ID}/nothing`')),
  /POSTs to/);

arm(2, 'one element is renamed in the PAGE only — the control that silently does nothing',
  ({ read, write }) => write(HTML, cut(read(HTML), 'id="ownerSelect"', 'id="ownerPicker"')),
  /#ownerSelect/);

arm(3, 'the client stops reading `restamped` — OA-362, an outcome the response never carried',
  ({ read, write }) => write(JS, read(JS).replace(/restamped/g, 'ignoredField')),
  /restamp/i);

arm(4, 'the step-up branch is removed — a recoverable refusal shown as a fault',
  ({ read, write }) => write(JS, read(JS).replace(/'step-up-required'/g, "'something-else'")),
  /step-up/i);

arm(5, 'the quota branch is removed',
  ({ read, write }) => write(JS, cut(read(JS), "body.code === 'quota'", 'false')),
  /quota/i);

arm(6, 'the confirmation is removed — a picker that moves a map on one click',
  ({ read, write }) => write(JS, read(JS).replace(/showModal\(\)/g, 'focus()')),
  /asks before acting/);

arm(7, 'the route is renamed on the SERVER — the test would otherwise be about nothing',
  ({ read, write }) => write(ADMIN, cut(read(ADMIN), "app.post('/maps/:id/owner'", "app.post('/maps/:id/reassign'")),
  /still declares/);

console.log('');
if (failures) {
  console.error(`${failures} arm(s) did not go red as required.`);
  process.exit(1);
}
console.log('test-owner-picker.mjs has been seen to refuse every fault it exists for.');
