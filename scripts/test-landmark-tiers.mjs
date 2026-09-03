// The landmark chooser's three load-bearing pieces (OA-212, OA-215).
//
//   node scripts/test-landmark-tiers.mjs
//
// 1. THE SAFE SUBSET accepts `internal.poiTiers` and only in the shape the
//    engine can read. It is the security boundary, and one of its rules is not
//    obvious: a renamed POI's name becomes the key the generator writes into
//    `data-key="…"` in editor mode, and the engine's esc() escapes &, < and >
//    but NOT a double quote. So the quote is refused here rather than trusted
//    to an escaper that does not cover it.
//
// 2. THE KEY UNIVERSE is the union of what is drawn and what could be drawn.
//    This is the one that would fail silently, and it is narrower than it first
//    looks — MEASURED, because the first version of this comment was wrong.
//
//    enumeratePoisFromDir() renders with the map's BASE overrides, not the
//    customer's, so a `miss` a customer sets in their own overrides is still
//    drawn by that render and still enumerated. That half is safe.
//
//    A `miss` that arrives in the MAP PACK'S OWN routes.json is a different
//    matter: poi_select.js drops it at selection, so it never reaches the SVG,
//    never gets a data-key, and is absent from the drawn set entirely. Validate
//    a save against that set and the key is refused, the customer cannot turn
//    the place back on, and any tier they set on it is dropped on the next save.
//    That is not hypothetical: it is the state every map is in the moment a
//    local's answer is exported back into its source data, which is half of
//    what this whole feature is for.
//
// 3. THE EDITOR MUST NOT EAT THE ANSWER (OA-215). The editor page and the
//    chooser write the same overrides object through the same endpoint, and
//    sanitizeOverrides() rebuilds it from scratch — so whatever a page does not
//    re-emit is deleted. The chooser was careful about the editor's colours from
//    its first day and nothing had taught the editor about the chooser's tiers,
//    so one save from the editor threw away every answer a town had given.
//
// 4. THE CHOOSER CAN DRAW WHAT THE SELECTOR CAN PRODUCE (OA-220). The chooser
//    shows the sheet's own twelve pictograms, keyed on the category poi_select.js
//    assigns. That is a JOIN between two files with nothing holding it together:
//    add a thirteenth category to classify() and the chooser silently shows a
//    blank where a symbol should be, on every map that has one, and no gate
//    anywhere notices. So the categories are read back out of classify()'s own
//    source and every one is required to have a glyph.
//
// 5. THE THREE PURE PIECES OF THE CHOOSER (OA-220) — the road-name declutter,
//    the tap test and the tally's wording — lifted and run the same way the
//    editor's round-trip is. The declutter is the one that most needs it: a
//    label it wrongly drops looks exactly like a road that has no name, so
//    nothing about the drawing can tell you it is wrong.
//
// Falsified by scripts/prove-red-landmark-tiers.mjs — break any of them and watch.

import path from 'node:path';
import { existsSync } from 'node:fs';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// Every nested read below uses `?.`, and that is not tidiness. When a guard
// breaks the way prove-red-landmark-tiers.mjs breaks it, the entry is DROPPED —
// so `overrides.internal` is undefined and a plain dereference throws. A suite
// that throws exits non-zero without printing which assertion objected, and the
// harness then reports WRONG CAUSE for a mutation it actually caught. A test
// must fail by failing, not by crashing.


const { sanitizeOverrides } = await import('../src/maps/safeSubset.js');

const palette = { 9: '#66CCEE' };
const poiKeys = ['shop:Aldi', 'school:The Downley', 'community:The Hive'];
const allow = { palette, poiKeys };
const san = (o) => sanitizeOverrides(o, allow);
const tiers = (t) => san({ internal: { poiTiers: t } });

