// Rewrite the nav and footer blocks in every public/*.html from the single
// source of truth in scripts/lib/site-chrome.mjs. Idempotent: safe to run any
// time you change NAV_HTML/FOOTER_HTML, or to add markers to a page that
// doesn't have them yet.
//
//   npm run chrome:apply

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_HTML, FOOTER_HTML } from './lib/site-chrome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

// Matches either an already-marked block, or the raw pre-marker element —
// so a page never previously touched still converts on the first run.
const BLOCKS = [
  {
    name: 'nav', html: NAV_HTML,
    markedRe: /  <!-- nav:start -->[\s\S]*?  <!-- nav:end -->/,
    rawRe: /  <header class="site-header">[\s\S]*?<\/header>/,
    markers: ['  <!-- nav:start -->', '  <!-- nav:end -->'],
  },
  {
    name: 'footer', html: FOOTER_HTML,
    markedRe: /  <!-- footer:start -->[\s\S]*?  <!-- footer:end -->/,
    rawRe: /  <footer class="site-footer">[\s\S]*?<\/footer>/,
    markers: ['  <!-- footer:start -->', '  <!-- footer:end -->'],
  },
];

let changed = 0;
let unchanged = 0;
const files = readdirSync(publicDir).filter((f) => f.endsWith('.html'));

for (const name of files) {
  const file = path.join(publicDir, name);
  let content = readFileSync(file, 'utf8');
  const original = content;

  for (const block of BLOCKS) {
    const [start, end] = block.markers;
    const replacement = `${start}\n${block.html}\n${end}`;
    if (block.markedRe.test(content)) {
      content = content.replace(block.markedRe, replacement);
    } else if (block.rawRe.test(content)) {
      content = content.replace(block.rawRe, replacement);
    } else {
      console.error(`✗ ${name}: no ${block.name} marker and no recognisable raw block — skipped`);
    }
  }

  if (content === original) {
    unchanged++;
  } else {
    writeFileSync(file, content, 'utf8');
    changed++;
    console.log(`✓ ${name}: chrome updated`);
  }
}

console.log(`\n${changed} file(s) updated, ${unchanged} already matched.`);
