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

if (failures) {
  console.error(`\n✗ ${failures} landmark-tier check(s) failed`);
  process.exit(1);
}
console.log('\n✓ all landmark-tier checks passed');
