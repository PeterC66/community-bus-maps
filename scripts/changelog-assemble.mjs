#!/usr/bin/env node
/*
 * changelog-assemble.mjs — build the local, GITIGNORED CHANGELOG.md, and check
 * that every fragment in CHANGELOG.d/ is well formed.
 *
 * WHY THE CHANGELOG IS ONE FILE PER ENTRY. CHANGELOG.md reached 2,407 lines and
 * 65 of the last 200 commits. That is two problems in one file: two sessions
 * appending to it on the same day conflict every time, and anyone who opens it
 * pays for the whole history to read the last week. Both go away if each entry
 * is its own file — concurrent sessions write different paths, and a reader
 * loads only the entries they want.
 *
 * WHY THE INDEX IS NO LONGER IN GIT (2026-09-03), which is the part the split
 * got wrong. The fragments were split out and the GENERATED INDEX was still
 * committed — and every commit regenerates it, so the contention did not go
 * away, it moved onto one line and became universal. Measured: 60 of the last
 * 60 commits touched CHANGELOG.md, against 145 of 200 before the split. This
 * file's own header used to claim the opposite — that because the block is
 * sorted deterministically, "two sessions regenerating it independently produce
 * identical bytes and cannot conflict over the index either" — and that was
 * false on the day it was written. Determinism means the same FRAGMENT SET
 * gives the same bytes; two concurrent sessions have DIFFERENT sets, by one
 * file each, so their indexes differ by one line in the same place, which is
 * the definition of a conflict. The same sentence was in CHANGELOG.d/README.md
 * and in buses-data's glossary, and all three are corrected together.
 *
 * SO: CHANGELOG.head.md is TRACKED and holds the prose; CHANGELOG.md is
 * GENERATED from it plus CHANGELOG.d/ and is gitignored. Nothing derived is in
 * git, so nothing derived can conflict. A merge driver was written first and
 * thrown away: it worked, but not having a conflict beats resolving one, and it
 * needed a `git config` line in every clone that git silently ignores if
 * anybody forgets.
 *
 * WHAT `--check` MEANS NOW. It used to ask "is the committed index stale?",
 * which is a question about a file that is no longer in git. It now validates
 * the FRAGMENTS — front matter present, the filename agreeing with its own
 * `date:`, and no two differing only in case, which on this laptop are two
 * files and on the Linux server are one. That check cannot go stale, and it
 * catches errors the old one only found by accident when a rebuild happened to
 * break.
 *
 * The rules themselves live in src/changelog.js, because the admin /changelog
 * route needs the same ones and only src/ ships in the image by contract. This
 * file is the CLI around them.
 *
 * Run from the repository root (C:\Claude\community-bus-maps), no placeholders:
 *     npm run changelog                 build the local CHANGELOG.md
 *     npm run changelog:check           validate the fragments (CI, npm test)
 *
 * To add an entry, write the file yourself — a fragment is just a markdown file
 * with two front-matter keys. See CHANGELOG.d/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { entriesFromDir, renderIndex, spliceIndex } from '../src/changelog.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'CHANGELOG.d');
const HEAD = path.join(ROOT, 'CHANGELOG.head.md');
const FILE = path.join(ROOT, 'CHANGELOG.md');
const CHECK = process.argv.includes('--check');

/* A bad fragment must stop the run and SAY SO in one line. The first cut let the
 * parser's throw reach the top level, so a missing title printed a Node stack
 * trace with the actual message four lines up — which is how a person concludes
 * the tool is broken rather than their file. */
let entries;
try {
  entries = entriesFromDir(DIR);
} catch (e) {
  console.error(`Bad changelog fragment: ${e.message}`);
  console.error('Every file in CHANGELOG.d/ needs `date: YYYY-MM-DD` and `title: "..."` front matter,');
  console.error('and its filename must start with that same date. See CHANGELOG.d/README.md.');
  process.exit(1);
}

if (CHECK) {
  console.log(`changelog: ${entries.length} fragment(s) in CHANGELOG.d/, all well formed.`);
  process.exit(0);
}

let head;
try {
  head = fs.readFileSync(HEAD, 'utf8');
} catch {
  console.error('CHANGELOG.head.md is missing — it is the tracked prose this page is built around.');
  process.exit(2);
}

const { block, count } = renderIndex(entries);
let next;
try {
  next = spliceIndex(head, block);
} catch (e) {
  console.error(`CHANGELOG.head.md is ${e.message}.`);
  process.exit(2);
}
/* Always written FROM THE TEMPLATE, never spliced into whatever CHANGELOG.md
 * happened to hold. The old code spliced into the file itself, which is how a
 * conflict marker sitting above the index once survived a regenerate and got
 * committed wearing the authority of a tool that had run and exited 0. */
fs.writeFileSync(FILE, next);
console.log(`CHANGELOG.md rebuilt from CHANGELOG.head.md + ${count} fragment(s). It is gitignored — do not commit it.`);