console.log('\npoiTiers — the three answers');
{
  eq('must is kept', tiers({ 'shop:Aldi': { tier: 'must' } }).overrides.internal?.poiTiers,
    { 'shop:Aldi': { tier: 'must' } });
  eq('miss is kept', tiers({ 'shop:Aldi': { tier: 'miss' } }).overrides.internal?.poiTiers,
    { 'shop:Aldi': { tier: 'miss' } });
  // AN EXPLICIT `may` IS RECORDED (OA-215), and this assertion used to say the
  // opposite. Recording it changes nothing about the SHEET — poi_select.js
  // applies it and the drawing is byte-identical — but it is the whole of what
  // the reader said, and dropping it left the chooser unable to tell "I have
  // looked at this and it is right as it is" from "I have not reached this row".
  // An untouched map still serialises to {}, because the page sends nothing for
  // a row nobody has answered; that property is asserted further down.
  eq('an explicit may is recorded, so a reader can see what they have answered',
    tiers({ 'shop:Aldi': { tier: 'may' } }).overrides.internal?.poiTiers, { 'shop:Aldi': { tier: 'may' } });
  eq('may WITH a rename is kept', tiers({ 'shop:Aldi': { tier: 'may', as: 'Aldi Desborough' } }).overrides.internal?.poiTiers,
    { 'shop:Aldi': { tier: 'may', as: 'Aldi Desborough' } });
}

console.log('\npoiTiers — what it refuses');
{
  const unknown = tiers({ 'shop:Nowhere': { tier: 'miss' } });
  eq('an unknown POI is dropped', unknown.overrides, {});
  check('and says so', unknown.rejected.some((r) => r.includes('unknown POI')), unknown.rejected.join('; '));

  const bogus = tiers({ 'shop:Aldi': { tier: 'maybe' } });
  eq('a tier outside must/may/miss is dropped', bogus.overrides, {});
  check('and names the tier', bogus.rejected.some((r) => r.includes('maybe')), bogus.rejected.join('; '));

  eq('a non-object value is dropped', tiers({ 'shop:Aldi': 'must' }).overrides, {});
}

console.log('\npoiTiers — a rename is a name, not a payload');
{
  // The double quote is the one that matters: a rename REPLACES the POI's
  // identity, and that identity is written into data-key="…" by an escaper that
  // does not escape quotes.
  const q = tiers({ 'shop:Aldi': { tier: 'must', as: 'Al"di' } });
  eq('a double quote is refused', q.overrides, {});
  check('and says it is the character', q.rejected.some((r) => r.includes('cannot carry')), q.rejected.join('; '));
  eq('an angle bracket is refused', tiers({ 'shop:Aldi': { tier: 'must', as: '<b>Aldi' } }).overrides, {});
  eq('a control character is refused', tiers({ 'shop:Aldi': { tier: 'must', as: `Al${String.fromCharCode(9)}di` } }).overrides, {});

  // Real British place names carry apostrophes, ampersands, hyphens, slashes and
  // colons — High Wycombe alone has "St Michael's Catholic", "Clip 'n Climb",
  // "40:40 Link" and "Chepping View Primary / Shelbourne County First Schools".
  // An allowlist would have refused most of those.
  const real = "St Michael's & Co - 40:40 / A";
  eq('ordinary place-name punctuation survives',
    tiers({ 'community:The Hive': { tier: 'must', as: real } }).overrides.internal?.poiTiers['community:The Hive'].as, real);
  eq('a rename is trimmed', tiers({ 'shop:Aldi': { tier: 'must', as: '  Aldi  ' } }).overrides.internal?.poiTiers['shop:Aldi'].as, 'Aldi');
  // Blank means absent, NOT invalid — the tier must survive a rename box that
  // holds only a space. Rejecting the entry would discard the real answer.
  eq('an all-space rename leaves the tier standing', tiers({ 'shop:Aldi': { tier: 'must', as: '   ' } }).overrides.internal?.poiTiers,
    { 'shop:Aldi': { tier: 'must' } });
  eq('and a blank rename on a `may` leaves that answer standing too',
    tiers({ 'shop:Aldi': { tier: 'may', as: '  ' } }).overrides.internal?.poiTiers, { 'shop:Aldi': { tier: 'may' } });
  eq('a non-string rename is refused', tiers({ 'shop:Aldi': { tier: 'must', as: 42 } }).overrides, {});

  // Both sides of the length boundary, because a cap tested on one side only is
  // a cap nobody has seen bite.
  eq('60 characters is accepted', tiers({ 'shop:Aldi': { tier: 'must', as: 'x'.repeat(60) } }).overrides.internal?.poiTiers['shop:Aldi'].as, 'x'.repeat(60));
  eq('61 characters is refused', tiers({ 'shop:Aldi': { tier: 'must', as: 'x'.repeat(61) } }).overrides, {});
}

