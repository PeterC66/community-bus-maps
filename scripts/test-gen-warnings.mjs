// What a generator says on the way to a SUCCESSFUL render, and who gets to read
// it (OA-216).
//
//   node scripts/test-gen-warnings.mjs        (or: npm run test:gen-warnings)
//
// THE FINDING. `gen_internal.js` ends by comparing the POIs a customer marked
// *Must show* against the labels the placer actually seated, and writes the
// difference to stderr, naming each one. Its own comment calls that warning
// "the only thing standing between a classified POI and an answer that failed
// without saying so". Two siblings sit beside it: a `poi.tiers` key that matched
// no POI and did nothing, and a rename that collided so two places share one
// override key and one placer anchor.
//
// All three are written with `process.stderr.write` and NOT with `refuse()` —
// deliberately, because they are not refusals to draw and the sheet is still
// worth having — so the run exits 0. And `renderMap.js` read stderr only when
// the exit status was NON-zero. On the success path, which is the path all three
// take, the whole stream was discarded unread; `generateSvg()` returned
// `log: stdout`, which none of them use.
//
// So an editor could mark twenty places *Must show*, save, and be told "Saved as
// version 2.3. The map has been redrawn with your choices" with three of those
// choices silently not applied.
//
// THE CASE THAT MATTERS IS THE ZERO EXIT, so that is what the fixture is built
// around: a stub generator that writes a sheet, prints a real `poi.tiers` line
// on stderr, and EXITS 0. A test that used a failing generator would prove
// nothing at all — the failure path always read stderr, and always did.
//
// THE STUB IS THE POINT, NOT A SHORTCUT. What changed here is the portal's
// READING of the stream, and a stub isolates exactly that: it removes the map
// pack, the placer and the question of whether today's data happens to produce
// an unplaceable landmark, none of which this change touches. The generator's
// own lines are quoted VERBATIM from `gen_internal.js` so the selection is
// tested against the real wording rather than against wording invented here.
//
// The controls carry more weight than the assertions. A version of this that
// piped the whole stream to the customer would pass every "the warning arrives"
// test while putting `buildMeta:` and `placeIndex:` in front of somebody who
// cannot act on either — so a clean run must be SILENT, and an internal-only
// run must reach the log and not the editor.
//
// Runs against a throwaway dir; no network, no portal data, no real generator.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { readGenWarnings, mergeGenWarnings } from '../src/render/genWarnings.js';
import { generateSvg } from '../src/render/renderMap.js';

let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

/* Quoted verbatim from make-bus-leaflet/assets/gen_internal.js, so this suite is
 * measuring the wording the engine really emits. If the engine rewords one of
 * these, this file should go red and be updated deliberately — that is the point
 * of copying the text rather than matching a loose pattern. */
const MUST_LINE =
  'poi.tiers: 3 of 20 "must" POIs were still not placed on this sheet — "Tesco Extra", "The Priory", "Norris Museum".'
  + ' mustPlace relaxes the hard grid; it cannot invent space. Give it an internal.pois pos/move override,'
  + ' shorten it with a tiers "as", or take something else off the sheet.';
const UNKNOWN_LINE =
  'poi.tiers: 1 key matched no POI on this sheet and did nothing — "shop:Tescos".'
  + ' The key is "<category>:<name>" AFTER poi.tidy and poi.canon have run and after de-duplication;'
  + ' poi_worksheet.js prints the keys this town actually has.';
const COLLIDE_LINE =
  'poi.tiers: a rename has collided — "The Co-op" now names more than one POI,'
  + ' so they share an override key and a placer anchor.'
  + ' Give one of them a different "as", or classify one of them "miss".';

/* THE FOURTH LINE IS BUILT BY THE ENGINE RATHER THAN QUOTED FROM IT (OA-250
 * item 2), and the departure from the three above is deliberate.
 *
 * What this line says is not fixed prose: `culledAfterTiersNote()` composes it
 * from the number of culled keys, how many were a `must`, and whether each fell
 * outside the frame or inside the blank coreBox — and the arm that reads it in
 * genWarnings.js has to be right for EVERY shape that function can produce, not
 * for one transcription of one of them. Calling the real module is the only way
 * to ask that question; a copied string would have proved the fix against text
 * this file wrote for itself.
 *
 * The property the verbatim convention exists to protect is kept as its own
 * assertion below instead: a reword that removes the phrase the reader keys on
 * goes red, by name, rather than quietly taking the rewording with it. */
