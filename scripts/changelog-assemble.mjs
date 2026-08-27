#!/usr/bin/env node
/*
 * changelog-assemble.mjs — regenerate CHANGELOG.md's index from CHANGELOG.d/.
 *
 * WHY THIS EXISTS. CHANGELOG.md reached 2,407 lines and 65 of the last 200
 * commits. That is two problems in one file: two sessions appending to it on the
 * same day conflict every time, and anyone who opens it pays for the whole
 * history to read the last week. Both go away if each entry is its own file:
 * concurrent sessions write different paths, so git has nothing to merge, and a
 * reader loads the index plus only the entries they want.
 *
 * So the prose lives in CHANGELOG.d/<YYYY-MM-DD>-<slug>.md, one file per change,
 * and CHANGELOG.md carries a GENERATED INDEX of them between two markers. The
 * prose is never duplicated into CHANGELOG.md — that is the point, and it is
 * what stops this from being the same 2,407 lines wearing a new hat.
 *
 * The generated block is deterministic (sorted by date desc, then filename), so
 * two sessions regenerating it independently produce identical bytes and cannot
 * conflict over the index either.
 *
 * Run from the repository root (C:\Claude\community-bus-maps), no placeholders:
 *     npm run changelog                 rewrite the index in place
 *     npm run changelog:check           fail if the index is out of date (CI)
 *
 * To add an entry, write the file yourself and re-run — there is no "new"
 * command, because a fragment is just a markdown file with two front-matter
 * keys. See CHANGELOG.d/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'CHANGELOG.d');
const FILE = path.join(ROOT, 'CHANGELOG.md');
const START = '<!-- changelog-index:start -->';
const END = '<!-- changelog-index:end -->';
const CHECK = process.argv.includes('--check');

/* Front matter is deliberately two keys and no parser dependency. A fragment
 * that cannot be read is a hard error rather than a skipped row: silently
 * dropping an entry from the index is exactly the failure this file is supposed
 * to make impossible, and it would look identical to "nobody wrote one". */
function readFragment(name) {
  const raw = fs.readFileSync(path.join(DIR, name), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  if (!m) throw new Error(`${name}: no front matter (expected --- date/title --- at the top)`);
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').trim();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date || '')) throw new Error(`${name}: missing or malformed 'date:'`);
  if (!fm.title) throw new Error(`${name}: missing 'title:'`);
  if (!name.startsWith(fm.date)) throw new Error(`${name}: filename does not start with its own date (${fm.date})`);
  return { name, date: fm.date, title: fm.title };
}

/* A bad fragment must stop the run, but it must also SAY SO in one line. The
 * first cut let readFragment's throw reach the top level, so a missing title
 * printed a Node stack trace with the actual message four lines up — which is
 * how a person concludes the tool is broken rather than their file. */
let fragments;
try {
  fragments = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter(n => n.endsWith('.md') && n !== 'README.md').map(readFragment)
    : [];
} catch (e) {
  console.error(`Bad changelog fragment: ${e.message}`);
  console.error('Every file in CHANGELOG.d/ needs `date: YYYY-MM-DD` and `title: "..."` front matter,');
  console.error('and its filename must start with that same date. See CHANGELOG.d/README.md.');
  process.exit(2);
}

fragments.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date)));

const body = fragments.length
  ? fragments.map(f => `- **${f.date}** — [${f.title}](CHANGELOG.d/${f.name})`).join('\n')
  : '_No entries yet._';

const block = `${START}\n\n${body}\n\n${END}`;

const current = fs.readFileSync(FILE, 'utf8');
const si = current.indexOf(START);
const ei = current.indexOf(END);
if (si < 0 || ei < 0) {
  console.error(`CHANGELOG.md is missing the ${START} / ${END} markers — cannot place the index.`);
  process.exit(2);
}
const next = current.slice(0, si) + block + current.slice(ei + END.length);

if (next === current) {
  console.log(`changelog index is up to date (${fragments.length} entries).`);
  process.exit(0);
}
if (CHECK) {
  console.error(`CHANGELOG.md's index is out of date — ${fragments.length} fragments in CHANGELOG.d/.`);
  console.error('Run this from the repository root, no placeholders:\n    npm run changelog');
  process.exit(1);
}
fs.writeFileSync(FILE, next);
console.log(`changelog index rewritten (${fragments.length} entries).`);