console.log('\npoiTiers alongside everything else');
{
  const both = san({ routeColors: { 9: '#ff0000' }, internal: { poiTiers: { 'shop:Aldi': { tier: 'miss' } } } });
  eq('route colours are untouched', both.overrides.routeColors, { 9: '#ff0000' });
  eq('and the tier rides with them', both.overrides.internal?.poiTiers, { 'shop:Aldi': { tier: 'miss' } });

  // The older render-time hide keeps working — nothing already saved may break.
  const legacy = san({ internal: { pois: { 'shop:Aldi': { hide: true } }, poiTiers: { 'school:The Downley': { tier: 'must' } } } });
  eq('a saved hide is still accepted', legacy.overrides.internal?.pois, { 'shop:Aldi': { hide: true } });
  eq('beside a tier', legacy.overrides.internal?.poiTiers, { 'school:The Downley': { tier: 'must' } });

  // ... and the expert-only sweep still catches everything else under internal.
  const expert = san({ internal: { rotationDeg: 5, poiTiers: { 'shop:Aldi': { tier: 'must' } } } });
  check('an expert key beside poiTiers is still refused',
    expert.rejected.some((r) => r.includes('internal.rotationDeg')), expert.rejected.join('; '));
  eq('and does not reach the output', expert.overrides.internal?.rotationDeg, undefined);

  eq('an untouched map still serialises to {}', san({ internal: { poiTiers: {} } }).overrides, {});
}

// ---------------------------------------------------------------------------
// The editor page's own round-trip (OA-215). There is no browser here, so the
// two functions that do it are lifted out of the source by brace-matching and
// run. Crude, and it is the only thing in this repository that can go red when
// somebody rewrites them — the alternative was a grep for a filename, which
// proves the string is present and nothing about what it does.
// ---------------------------------------------------------------------------
console.log('\nthe editor carries a landmark answer through untouched');
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  let editorSrc = '';
  try {
    editorSrc = readFileSync(fileURLToPath(new URL('../public/app/editor.js', import.meta.url)), 'utf8');
  } catch (e) { editorSrc = ''; }

  /* Slice one top-level function out, from its declaration to its closing brace.
   * Returns null rather than throwing: a suite that CRASHES prints no assertion
   * name, and a harness reading it then reports the wrong cause. */
  const lift = (name) => {
    const i = editorSrc.indexOf(`function ${name}(`);
    if (i < 0) return null;
    let depth = 0;
    for (let k = editorSrc.indexOf('{', i); k >= 0 && k < editorSrc.length; k++) {
      if (editorSrc[k] === '{') depth++;
      else if (editorSrc[k] === '}' && --depth === 0) return editorSrc.slice(i, k + 1);
    }
    return null;
  };

  let round = null;
  let why = editorSrc ? '' : 'public/app/editor.js could not be read';
  if (editorSrc) {
    try {
      const a = lift('stagedFromOverrides');
      const b = lift('overridesFromStaged');
      if (!a || !b) why = 'could not find both functions in public/app/editor.js';
      else round = new Function(`${a}\n${b}\nreturn (ov) => overridesFromStaged(stagedFromOverrides(ov));`)();
    } catch (e) { why = e.message; }
  }
  check('the editor round-trip can be read out of its own source', !!round, why);

  if (round) {
    const answer = { 'shop:Aldi': { tier: 'miss' }, 'community:The Hive': { tier: 'must', as: 'The Hive' } };
    eq('a landmark answer survives a save from the EDITOR page',
      round({ internal: { poiTiers: answer } }).internal?.poiTiers, answer);
    eq('and a map whose only override is that answer does not come back empty',
      Object.keys(round({ internal: { poiTiers: answer } })), ['internal']);
    eq('a hide and an answer survive together',
      round({ internal: { pois: { 'shop:Aldi': { hide: true } }, poiTiers: answer } }).internal,
      { pois: { 'shop:Aldi': { hide: true } }, poiTiers: answer });

    // The controls. Without them "carried" would be satisfied by a function that
    // returned its input unchanged, which is not what this page does at all.
    eq('route colours still round-trip', round({ routeColors: { 9: '#ff0000' } }).routeColors, { 9: '#ff0000' });
    eq('a render-time hide still round-trips',
      round({ internal: { pois: { 'shop:Aldi': { hide: true } } } }).internal?.pois, { 'shop:Aldi': { hide: true } });
    eq('an empty overrides object still comes back empty', round({}), {});
    eq('and an expert key the editor does not own is still not re-emitted',
      round({ internal: { rotationDeg: 5 } }).internal, undefined);
  }
}