const enginePoiSelect = createRequire(import.meta.url)('../engine/poi_select.js');
const CULLED_LINE = enginePoiSelect.culledAfterTiersNote([
  { key: 'library:Library', why: 'core', must: true },
  { key: 'museum:Museum', why: 'core', must: true },
  { key: 'shop:Morrisons', why: 'frame', must: false },
]);
const CULLED_LINE_NO_MUST = enginePoiSelect.culledAfterTiersNote([
  { key: 'shop:Morrisons', why: 'frame', must: false },
]);
/* The other half of a real stream, and none of it is the customer's business:
 * these are about the engine's own layout, and an editor can act on not one. */
const INTERNAL_LINES = [
  'labels: 4 could not be placed; 12 index rows drawn.',
  'placeIndex: the index block is FULL at 36 rows.',
  'buildMeta: could not write build-meta.json — EACCES: permission denied',
  'fit: 2 core stops more than 1.4 km outside the frame were dropped.',
];

console.log('\nSelecting the lines an editor can act on:\n');
{
  const { editor, all } = readGenWarnings([MUST_LINE, ...INTERNAL_LINES].join('\n'), 'gen_internal.js');
  if (all.length !== 5) fail(`the whole stream is not preserved — ${all.length} lines, expected 5`);
  else ok('every line is kept in `all`, for the server log');
  if (editor.length !== 1) fail(`${editor.length} lines reached the editor, expected 1 — the internal lines are not addressed to a customer`);
  else ok('exactly one line reached the editor');
  if (!editor[0] || !/could not be fitted/.test(editor[0].heading)) fail(`the heading is "${editor[0] && editor[0].heading}" — it does not say the places could not be fitted`);
  else ok('the heading says what happened to the customer\'s answer');
  // THE NAMES ARE THE WHOLE VALUE. The soft cap this replaces was a guess; the
  // generator knows exactly which three places did not fit, and a message that
  // dropped them would be no better than the guess.
  if (!editor[0] || !/Tesco Extra/.test(editor[0].detail) || !/Norris Museum/.test(editor[0].detail)) fail('the detail does not name the landmarks that did not fit');
  else ok('the detail names each landmark that did not fit');
  if (editor[0] && /^poi\.tiers:/.test(editor[0].detail)) fail('the engine namespace `poi.tiers:` is still on the front of a customer-facing line');
  else ok('the engine namespace is stripped');
}

console.log('\nThe four poi.tiers lines get four different headings:\n');
{
  const h = (line) => (readGenWarnings(line).editor[0] || {}).heading;
  const must = h(MUST_LINE); const unknown = h(UNKNOWN_LINE); const collide = h(COLLIDE_LINE);
  const culled = h(CULLED_LINE); const culledNoMust = h(CULLED_LINE_NO_MUST);
  if (!/could not be fitted/.test(must || '')) fail(`the "must" line reads "${must}"`);
  else ok('a Must show that could not be seated');
  if (!/named nothing/.test(unknown || '')) fail(`the unknown-key line reads "${unknown}"`);
  else ok('a key that matched nothing');
  if (!/share one/.test(collide || '')) fail(`the collision line reads "${collide}"`);
  else ok('a rename that collided');
  if (!/off the edge of the map/.test(culled || '')) fail(`the culled-by-the-frame line reads "${culled}"`);
  else ok('a place the sheet\'s frame or coreBox excluded');

  /* THE TWO ARMS THE FIX IS ACTUALLY ABOUT, and each was a different wrong
   * sentence before it (OA-250 item 2, measured 2026-09-22 on the engine text
   * these constants are built from).
   *
   * A culled line naming a `must` contains the string `"must"`, so the
   * placement arm matched it and the customer was told the placer could not fit
   * the place — the wrong cause, and so the wrong remedy: a pos/move override
   * or a shorter `as` cannot bring back a place the frame excludes.
   *
   * A culled line naming none matched no arm at all and fell to the default,
   * "named nothing on this map and did nothing", which is false in each of its
   * three clauses: the key named a real place, the answer was applied, and the
   * same sentence says so. */
  if (culled === must) fail('a culled place is headed as a placement failure — the placer had room; the frame excluded it');
  else ok('a culled place is NOT read as a Must show the placer could not seat');
  if (culledNoMust === unknown) fail('a culled place with no "must" among its keys is headed "named nothing and did nothing", which is false — it named a real place and the answer was applied');
  else ok('and one with no "must" in it does not fall through to "named nothing"');
  if (culledNoMust !== culled) fail(`the same fault reads two ways — "${culled}" and "${culledNoMust}"`);
  else ok('both shapes of the culled line read the same to a customer');

  /* WHAT THE VERBATIM CONVENTION ABOVE PROTECTS, kept as an assertion because
   * these two constants are built by the engine rather than copied from it.
   * `fell off this sheet` is the phrase the reader keys on, and the `"must"`
   * substring is the whole reason its arm has to come FIRST. An engine reword
   * that drops either goes red here, by name. */
  if (!/^poi\.tiers:/.test(CULLED_LINE) || !/fell off this sheet/.test(CULLED_LINE)) fail('the engine no longer emits "poi.tiers: … fell off this sheet" — the reader in genWarnings.js keys on that phrase');
  else ok('the engine still emits the phrase the reader keys on');
  if (!/"must"/.test(CULLED_LINE)) fail('the culled line no longer contains \'"must"\' — the ordering comment in genWarnings.js is now describing a hazard that has gone, and should be revisited');
  else ok('and still contains \'"must"\', which is why its arm must come first');

  // A SINGLE PREFIX COVERS FOUR DIFFERENT FAULTS, so a heading chosen by the
  // prefix alone would tell a reader "part of your answer did nothing" about a
  // placement failure. This is the assertion that keeps them apart.
  const four = [must, unknown, collide, culled];
  if (new Set(four).size !== 4) fail(`two of the four share a heading — a reader would be told the wrong thing about one of them: ${four.join(' | ')}`);
  else ok('all four are distinct');
}

