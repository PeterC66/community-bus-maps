#!/usr/bin/env node
// prove-red-suggest.mjs — falsify test-suggest.mjs (buses-data OA-308 tier 3).
//
//   node scripts/prove-red-suggest.mjs     (or: npm run test:prove-red-suggest)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags and
// no placeholders.
//
// test-suggest.mjs was green on its first run, which by itself means nothing:
// the point of these arms is that each breaks ONE of the four rules the letter
// exists to keep and requires the named check to go red. Three of those rules
// fail invisibly — a letter that quietly pitches us, a letter offered beside a
// map we just linked to, and a send-it-for-you control would all LOOK fine on the
// page — so an un-falsified test of them is worth roughly nothing.
//
//   0  control — an untouched copy of the tree                 -> exit 0
//   1  the "you send this" sentence taken out of the card      -> rule 1
//   2  a mailto: with the authority in it                      -> rule 1's absence check
//   3  the copy button unhidden in the markup                  -> the JS-off check
//   4  the pitch folded into the letter body                   -> rule 2
//   5  …and into the copied text by default                    -> rule 2's copy check
//   6  the town rule dropped, so a mapped town gets a letter    -> rule 4
//   7  the match kind not carried out of the search            -> the wire between them
//   8  the authority name interpolated unescaped               -> the escaping check
//   9  the "put it in your own words" note removed             -> rule 5
//  10  the authority greeted by name again                     -> the pairing check
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY: each arm copies src/, scripts/ and
// public/js + public/data into a scratch tree, edits the copy and runs the test
// from there. No node_modules, no database, no network.

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-suggest-'));
  scratches.push(dir);
  for (const sub of ['src', 'scripts', path.join('public', 'js'), path.join('public', 'data')]) {
    cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  return dir;
}

function runIn(dir) {
  const res = spawnSync(process.execPath, [path.join(dir, 'scripts', 'test-suggest.mjs')],
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

const CARD = path.join('public', 'js', 'shared', 'map-card.mjs');
const LETTER = path.join('public', 'js', 'shared', 'suggest-letter.mjs');
const SEARCH = path.join('src', 'search', 'directory.js');

console.log('\n0  the control — an untouched copy');
{
  const dir = makeCopy();
  const { out, code } = runIn(dir);
  if (code !== 0) fail(`the shipped test exits ${code} on a clean copy; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

arm('1  the "you send this, not us" sentence taken out of the card',
  (dir) => patch(dir, CARD, (s) => s.replace('<strong>You send this, not us.</strong> ', '')),
  [['says in as many words that the reader sends it', 'rule 1']]);

arm('2  a mailto: link added, so the page addresses the council for the reader',
  (dir) => patch(dir, CARD, (s) => s.replace(
    '<p class="dir-ask-actions">',
    '<p class="dir-ask-actions"><a href="mailto:buses@example.gov.uk">Email them</a> ')),
  [['there is no mailto: anywhere in it', 'the no-relay check']]);

arm('3  the copy button unhidden, so JavaScript-off readers get a dead control',
  (dir) => patch(dir, CARD, (s) => s.replace('data-copy-letter hidden>', 'data-copy-letter>')),
  [['the copy button starts hidden', 'the JavaScript-off check']]);

arm('4  the pitch folded into the letter body',
  (dir) => patch(dir, LETTER, (s) => s.replace(
    "    'Yours faithfully,',",
    "    'There is a supplier already producing exactly this kind of sheet — busmaps.uk.',\n    '',\n    'Yours faithfully,',")),
  [['the letter body recommends no supplier', 'rule 2']]);

arm('5  the pitch put into the copied text by default',
  (dir) => patch(dir, LETTER, (s) => s.replace(
    'export function letterPlainText(letter, { withExtra = false } = {}) {',
    'export function letterPlainText(letter, { withExtra = true } = {}) {')),
  [['the copied text is the letter WITHOUT the pitch by default', "rule 2's copy check"]]);

arm('6  the town rule dropped, so a reader is offered a letter about a map we just linked to',
  (dir) => patch(dir, LETTER, (s) => s.replace(
    "  if (matchKind === 'town') return { show: false, why: 'a map of this town already exists' };\n", '')),
  [
    ['a TOWN hit offers no letter', 'rule 4'],
    ['no letter on a row that already maps the place asked for', "rule 4's rendered half"],
  ]);

arm('7  the match kind not carried out of the search, so the card cannot apply rule 4',
  (dir) => patch(dir, SEARCH, (s) => s.replace(
    '      matched: { kind: term.kind, text: term.text },\n', '')),
  [['the real search returns a match kind', 'the wire between the search and the card']]);

arm('8  the authority name interpolated into the letter unescaped',
  (dir) => patch(dir, CARD, (s) => s.replace('<pre class="dir-letter" data-letter>${esc(plain)}</pre>',
    '<pre class="dir-letter" data-letter>${plain}</pre>')),
  [['the authority name is escaped inside the letter', 'the escaping check']]);

arm('9  the "put it in your own words" note taken out — rule 5, which only this sentence holds',
  (dir) => patch(dir, CARD, (s) => s.replace(
    /\n        <p class="dir-ask-note"><strong>Put it in your own words\.<\/strong>[^\n]*<\/p>/, '')),
  [
    ['tells the reader to put it in their own words', 'rule 5'],
    ['says the letter is a starting point rather than a form', "rule 5's second half"],
  ]);

arm('10  the authority greeted by name again, so the salutation and the sign-off disagree',
  (dir) => patch(dir, LETTER, (s) => s.replace(
    "    'Dear Sir or Madam,',", '    `Dear ${authority},`,')),
  [
    ['the salutation is the one that pairs with the sign-off', 'the pairing check'],
    ['the authority is not ALSO greeted by name', 'the named-addressee check'],
  ]);

for (const d of scratches) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a temp dir */ } }

console.log('');
if (failures) { console.error(`✗ ${failures} falsification(s) failed`); process.exit(1); }
console.log('✓ every arm went red on purpose, and the control stayed green');
