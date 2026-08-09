// Asserts every public/*.html carries the canonical nav and footer blocks,
// byte-for-byte, between their `:start`/`:end` markers. Run by `npm test` so
// the 12-file chrome can't silently drift again
// (docs/P9-header-and-place-search.md, A1/A5).
//
//   node scripts/check-chrome.mjs

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_HTML, FOOTER_HTML } from './lib/site-chrome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const BLOCKS = [
  { name: 'nav', html: NAV_HTML, markers: ['  <!-- nav:start -->', '  <!-- nav:end -->'] },
  { name: 'footer', html: FOOTER_HTML, markers: ['  <!-- footer:start -->', '  <!-- footer:end -->'] },
];

let failures = 0;
const files = readdirSync(publicDir).filter((f) => f.endsWith('.html')).sort();

for (const name of files) {
  const content = readFileSync(path.join(publicDir, name), 'utf8');
  let ok = true;

  for (const block of BLOCKS) {
    const [startMarker, endMarker] = block.markers;
    const expected = `${startMarker}\n${block.html}\n${endMarker}`;
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker);
    if (start === -1 || end === -1) {
      failures++; ok = false;
      console.error(`  ✗ ${name} — missing ${block.name}:start/:end markers (run: npm run chrome:apply)`);
      continue;
    }
    const actual = content.slice(start, end + endMarker.length);
    if (actual !== expected) {
      failures++; ok = false;
      console.error(`  ✗ ${name} — ${block.name} block does not match ${block.name === 'nav' ? 'NAV_HTML' : 'FOOTER_HTML'} (run: npm run chrome:apply)`);
    }
  }

  if (ok) console.log(`  ✓ ${name}`);
}

console.log(failures ? `\n✗ ${failures} check(s) failed` : `\n✓ all ${files.length} pages match the canonical chrome`);
process.exit(failures ? 1 : 0);
