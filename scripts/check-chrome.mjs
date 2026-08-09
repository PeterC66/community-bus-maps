// Asserts every public/*.html carries the canonical nav block, byte-for-byte,
// between `<!-- nav:start -->` / `<!-- nav:end -->`. Run by `npm test` so the
// 12-file nav can't silently drift again (docs/P9-header-and-place-search.md, A1).
//
//   node scripts/check-chrome.mjs

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_HTML } from './lib/site-chrome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const NAV_START = '  <!-- nav:start -->';
const NAV_END = '  <!-- nav:end -->';
const expected = `${NAV_START}\n${NAV_HTML}\n${NAV_END}`;

let failures = 0;
const files = readdirSync(publicDir).filter((f) => f.endsWith('.html')).sort();

for (const name of files) {
  const content = readFileSync(path.join(publicDir, name), 'utf8');
  const start = content.indexOf(NAV_START);
  const end = content.indexOf(NAV_END);
  if (start === -1 || end === -1) {
    failures++;
    console.error(`  ✗ ${name} — missing nav:start/nav:end markers (run: npm run chrome:apply)`);
    continue;
  }
  const actual = content.slice(start, end + NAV_END.length);
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} — nav block does not match NAV_HTML (run: npm run chrome:apply)`);
  }
}

console.log(failures ? `\n✗ ${failures} page(s) have a stale/missing nav block` : `\n✓ all ${files.length} pages match the canonical nav`);
process.exit(failures ? 1 : 0);