// ---------------------------------------------------------------------------
// The key universe. Needs a real map pack, so it is skipped where there is none
// — and SAYS it skipped, rather than passing quietly.
// ---------------------------------------------------------------------------
console.log('\nthe editable key universe — a POI missed AT SOURCE must stay choosable');
{
  const { enumerateCandidatesFromDir, enumeratePoisFromDir, editablePoiKeysFromDir } = await import('../src/maps/engine.js');
  const { mapDataDir } = await import('../src/maps/store.js');
  const { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } = await import('node:fs');
  const os = (await import('node:os')).default;

  let src = null;
  for (let id = 1; id <= 12; id++) {
    const d = mapDataDir(id);
    if (existsSync(path.join(d, 'osm.json')) && existsSync(path.join(d, 'gen_internal.js'))) { src = d; break; }
  }

  if (!src) {
    console.log('  — no map pack under data/maps, so this half is not exercised here (CI has none; the laptop does)');
  } else {
    // The control first: with nothing classified anywhere, the selector and the
    // drawn sheet must name exactly the same places. Without this, "candidates
    // is a superset" could be satisfied by a selector that simply returns more.
    const drawn0 = enumeratePoisFromDir(src).map((p) => p.key).sort();
    const cand0 = enumerateCandidatesFromDir(src).map((p) => p.key).sort();
    check('with nothing classified, the selector and the drawn sheet agree exactly',
      JSON.stringify(drawn0) === JSON.stringify(cand0), `drawn ${drawn0.length}, candidates ${cand0.length}`);
    check('there is something to test with', cand0.length > 0, `${cand0.length} candidates`);

    // Now the case that bites: the tier is in the MAP PACK, the way it arrives
    // when a town's answer has been exported back into its source data. Done on
    // a COPY — running a generator over the real pack to read a number is how
    // you overwrite the folder you were only trying to measure.
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-keyuniverse-'));
    try {
      cpSync(src, tmp, { recursive: true });
      const rjPath = path.join(tmp, 'routes.json');
      const rj = JSON.parse(readFileSync(rjPath, 'utf8'));
      const victim = cand0[0];
      rj.poi = { ...(rj.poi || {}), tiers: { ...((rj.poi || {}).tiers || {}), [victim]: 'miss' } };
      writeFileSync(rjPath, JSON.stringify(rj, null, 2));

      const drawn = enumeratePoisFromDir(tmp).map((p) => p.key);
      const cand = enumerateCandidatesFromDir(tmp);
      const keys = editablePoiKeysFromDir(tmp);

      check('a POI missed at source really does leave the drawn sheet',
        !drawn.includes(victim), `${victim} is still drawn — the premise of this test is gone`);
      check('but the selector still offers it', cand.some((p) => p.key === victim), victim);
      check('and reports its tier as miss', (cand.find((p) => p.key === victim) || {}).tier === 'miss',
        (cand.find((p) => p.key === victim) || {}).tier);
      check('so the editable universe contains it, and a save naming it is not rejected',
        keys.includes(victim), victim);
      check('and the universe is still a superset of what IS drawn',
        drawn.every((k) => keys.includes(k)), 'a drawn key went missing');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Every category the selector can produce has a pictogram (OA-220).
// ---------------------------------------------------------------------------
console.log('\nthe chooser can draw every category the selector can produce');
{
  const { readFileSync: rf } = await import('node:fs');
  const { fileURLToPath: fu } = await import('node:url');
  const { poiGlyphs } = await import('../src/maps/engine.js');
  const glyphs = poiGlyphs();
  check('the glyph set loads out of the engine at all', !!glyphs && Object.keys(glyphs).length > 0,
    'poiGlyphs() returned ' + JSON.stringify(glyphs));

  // The categories classify() can return, read out of its own source rather
  // than typed here — a hand-copied list is the third copy of a rule this
  // system has already been bitten by twice.
  let cats = [];
  try {
    const sel = rf(fu(new URL('../engine/poi_select.js', import.meta.url)), 'utf8');
    const i = sel.indexOf('function classify(');
    const j = sel.indexOf('\nfunction ', i + 1);
    cats = [...sel.slice(i, j > 0 ? j : undefined).matchAll(/return\s*\[\s*'([a-z_]+)'/g)].map((m) => m[1]);
  } catch { cats = []; }
  check('classify() names a plausible number of categories', cats.length >= 10, 'found ' + cats.length);
  eq('and every one of them has a pictogram the chooser can show',
    [...new Set(cats)].filter((c) => !(glyphs || {})[c]), []);
}

// ---------------------------------------------------------------------------
// 5. The chooser's three pure pieces, lifted out of the browser file (OA-220).
// ---------------------------------------------------------------------------
console.log('\nthe chooser: the declutter, the tap test and the tally');
{
  const { readFileSync: rf } = await import('node:fs');
  const { fileURLToPath: fu } = await import('node:url');
  let lmSrc = '';
  try { lmSrc = rf(fu(new URL('../public/app/landmarks.js', import.meta.url)), 'utf8'); } catch { lmSrc = ''; }

  // Same brace-matching slice the editor round-trip above uses, and the same
  // reason: a grep for a name proves the string is present and nothing else.
  const liftFn = (name) => {
    const i = lmSrc.indexOf(`function ${name}(`);
    if (i < 0) return null;
    let depth = 0;
    for (let k = lmSrc.indexOf('{', i); k >= 0 && k < lmSrc.length; k++) {
      if (lmSrc[k] === '{') depth++;
      else if (lmSrc[k] === '}' && --depth === 0) return lmSrc.slice(i, k + 1);
    }
    return null;
  };
  /* TIER_LABEL is lifted too, and that is the whole point of the tally
   * assertions: they must be about the words the PAGE uses, not about a copy
   * of them made here that would stay green while the page said anything. */
  const liftConst = (name) => {
    const i = lmSrc.indexOf(`const ${name} = `);
    if (i < 0) return null;
    const j = lmSrc.indexOf(';', i);
    return j < 0 ? null : lmSrc.slice(i, j + 1);
  };

  let api = null;
  let why = lmSrc ? '' : 'public/app/landmarks.js could not be read';
  if (lmSrc) {
    try {
      const parts = ['pickRoadLabels', 'isTap', 'tallyText'].map(liftFn);
      const tl = liftConst('TIER_LABEL');
      if (parts.some((p) => !p) || !tl) why = 'could not find all three functions and TIER_LABEL in public/app/landmarks.js';
      else api = new Function(`${tl}\n${parts.join('\n')}\nreturn { pickRoadLabels, isTap, tallyText, TIER_LABEL };`)();
    } catch (e) { why = e.message; }
  }
  check('the three can be read out of the chooser own source', !!api, why);

  if (api) {
    const { pickRoadLabels: pick, isTap, tallyText, TIER_LABEL: TL } = api;
    const at = (nm, x, y) => ({ n: nm, x, y });
    const names = (r) => r.map((c) => c.n);
    const W = 800; const H = 600; const PX = 11;

    // The declutter. It is handed candidates already in stage pixels, longest
    // road first, and its whole job is to say which of them get drawn.
    eq('it keeps the order it was handed, which is longest road first',
      names(pick([at('A', 10, 10), at('B', 10, 400)], W, H, 10, PX)), ['A', 'B']);
    eq('a label whose anchor is off the stage is dropped',
      names(pick([at('A', -5, 10), at('B', 10, 10)], W, H, 10, PX)), ['B']);
    eq('the same road name is never printed twice in one view',
      names(pick([at('Mill Lane', 10, 10), at('Mill Lane', 400, 400)], W, H, 10, PX)), ['Mill Lane']);
    eq('two labels that would sit on top of each other become one',
      names(pick([at('London Road', 100, 100), at('Cock Lane', 104, 102)], W, H, 10, PX)), ['London Road']);
    eq('and the same two, far apart, are both kept',
      names(pick([at('London Road', 100, 100), at('Cock Lane', 500, 400)], W, H, 10, PX)),
      ['London Road', 'Cock Lane']);
    // Without this one the whole declutter could return its input and stay green
    // on everything above.
    eq('the cap is honoured however many would fit',
      pick([...Array(9)].map((_, i) => at('R' + i, 40 + i * 80, 300)), W, H, 3, PX).length, 3);

    // The tap test. Not a boundary fixture by accident: 4 is the slop itself and
    // it is asserted deliberately, to pin the comparison as inclusive.
    eq('a pointer that barely moved is a tap', isTap(100, 100, 102, 101, 4), true);
    eq('a pointer that was dragged across the map is not', isTap(100, 100, 140, 120, 4), false);
    eq('exactly the slop still counts as a tap', isTap(100, 100, 104, 96, 4), true);
    eq('one pixel past it does not', isTap(100, 100, 105, 100, 4), false);

    // The tally. Peter, 2026-09-01, on the live page: "by left as they are do we
    // mean Show if room". He did — and the figure was ALSO counting every row
    // nobody had reached, so it named two populations at once.
    const t = tallyText(171, 1, 22, 25);
    const plain = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    check('the tally no longer claims anything was "left as they are"',
      !/left as they are/i.test(plain), plain);
    check('the middle figure uses the legend own words', plain.includes(TL.may), plain);
    check('...and all three tiers are named the way the legend names them',
      plain.includes(TL.must) && plain.includes(TL.miss), plain);
    check('the middle figure is total minus must minus miss', plain.includes(TL.may + ' 148'), plain);
    check('the progress is a separate sentence, and it counts answers',
      /25 of 171 answered/.test(plain) && /146 not looked at yet/.test(plain), plain);
  }
}

// ---------------------------------------------------------------------------
// 6. THE ROW ITSELF: its pictogram, its name, and whether this page can be seen
//    to say anything at all (Peter, 2026-09-03).
//
//    Four faults, and three of them are JOINS between two files that nothing
//    held together:
//
//    a) A <use> of a <symbol> with no x/y/width/height takes the defaults
//       x=0, y=0, width=100%, height=100%. Put that inside an <svg> whose own
//       viewBox starts at -10 -10 and the symbol's viewport lands at 0,0 to
//       20,20 in a space that shows -10 to +10: you see its top-left QUARTER,
//       in the bottom-right of the box. The map layer writes the placement out
//       and was always right; the list layer did not and was wrong everywhere.
//
//    b) classify() returns `t.name || ''` for pharmacies and GP surgeries — the
//       sheet never prints those names, so an unnamed one costs it nothing. The
//       chooser then drew a row with no title at all, and no reader could tell
//       which chemist they were being asked about. Three towns have one today.
//
//    c) The row's "symbol only — its name is never printed" repeated the group
//       heading's own tagline on every row of a group where every row is like
//       that, in a column already starved of width.
//
//    d) AND THE ONE THAT MATTERS MOST: `.notice` in app.css is display:none and
//       `.notice.show` is what reveals it. Every other page writes the `show`
//       class. This one did not, at five sites, so nothing this page ever tried
//       to say could be seen — the save result, the server-unreachable error,
//       the export confirmation, the *Must show* soft cap, and showWarnings(),
//       whose entire purpose is to tell a reader which of their choices the
//       generator could not seat.
// ---------------------------------------------------------------------------
console.log('\nthe chooser: the pictogram, the name, and whether the page can speak');
{
  const { readFileSync: rf } = await import('node:fs');
  const { fileURLToPath: fu } = await import('node:url');
  const read = (rel) => { try { return rf(fu(new URL(rel, import.meta.url)), 'utf8'); } catch { return ''; } };
  const lmSrc = read('../public/app/landmarks.js');
  const cssSrc = read('../public/app/app.css');

  const liftFn = (name) => {
    const i = lmSrc.indexOf(`function ${name}(`);
    if (i < 0) return null;
    let depth = 0;
    for (let k = lmSrc.indexOf('{', i); k >= 0 && k < lmSrc.length; k++) {
      if (lmSrc[k] === '{') depth++;
      else if (lmSrc[k] === '}' && --depth === 0) return lmSrc.slice(i, k + 1);
    }
    return null;
  };
  const liftConst = (name) => {
    const i = lmSrc.indexOf(`const ${name} = `);
    if (i < 0) return null;
    const j = lmSrc.indexOf(';', i);
    return j < 0 ? null : lmSrc.slice(i, j + 1);
  };

  // --- a) the pictogram is PLACED, not merely referenced --------------------
  let g = null; let gWhy = lmSrc ? '' : 'public/app/landmarks.js could not be read';
  if (lmSrc) {
    const f = liftFn('glyphSpan');
    if (!f) gWhy = 'glyphSpan() not found in the chooser';
    else {
      try {
        g = new Function(`const GLYPHS = { shop: '<circle/>' };\nconst esc = (s) => String(s);\n${f}\nreturn glyphSpan;`)();
      } catch (e) { gWhy = e.message; }
    }
  }
  check('glyphSpan() can be read out of the chooser own source', !!g, gWhy);
  if (g) {
    const html = g('shop');
    const box = (html.match(/viewBox="([^"]*)"/) || [])[1] || '';
    // THE RULE, stated as the rule rather than as the string: the box the row
    // draws into must START AT THE ORIGIN, because a <use> with no x/y puts the
    // symbol's viewport at 0,0 of whatever user space it lands in.
    const origin = box.trim().split(/ +/).slice(0, 2).join(' ');
    check('the row draws its pictogram into a box that starts at the origin', origin === '0 0',
      `viewBox="${box}" — a symbol <use> with no x/y sits at 0,0, so a box starting anywhere else shows only part of the glyph`);
    check('...and the <use> is the plain form the sprite is built for', html.includes('<use href="#lmg-shop"/>'), html);
  }
  // The sprite still declares the symbol centred on its own middle, which is
  // what makes the origin rule above necessary rather than arbitrary.
  const sprite = liftFn('installGlyphSprite') || '';
  check('the sprite still centres each symbol on its own middle',
    sprite.includes('viewBox="-10 -10 20 20"'), sprite.slice(0, 200));
  // And the OTHER correct form, on the map, stays correct: it writes the
  // placement out longhand, which is exactly why the map never had this fault.
  check('the map layer still places its own <use> explicitly',
    lmSrc.includes('x="-10" y="-10" width="20" height="20"'),
    'drawPoints() must keep writing the placement, or the marks move instead');

  // --- b) and c) the words on a row ----------------------------------------
  let api = null; let why = lmSrc ? '' : 'public/app/landmarks.js could not be read';
  if (lmSrc) {
    const fns = ['displayName', 'statusWords', 'showEl'].map(liftFn);
    const consts = ['CAT_LABEL', 'CAT_ONE', 'catLabel', 'nameless'].map(liftConst);
    if (fns.some((f) => !f) || consts.some((c) => !c)) {
      why = 'could not find displayName/statusWords/showEl and their constants in public/app/landmarks.js';
    } else {
      try {
        api = new Function(`${consts.join('\n')}\n${fns.join('\n')}\n`
          + 'return { displayName, statusWords, showEl, CAT_ONE };')();
      } catch (e) { why = e.message; }
    }
  }
  check('the row helpers can be read out of the chooser own source', !!api, why);

  if (api) {
    const { displayName, statusWords, CAT_ONE, showEl } = api;
    const P = (o) => ({ key: 'x', cat: 'pharmacy', name: '', printsName: false, ...o });

    eq('a place with a name is called by it', displayName(P({ name: 'Boots' }), null), 'Boots');
    eq('a rename beats the name the data has', displayName(P({ name: 'Boots' }), { as: 'The chemist' }), 'The chemist');
    const blank = displayName(P({ name: '' }), null);
    check('a place with NO name still gets something a reader can act on', blank.trim().length > 0, JSON.stringify(blank));
    check('...and what it gets names the kind of place it is, not the engine key',
      blank.includes('pharmacy') && !blank.includes('pharmacy:'), blank);
    eq('a rename rescues a nameless place completely', displayName(P({ name: '' }), { as: 'Aqsa' }), 'Aqsa');
    eq('whitespace is not a name', displayName(P({ name: '   ' }), null), blank);

    // The same JOIN as check 4 above, one level down: a thirteenth category
    // added to classify() would fall back to a lower-cased plural heading.
    let cats = [];
    try {
      const sel = read('../engine/poi_select.js');
      const i = sel.indexOf('function classify(');
      const j = sel.indexOf('\nfunction ', i + 1);
      cats = [...sel.slice(i, j > 0 ? j : undefined).matchAll(/return\s*\[\s*'([a-z_]+)'/g)].map((m) => m[1]);
    } catch { cats = []; }
    check('classify() still names a plausible number of categories', cats.length >= 10, 'found ' + cats.length);
    eq('and every one of them has a singular for the nameless row',
      [...new Set(cats)].filter((c) => !CAT_ONE[c]), []);

    // c) the sub-line, and the group heading that had already said it
    eq('in a group where nothing prints its name, the row says nothing extra',
      statusWords(P({ name: 'Boots', printsName: false }), false), '');
    check('in a MIXED group it says which half this row is in',
      statusWords(P({ name: 'Boots', printsName: false }), true).includes('not printed'),
      statusWords(P({ name: 'Boots', printsName: false }), true));
    eq('and a row that DOES print its name says nothing either way',
      statusWords(P({ name: 'Asda', cat: 'shop', printsName: true }), true), '');
    for (const mixed of [false, true]) {
      check(`a nameless row explains itself whether or not the group is mixed (mixed=${mixed})`,
        /no name/i.test(statusWords(P({ name: '' }), mixed)), statusWords(P({ name: '' }), mixed));
    }

    // --- d) the page can be SEEN to speak ----------------------------------
    // THE JOIN. Each half was fine on its own and the pair was not.
    const noticeRule = (cssSrc.match(/\.notice \{[^}]*\}/) || [''])[0];
    check('app.css really does keep .notice hidden until something says otherwise',
      /display:\s*none/.test(noticeRule), noticeRule || 'no .notice rule found in public/app/app.css');
    // The trailing class terminates: without it `.notice.shown` satisfies a
    // search for `.notice.show`, and the arm that renames the rule survived the
    // first run of this very check.
    check('...and .notice.show is the thing that says otherwise',
      /\.notice\.show(?![\w-])/.test(cssSrc),
      'no .notice.show rule — the class this page adds would do nothing');

    const el = { hidden: true, cls: new Set() };
    el.classList = { toggle(c, on) { if (on) el.cls.add(c); else el.cls.delete(c); } };
    showEl(el, true);
    check('showEl() adds the one class the stylesheet is looking for', el.cls.has('show'), [...el.cls].join(','));
    eq('...and clears the hidden attribute with it', el.hidden, false);
    showEl(el, false);
    check('and takes both away again', !el.cls.has('show') && el.hidden === true,
      `${[...el.cls].join(',')} hidden=${el.hidden}`);

    // No second way in. This is exactly what broke: two sites reached for the
    // `hidden` attribute and three for style.display, and a class rule beats
    // both. showEl() is the only door now, so the JOIN above covers the page.
    check('nothing in the chooser reveals a notice by the hidden attribute any more',
      !/\.hidden = (true|false)/.test(lmSrc),
      'a bare `hidden` toggle cannot beat `.notice { display: none }` — go through showEl()');
    check('...nor by clearing an inline display on a notice',
      !/\$\('notice'\)[^;]*\.style\.display/.test(lmSrc) && !lmSrc.includes('nEl.style.display'),
      'style.display = "" hands the question straight back to the stylesheet that says none');
  }
}

if (failures) {
  console.error(`\n✗ ${failures} landmark-tier check(s) failed`);
  process.exit(1);
}
console.log('\n✓ all landmark-tier checks passed');
