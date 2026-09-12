#!/usr/bin/env node
// EVERY BROWSER SCRIPT PARSES. The cheapest check there is, and until 2026-09-12
// nothing in this repository asked it.
//
//   node scripts/test-client-scripts.mjs        (or: npm run test:client-scripts)
//
// WHY IT EXISTS. While building the local adviser's seat (buses-data OA-154 D1) a
// comment went inside a template literal in `public/app/admin.js` and carried a
// pair of backticks. That ended the string, and the file stopped parsing — so the
// WHOLE ADMIN CONSOLE was a blank page with "Loading…" on it. `npm test` stayed
// green through all 78 files, `npm run verify` reproduced every sheet
// byte-for-byte, and the pre-commit hook was happy, because not one thing in this
// repository ever loads a file under `public/`. It was found by opening the page.
//
// That is the same shape as the buses side's *dark file* (a generator no map
// selected threw for a day through a deploy, with every gate green), and it has
// the same cheap answer: ask whether the file LOADS. A browser script cannot be
// imported here — it expects `document` — but it can be PARSED, which is all that
// class of fault needs.
//
// THE POPULATION IS THE DISK, not a list: every `.js`/`.mjs` under `public/`,
// so a script added tomorrow is checked tomorrow. `.mjs` and any file using
// `import`/`export` is parsed as a module, everything else as a classic script,
// because the two grammars differ and parsing a module as a script reports a
// syntax error that is not one.
//
// AND IT CARRIES ITS OWN CONTROL. A checker that has never been seen to refuse is
// a checker nobody should trust, so the last two assertions parse deliberately
// broken sources — one of them the exact fault above — and require a throw.

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.m?js$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Parse `src` the way a browser would, and return the error if it will not.
 *
 * TWO GRAMMARS, TWO PARSERS, and the first draft of this file got it wrong in the
 * direction that matters: it tried to parse a module by stripping its `import`
 * and `export` lines and handing the rest to `vm.Script`, which turns
 * `export function f() {…}` into an orphaned body and reports three real files as
 * broken. A checker whose failures are its own is worse than no checker.
 *
 * So a MODULE is written to a temp `.mjs` and checked by `node --check`, which is
 * the same parser the browser's is modelled on and needs no flag; a classic
 * script goes through `vm.Script` in-process, because that is the grammar a
 * `<script src>` without `type="module"` is read with and it is 25 files.
 */
function parseError(src, asModule) {
  if (!asModule) {
    try { new vm.Script(src); return null; } catch (e) { return e.message; }
  }
  const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), 'cbm-parse-')), 'check.mjs');
  writeFileSync(tmp, src);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  rmSync(path.dirname(tmp), { recursive: true, force: true });
  if (r.status === 0) return null;
  return (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || `node --check exited ${r.status}`;
}

const files = walk(PUBLIC).sort();
console.log(`\nevery browser script under public/ parses (${files.length} files)`);
check('the population is not empty — a check that finds no subject must never report clear', files.length > 0);

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  const asModule = file.endsWith('.mjs') || /^\s*(import|export)\b/m.test(src);
  const err = parseError(src, asModule);
  check(`${rel}${asModule ? ' (module)' : ''}`, err === null, err);
}

console.log('\nand the checker has been seen to refuse');
// THE EXACT FAULT THIS FILE WAS WRITTEN FOR: a backtick inside a template
// literal, which ends the string and leaves the rest of the file as nonsense.
const backtickInTemplate = 'function row(u) { return `<option>${u.role}</option>\n'
  + '  <!-- `adviser` is offered here --> `; }';
check('a backticked word inside a template literal is refused', parseError(backtickInTemplate, false) !== null,
  'the parser accepted the fault this file exists for');
check('an unclosed brace is refused', parseError('function f() { if (1) {', false) !== null,
  'the parser accepted an obviously broken source');

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('Every script the browser is asked to load can be parsed.');
