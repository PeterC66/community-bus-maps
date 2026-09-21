#!/usr/bin/env node
// test-node-pin.mjs — the Node version is pinned in several places, and they agree.
//
// WHY THIS EXISTS (codebase review 2026-09-01, cross-repo F14/F15). The reviewer
// counted the Node version pinned FIVE ways across the three repositories, and
// this repository held the widest disagreement of them: `engines` said `>=22`
// while the Dockerfile built on `node:24-slim` and three workflows installed 24.
// Nobody was running Node 22 anywhere, and nothing said so.
//
// A LOOSE FLOOR IS NOT HARMLESS HERE. `engines` is the only one of these a person
// reads before installing a toolchain, and a `>=22` invites somebody to develop on
// a runtime that no build, no workflow and no container has ever used — so a
// feature that landed in 23 or 24 works on their laptop and in CI and is simply
// not covered by the floor they were told to meet. The Dockerfile is the authority
// because it is what actually serves the site: `verify.yml` already derives its
// `setup-node` version from the FROM line rather than repeating it.
//
// WHAT IS ASSERTED, and it is a JOIN in every case — none of these can be checked
// by reading one file:
//
//   1. `engines.node` names the SAME major the Dockerfile builds on.
//   2. Every workflow that pins `node-version:` literally pins that major.
//   3. The Dockerfile FROM line is still in the shape verify.yml's `sed` reads,
//      because that step's failure mode is silent for everything except itself.
//
// It is deliberately not a lint rule and not a comment. The five pins drifted for
// months while every one of them was individually correct-looking.
//
// Run it from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:node-pin
// It is also discovered by `npm test`.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

console.log('test-node-pin — one Node major, however many places name it\n');

// ---- 1. the authority: the image the site actually runs on ------------------
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
// The same expression verify.yml's step uses, so this fails when THAT would.
const from = dockerfile.match(/^FROM node:(\d+)/m);
check(!!from, 'the Dockerfile FROM line names a Node major',
  'no line matching /^FROM node:(\\d+)/ — verify.yml\'s nodever step reads this and would fail too');
if (!from) process.exit(1);
const MAJOR = from[1];
console.log(`        (Dockerfile builds on Node ${MAJOR})`);

// ---- 2. engines --------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const engines = pkg.engines && pkg.engines.node;
check(!!engines, 'package.json declares engines.node', 'no engines field');
const enginesMajor = engines && (engines.match(/(\d+)/) || [])[1];
check(enginesMajor === MAJOR,
  `engines.node (${engines}) names the same major as the Dockerfile`,
  `engines says ${engines} and the image is node:${MAJOR} — a floor nothing has ever run`);

// ---- 3. the workflows --------------------------------------------------------
// Only the LITERAL pins. verify.yml derives its version from the Dockerfile on
// purpose and must not be forced to repeat it — a check that demanded the literal
// there would push the one workflow that got this right into getting it wrong.
const wfDir = join(ROOT, '.github', 'workflows');
const literals = [];
for (const f of readdirSync(wfDir).filter((n) => n.endsWith('.yml'))) {
  const src = readFileSync(join(wfDir, f), 'utf8');
  for (const m of src.matchAll(/node-version:\s*'?"?(\d+)['"]?\s*$/gm)) literals.push({ f, v: m[1] });
}
check(literals.length > 0, 'at least one workflow pins a literal node-version',
  'none found — either the workflows changed shape or this regex has gone blind');
for (const { f, v } of literals) {
  check(v === MAJOR, `${f} installs Node ${v}`, `the image is node:${MAJOR}`);
}
console.log(`        (${literals.length} literal workflow pin(s) checked; verify.yml derives its own from the Dockerfile)`);

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed — the Node pins disagree. The Dockerfile is the authority.`);
  process.exit(1);
}
console.log(`Every Node pin names ${MAJOR}.`);
