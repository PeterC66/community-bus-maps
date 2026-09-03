/*
 * src/changelog.js — the changelog's fragments, read and ordered.
 *
 * WHY IT LIVES IN src/ AND NOT IN scripts/. Two things read the changelog: the
 * `npm run changelog` CLI, which builds a local page, and the admin `/changelog`
 * route, which lists the entries on every request. Only one of those two ships
 * inside the deployed image as a matter of contract, so the shared rules belong
 * on the `src/` side and the script imports them — the same direction
 * `backup.mjs` was moved to under OA-232 when it was reaching a database
 * through `src/db/index.js` and applying migrations as a side effect.
 *
 * WHY THE ADMIN PAGE GENERATES RATHER THAN READING A FILE. `CHANGELOG.md` is
 * generated and gitignored since 2026-09-03. The committed index was touched by
 * 60 of the last 60 commits and conflicted between concurrent sessions every
 * time, so it is a derived file that no longer lives in git and is not in the
 * image. Reading it at runtime would have degraded to "(not found)" the moment
 * this shipped. Generating instead makes the page always current, which the
 * committed file never was — it was only ever as fresh as the last person who
 * remembered to run the generator.
 */
import fs from 'node:fs';
import path from 'node:path';

export const START = '<!-- changelog-index:start -->';
export const END = '<!-- changelog-index:end -->';

/* Front matter is deliberately two keys and no parser dependency. A fragment
 * that cannot be read is a hard error rather than a skipped row: silently
 * dropping an entry is exactly the failure the one-file-per-entry arrangement
 * exists to make impossible, and it would look identical to "nobody wrote one". */
export function parseFragment(name, raw) {
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

/** Newest first, then by filename — the one place the order is decided. */
export const byDateThenName = (a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date));

/**
 * Refuse two fragment names that differ only in case.
 *
 * A PURE FUNCTION OVER NAMES, and that is the point rather than a style choice.
 * The deploy target is Linux and this laptop is not, so two such fragments are
 * two files here and ONE there: an entry would vanish on the server and nowhere
 * else, which is the worst place for a difference to appear first. But a test
 * cannot BUILD that pair on a case-insensitive filesystem — writing the second
 * name overwrites the first, `readdir` returns one file, and the check sits
 * there unfalsifiable, which is a shape this project has named. Taking a list
 * of names instead makes it exercisable everywhere, including here.
 */
export function assertDistinct(names) {
  const seen = new Map();
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) throw new Error(`${n}: differs only in case from ${seen.get(key)}, which is one file on Linux`);
    seen.set(key, n);
  }
  return names;
}

/** Every entry a CHANGELOG.d directory describes, validated and sorted. */
export function entriesFromDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const names = assertDistinct(fs.readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'README.md'));
  return names
    .map(n => parseFragment(n, fs.readFileSync(path.join(dir, n), 'utf8')))
    .sort(byDateThenName);
}

/** The index block, markers included, from a set of entries. */
export function renderIndex(entries) {
  const sorted = [...entries].sort(byDateThenName);
  const body = sorted.length
    ? sorted.map(f => `- **${f.date}** — [${f.title}](CHANGELOG.d/${f.name})`).join('\n')
    : '_No entries yet._';
  return { block: `${START}\n\n${body}\n\n${END}`, count: sorted.length };
}

/**
 * Put a block between the markers of a page's text.
 *
 * Throws rather than returning a sentinel: a head template with no markers is
 * not a file this tool can improve by guessing where the index belongs.
 */
export function spliceIndex(current, block) {
  const si = current.indexOf(START);
  const ei = current.indexOf(END);
  if (si < 0 || ei < 0) throw new Error(`missing the ${START} / ${END} markers — cannot place the index`);
  return current.slice(0, si) + block + current.slice(ei + END.length);
}
