// Rewrite the nav block in every public/*.html from the single source of
// truth in scripts/lib/site-chrome.mjs. Idempotent: safe to run any time you
// change NAV_HTML, or to add the markers to a page that doesn't have them yet.
//
//   npm run chrome:apply

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_HTML } from './lib/site-chrome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const NAV_START = '  <!-- nav:start -->';
const NAV_END = '  <!-- nav:end -->';
const navBlock = `${NAV_START}\n${NAV_HTML}\n${NAV_END}`;

// Matches either an already-marked block, or the raw <header class="site-header">…</header>
// block from before markers existed — so a page never previously touched still converts.
const MARKED_RE = /  <!-- nav:start -->[\s\S]*?  <!-- nav:end -->/;
const RAW_HEADER_RE = /  <header class="site-header">[\s\S]*?<\/header>/;

let changed = 0;
let unchanged = 0;
const files = readdirSync(publicDir).filter((f) => f.endsWith('.html'));

for (const name of files) {
  const file = path.join(publicDir, name);
  const original = readFileSync(file, 'utf8');

  let updated;
  if (MARKED_RE.test(original)) {
    updated = original.replace(MARKED_RE, navBlock);
  } else if (RAW_HEADER_RE.test(original)) {
    updated = original.replace(RAW_HEADER_RE, navBlock);
  } else {
    console.error(`✗ ${name}: no nav marker and no recognisable <header class="site-header"> block — skipped`);
    continue;
  }

  if (updated === original) {
    unchanged++;
  } else {
    writeFileSync(file, updated, 'utf8');
    changed++;
    console.log(`✓ ${name}: nav updated`);
  }
}

console.log(`\n${changed} file(s) updated, ${unchanged} already matched.`);
