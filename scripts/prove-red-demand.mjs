#!/usr/bin/env node
// prove-red-demand.mjs — falsify test-demand.mjs (buses-data OA-308 tier 4).
//
//   node scripts/prove-red-demand.mjs      (or: npm run test:prove-red-demand)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags and
// no placeholders.
//
// THE ARM THAT MATTERS MOST IS 4. Everything else here is ordinary falsification
// — does the filter check bite, does the counter check bite. Arm 4 adds a column
// to the tally that would turn it into a log, and that is the change nobody would
// notice: the reports still print, every other test stays green, the page behaves
// identically, and the only thing that has changed is what the database now holds
// about the people who used it. If the schema check does not go red there, the
// promise in public/legal.html is being kept by nothing but everybody's memory.
//
//   0  control — an untouched copy of the tree                  -> exit 0
//   1  the character rule loosened to allow digits              -> a postcode is kept
//   2  the word limit removed                                   -> a sentence is kept
//   3  the filter made to reject everything                     -> the KEPT half
//   4  a `created_at` timestamp added to the tally              -> the not-a-log check
//   5  the skipped counter given a copy of the text             -> the no-quoting check
//   6  case folding dropped, so York and york are two rows      -> the one-row check
//   7  /api/public/search taken off the redaction list          -> the log promise
//
// Arm 3 is the one that catches a filter written backwards, and it is here
// because a shape filter is exactly the kind of rule that passes a test looking
// only at what it refuses. Arm 7 is a rule this file does not own — it belongs to
// logRedaction.js — and is asserted here anyway, because tier 4 is the change
// that gives somebody a reason to relax it.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);
const scratches = [];

function makeCopy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-demand-'));
  scratches.push(dir);
  for (const sub of ['src', 'scripts', path.join('public', 'js'), path.join('public', 'data')]) {
    cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  return dir;
}

function runIn(dir) {
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'test-demand.mjs')],
    { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

function patch(dir, rel, edit) {
  const p = path.join(dir, rel);
  const before = readFileSync(p, 'utf8');
  const after = edit(before);
  if (after === before) {
    fail(`the patch to ${rel} changed nothing — this harness is testing the wrong text`);
    return false;
  }
  writeFileSync(p, after);
  return true;
}

function arm(title, mutate, wants) {
  console.log(`\n${title}`);
  const dir = makeCopy();
  if (!mutate(dir)) return;
  const { out, code } = runIn(dir);
  if (code === 0) {
    fail('exit 0 — the break was not noticed, so that check proves nothing');
    return;
  }
  ok(`exit ${code}`);
  const r = reds(out);
  for (const [phrase, what] of wants) {
    if (r.some((l) => l.includes(phrase))) ok(`${what} went red`);
    else fail(`${what} stayed green ("${phrase}") — it does not check what its name says\n      red lines were: ${r.join(' | ') || '(none)'}`);
  }
}

const DEMAND = path.join('src', 'search', 'demand.js');
const SCHEMA = path.join('src', 'db', 'schema.sql');
const REDACT = path.join('src', 'public', 'logRedaction.js');

console.log('\n0  the control — an untouched copy');
{
  const dir = makeCopy();
  const { out, code } = runIn(dir);
  if (code !== 0) fail(`the shipped test exits ${code} on a clean copy; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

arm('1  the character rule loosened to allow digits, so a postcode is stored',
  (dir) => patch(dir, DEMAND, (s) => s.replace(
    "if (!/^[\\p{L}][\\p{L} '’.\\-]*$/u.test(raw))",
    "if (!/^[\\p{L}0-9][\\p{L}0-9 '’.\\-]*$/u.test(raw))")),
  [['"PE27 5BZ" is refused', 'the postcode check']]);

arm('2  the word limit removed, so a whole question is stored',
  (dir) => patch(dir, DEMAND, (s) => s.replace(
    "  if (raw.split(' ').length > MAX_WORDS) return { ok: false, key: '', reason: 'too many words' };\n", '')),
  [['is refused (too many words)', 'the sentence check']]);

arm('3  the filter made to refuse everything — the direction a one-sided test misses',
  (dir) => patch(dir, DEMAND, (s) => s.replace(
    "  return { ok: true, key: raw.toLowerCase(), reason: '' };",
    "  return { ok: false, key: '', reason: 'not a plain name' };")),
  [['"York" is a place name', 'the KEPT half of the filter']]);

arm('4  a created_at timestamp added to the tally — the change that turns it into a log',
  (dir) => patch(dir, SCHEMA, (s) => s.replace(
    '  last_seen  TEXT NOT NULL DEFAULT (date(\'now\'))\n);',
    '  last_seen  TEXT NOT NULL DEFAULT (date(\'now\')),\n  created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))\n);')),
  [
    ['the columns are exactly the four a tally needs', 'the column census'],
    ['no created_at column', 'the named-column check'],
  ]);

arm('5  the skipped counter given a copy of the text it refused',
  (dir) => patch(dir, SCHEMA, (s) => s.replace(
    '  last_seen  TEXT\n);',
    '  last_seen  TEXT,\n  q          TEXT\n);')),
  [['the skipped counter holds no text at all', 'the no-quoting check']]);

arm('6  case folding dropped, so York and york become two rows',
  (dir) => patch(dir, DEMAND, (s) => s.replace('key: raw.toLowerCase()', 'key: raw')),
  [['three spellings of one town are one row', 'the one-row check']]);

arm('7  /api/public/search taken off the redaction list, so the query reaches the log',
  (dir) => patch(dir, REDACT, (s) => s.replace(
    "export const BARE_QUERY_ROUTES = ['/api/public/search', '/maps?', '/auth/verify?'];",
    "export const BARE_QUERY_ROUTES = ['/maps?', '/auth/verify?'];")),
  [['still has its query string dropped', 'the search-is-never-logged promise']]);

for (const d of scratches) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a temp dir */ } }

console.log('');
if (failures) { console.error(`✗ ${failures} falsification(s) failed`); process.exit(1); }
console.log('✓ every arm went red on purpose, and the control stayed green');
