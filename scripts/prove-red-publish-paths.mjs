#!/usr/bin/env node
// PROVE check-publish-paths.mjs CAN GO RED (buses-data OA-379, 2026-09-16).
//
//   node scripts/prove-red-publish-paths.mjs   (or: npm run test:prove-red-publish-paths)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments and there are no placeholders. It writes nothing outside a temporary
// directory: other sessions share this checkout, and a mutated source file left
// behind by a crashed harness would be a guard that had quietly stopped guarding.
//
// A green check that has never been seen to go red proves nothing, and this one
// would have been green on an empty declaration list. So the arms below break it
// eight ways and check that each is NAMED, with a control that the real tree is
// clean. Arm 1 is the exact state `main` was in on the morning of 2026-09-16 —
// the reason the check exists — and arm 8 is the one the design could have got
// wrong without anybody noticing: it proves the search window is load-bearing
// rather than generous enough to answer for any call anywhere in the file.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SCRIPTS, '..');
const CHECKER = 'scripts/check-publish-paths.mjs';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** A throwaway copy of the two trees the checker reads. No node_modules, no data. */
function freshTree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-publish-paths-'));
  cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('node_modules'),
  });
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, CHECKER)], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function edit(dir, rel, fn) {
  const p = path.join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

/** Run one arm against its own fresh copy, then throw the copy away. */
function arm(name, mutate, expect) {
  const dir = freshTree();
  try {
    mutate(dir);
    const { code, out } = run(dir);
    check(name, code === 1 && expect.test(out), `exit ${code}; output was:\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nthe control — the real tree must be clean, or every arm below is meaningless');
{
  const { code, out } = run(ROOT);
  check('the checker passes on the tree as it stands', code === 0, `exit ${code}; output was:\n${out}`);
  check('…and it found the publish paths rather than an empty set', /5 publish path\(s\)/.test(out), out);
}

console.log('\nbreaking it — each of these must be NAMED, not merely counted');

arm('1. the state main was in this morning: publish-baseline stops writing the sidecar',
  (d) => edit(d, 'scripts/publish-baseline.mjs', (s) => s.replace(/^\s*writePlacesSidecar\(.*$/m, '')),
  /publish-baseline\.mjs:\d+ — declared as writing the place-name sidecar/);

arm('2. the demo seeder stops writing it',
  (d) => edit(d, 'scripts/seed-demo.mjs', (s) => s.replace(/^\s*writePlacesSidecar\(.*$/m, '')),
  /seed-demo\.mjs:\d+ — declared as writing the place-name sidecar/);

arm('3. the approve handler stops writing it',
  (d) => edit(d, 'src/routes/review.js', (s) => s.replace(/^\s*writePlacesSidecar\(.*$/m, '')),
  /review\.js:\d+ — declared as writing the place-name sidecar/);

arm('4. a NEW publish path nobody declared',
  (d) => {
    mkdirSync(path.join(d, 'scripts'), { recursive: true });
    writeFileSync(path.join(d, 'scripts', 'publish-the-new-way.mjs'),
      "import { setPublishedVersion } from '../src/db/index.js';\nsetPublishedVersion(1, 2);\n");
  },
  /publish-the-new-way\.mjs:\d+ — a publish path this check has never been told about/);

arm('5. a declared call site that has gone away',
  (d) => edit(d, 'scripts/publish-baseline.mjs', (s) => s.replace(/^\s*setPublishedVersion\(.*$/m, '')),
  /publish-baseline\.mjs #0 — declared .* but there is no setPublishedVersion\(\) call there any more/);

arm('6. the EXEMPT revert path quietly starts writing one',
  (d) => edit(d, 'src/routes/review.js', (s) => s.replace(
    /^(\s*)bumpSearchIndex\(\); \/\/ P9 — the reverted-to version.*$/m,
    (_m, indent) => `${indent}writePlacesSidecar(m.id, target.version, { kind: m.kind, subject: m.subject });\n${indent}bumpSearchIndex();`)),
  /review\.js:\d+ — declared EXEMPT/);

arm('7. an exemption with its reason taken away',
  (d) => edit(d, CHECKER, (s) => s.replace(/why: 'the version reverted to[^']*',/, "why: '',")),
  /#1 — exempt with no reason/);

arm('8. the sidecar write pushed beyond the window — so the window is load-bearing',
  (d) => edit(d, 'scripts/publish-baseline.mjs', (s) => {
    const call = s.match(/^\s*writePlacesSidecar\(.*$/m)[0];
    // Same file, same function, 60 blank lines further down: a call that can no
    // longer plausibly be the one belonging to this pointer move.
    return s.replace(call, '\n'.repeat(60) + call);
  }),
  /publish-baseline\.mjs:\d+ — declared as writing the place-name sidecar/);

console.log('\nand a control on the exclusion that is wide enough to hide something');
{
  const dir = freshTree();
  try {
    writeFileSync(path.join(dir, 'scripts', 'test-something-new.mjs'),
      "import * as db from '../src/db/index.js';\ndb.setPublishedVersion(1, 2);\n");
    const { code, out } = run(dir);
    check('a new test file that publishes is skipped, and SAYS it was skipped',
      code === 0 && /not a publish path: scripts\/test-something-new\.mjs/.test(out), `exit ${code}; output was:\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} arm(s) did not go red.` : '\nEvery arm went red for its own reason, and both controls held.');
process.exit(failures ? 1 : 0);