console.log('\nThe controls — silence where silence is right:\n');
{
  const clean = readGenWarnings('', 'gen_internal.js');
  if (clean.editor.length || clean.all.length) fail('an empty stream produced something');
  else ok('a clean run says nothing at all');

  const internalOnly = readGenWarnings(INTERNAL_LINES.join('\n'), 'gen_internal.js');
  if (internalOnly.editor.length) fail(`${internalOnly.editor.length} internal line(s) reached the editor — a customer cannot act on any of these`);
  else ok('an internal-only run reaches the editor with nothing');
  if (internalOnly.all.length !== 4) fail('the internal lines did not reach the log either — they are what an operator wants when a sheet comes out wrong');
  else ok('and reaches the log with all four');
}

console.log('\nOne answer, however many sheets drew it:\n');
{
  // A map draws up to four sheets and each runs its own generator, so the same
  // unplaceable landmark is reported by more than one of them. The customer
  // asked one question.
  const runs = [readGenWarnings(MUST_LINE, 'gen_internal.js'), readGenWarnings(MUST_LINE, 'gen_internal_schematic.js')];
  const merged = mergeGenWarnings(runs);
  if (merged.length !== 1) fail(`${merged.length} entries after merging two sheets reporting the same thing`);
  else ok('the same finding from two sheets collapses to one');
  if (merged[0] && 'generator' in merged[0]) fail('the generator filename is still on a customer-facing entry');
  else ok('which sheet it was is not the customer\'s question, and is not shown');

  const two = mergeGenWarnings([readGenWarnings([MUST_LINE, UNKNOWN_LINE].join('\n'))]);
  if (two.length !== 2) fail(`two different findings collapsed to ${two.length}`);
  else ok('two different findings stay two');
}

console.log('\nEnd to end, through generateSvg, on a run that EXITS 0:\n');
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cbm-genwarn-'));
  const stub = (stderrLine) => `
    const fs = require('fs');
    fs.writeFileSync(process.env.LEAFLET_DIR + '/internal.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    ${stderrLine ? `process.stderr.write(${JSON.stringify(stderrLine + '\n')});` : ''}
    process.exit(0);
  `;
  mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(dir, 'gen_internal.js'), stub(MUST_LINE));
  // stamp:false — the pilot band and the badge fix are not what this is about,
  // and the stub's SVG has neither a badge nor a footer to apply them to.
  const loud = generateSvg({ dataDir: dir, generator: 'gen_internal.js', stamp: false });
  if (!loud.warnings || !loud.warnings.editor.length) fail('generateSvg returned no warnings for a zero-exit run that wrote one — this is the whole finding');
  else ok('a zero-exit generator\'s stderr is read');
  if (!readFileSync(loud.svgPath, 'utf8').includes('<svg')) fail('the sheet was not written — the fixture is not exercising a successful render');
  else ok('and the render still succeeded, which is the case that was silent');

  writeFileSync(path.join(dir, 'gen_internal.js'), stub(null));
  const quiet = generateSvg({ dataDir: dir, generator: 'gen_internal.js', stamp: false });
  if (quiet.warnings.editor.length || quiet.warnings.all.length) fail('a generator that said nothing produced a warning');
  else ok('a generator that says nothing produces nothing');
}

console.log('');
if (failures) {
  console.error(`x ${failures} check(s) failed — a customer's answer can still fail without saying so.`);
  process.exit(1);
}
console.log('+ what a successful generator says now reaches the editor, in their words, and only the lines they can act on.');
