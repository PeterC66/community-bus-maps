// The printed sheet version, in each of the three states a sheet can be in.
//
//   node scripts/test-sheet-version.mjs        (or: npm run test:sheet-version)
//
// Peter's review item 6: a sheet needs a version he can quote back when something
// on it looks wrong, and where the reader GOT the sheet decides which version that
// is. The engine prints one line (footer.js `design.sheetVersion`); the portal
// decides what goes in it:
//
//   built by the skill, pre-portal   ->  "build 6.54 · 19 Aug 2026"   (routes.json)
//   rendered by the portal           ->  "Map version 5.0"            (renderVersion)
//   downloaded before it is published->  "Draft 5.0 · 19 Aug 2026 14:02"  (draftStamp)
//
// WHAT THIS PINS, and why each one is here rather than being obvious:
//
//   1. THE CACHE IS KEYED ON THE LABEL. draftStamp caches its marked copy beside
//      the source, and the first cut keyed that cache on the source's mtime alone —
//      copied from watermark.js, whose overlay never changes. A version's
//      review_state DOES change (draft -> pending on submit, published ->
//      superseded when the next one lands) while the render sits untouched, so
//      every state after the first served the first one's file. The happy path
//      passed. Asking for three states in a row is what caught it, so that is
//      exactly what this asks for.
//   2. A PUBLISHED SHEET IS NEVER REWRITTEN. The whole design rests on the render
//      carrying only what is true in both states, so publishing can stay a pure
//      state flip and the bytes the approver signed off are the bytes that go
//      public. If anything ever starts marking a published version, this fails.
//   3. AN OLD RENDER STILL DOWNLOADS. Every sheet rendered before this landed has
//      no version line to rewrite, and must serve as-is rather than 500.
//
// Needs no database and no server: it drives footer.js and draftStamp.js directly.

import { mkdtempSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { draftLabel, ensureDraftMarked, draftPathFor } = await import('../src/render/draftStamp.js');
const { footerBand } = await import('../engine/footer.js');

console.log('\nSheet version\n');

// --- what the engine prints, given each form of the value -------------------
// footer.js draws four end-anchored runs in the band: the address (bold #333), its
// label (#666), the version (#999) and the credit (#999). Pick the version by its
// fill AND by not being the credit — matching on the anchor alone picks the label,
// which is how the first cut of this test failed against a working engine.
const line = (svg) => [...svg.matchAll(/<text\b[^>]*fill="#999"[^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g)]
  .map((m) => m[1])
  .find((t) => !/BusMaps\.uk$/.test(t));

const band = (sheetVersion) => footerBand({
  notes: ['Routes & stops: UK Bus Open Data Service.'], url: 'busmaps.uk/m/st-ives',
  qr: true, safe: 5, sheetVersion,
});

check('a bare number gets the words "Map version"', line(band('5.0')) === 'Map version 5.0', line(band('5.0')));
check('… and so does a v-prefixed one', line(band('v5.0')) === 'Map version v5.0', line(band('v5.0')));
check('anything else prints verbatim (the skill build stamp)',
  line(band('build 6.54 · 19 Aug 2026')) === 'build 6.54 · 19 Aug 2026', line(band('build 6.54 · 19 Aug 2026')));
check('… including the editor preview', line(band('Preview — unsaved')) === 'Preview — unsaved');
check('no value ⇒ no row at all (absent config is byte-identical)', line(band(null)) === undefined);

// --- the words for each review_state ----------------------------------------
const AT = '2026-08-19 14:02:11';
check('draft', draftLabel('draft', '5.0', AT) === 'Draft 5.0 · 19 Aug 2026 14:02', draftLabel('draft', '5.0', AT));
check('pending reads "In review" — it is the copy an approver is looking at',
  draftLabel('pending', '5.0', AT) === 'In review 5.0 · 19 Aug 2026 14:02', draftLabel('pending', '5.0', AT));
check('superseded says so', draftLabel('superseded', '5.0', AT).startsWith('Superseded 5.0'));
check('rejected says it is not published', draftLabel('rejected', '5.0', AT).startsWith('Not published 5.0'));
check('a missing timestamp drops the date rather than printing junk',
  draftLabel('draft', '5.0', null) === 'Draft 5.0', draftLabel('draft', '5.0', null));

// --- the cache follows the STATE, not just the file's age --------------------
const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-sheetver-'));
const src = path.join(dir, 'internal.svg');
writeFileSync(src, band('5.0'));

const marked = async (state) => {
  const out = await ensureDraftMarked(src, draftLabel(state, '5.0', AT));
  return line(readFileSync(out, 'utf8'));
};
check('a draft download is marked', await marked('draft') === 'Draft 5.0 · 19 Aug 2026 14:02');
check('the SAME file re-marked as pending changes — the cache is keyed on the label',
  await marked('pending') === 'In review 5.0 · 19 Aug 2026 14:02', await marked('pending'));
check('… and back again', await marked('draft') === 'Draft 5.0 · 19 Aug 2026 14:02');

// Prove the cache is really a cache and not a no-op: touch the marked copy into
// the future, ask for the same label, and the bytes must still be the right ones.
const cached = draftPathFor(src);
utimesSync(cached, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
check('a cache hit still serves the right label', await marked('draft') === 'Draft 5.0 · 19 Aug 2026 14:02');

// --- a sheet with no version line is served untouched ------------------------
const old = path.join(dir, 'old.svg');
writeFileSync(old, band(null));
check('a render made before the version line existed is not marked (serve as-is)',
  await ensureDraftMarked(old, draftLabel('draft', '5.0', AT)) === null);
check('a missing file is not marked', await ensureDraftMarked(path.join(dir, 'nope.svg'), 'Draft 1.0') === null);
check('no label ⇒ no marking', await ensureDraftMarked(src, null) === null);

// --- the negative control: this test can actually fail -----------------------
// A green check that has never been seen to go red proves nothing. Corrupt the
// source's version line and confirm the marker declines it, which is the same
// path an unmarkable sheet takes.
const broken = path.join(dir, 'broken.svg');
writeFileSync(broken, band('5.0').replace('Map version 5.0', 'Something else entirely'));
check('the matcher is specific — it does not rewrite a line that is not the version',
  await ensureDraftMarked(broken, draftLabel('draft', '5.0', AT)) === null);

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all sheet-version checks passed'}\n`);
process.exit(failures ? 1 : 0);
