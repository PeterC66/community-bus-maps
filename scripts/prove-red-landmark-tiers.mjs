// prove-red-landmark-tiers.mjs — falsify the landmark-tier suite (OA-212).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-landmark-tiers
//
// WHY THIS EXISTS. Most of what test-landmark-tiers.mjs asserts is a REFUSAL,
// and a refusal is the hardest thing to test green: a guard that has quietly
// stopped refusing passes every "a must is kept" assertion while letting a
// customer's rename break out of the attribute it is written into. A green run
// of that suite means nothing until it has been watched go red.
//
// So each guard is broken ON PURPOSE and required to go red BY ITSELF, and the
// harness checks WHICH assertion objected rather than that something did — a
// mutation caught by the wrong assertion is reported as WRONG CAUSE, because the
// suite would be sensitive to the damage but not for the reason claimed.
//
// THE ARM THAT MATTERS MOST is "the key universe shrinks back to what is drawn".
// That is a shape this project has met before and named: a check sited where its
// subject cannot exist. A `miss` in the MAP PACK'S routes.json is applied by
// poi_select.js at selection, so the POI never reaches the SVG the drawn
// enumeration scrapes — validate a save against that set and the key is refused,
// the place cannot be turned back on, and the tier goes with it.
//
// MEASURED, and narrower than the first draft of this paragraph claimed: a
// `miss` in the CUSTOMER's own overrides does NOT do this, because the render
// that enumeration uses is built from BASE overrides and never sees the customer
// layer. Both halves were checked on a real map pack before this was written.
//
// AND THE OPPOSITE DIRECTION IS HERE TOO. "the universe admits every key"
// exists because a suite made only of refusals would pass with the whole
// key-validation switched off. Without that arm the harness would be proving
// that the guard can be broken, not that it is doing anything.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `scripts/` and `src/` are copied
// into a scratch tree and the copy is damaged. Nothing is moved aside and
// restored, because a harness that restores in a `finally` still leaves the
// repository broken if it is killed between the two.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-landmarks-'));
  for (const dir of ['scripts', 'src']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  // public/app only, and copied rather than linked because one mutation damages
  // the editor page. The rest of public/ is 3.5 MB of images that nothing here
  // reads, and this scratch tree is built once per mutation.
  cpSync(path.join(ROOT, 'public', 'app'), path.join(tmp, 'public', 'app'), { recursive: true });
  // Linked, not copied: large, and nothing here damages them. NEVER point
  // damage() at a path under one of these — a junction leads back into the real
  // checkout, so an edit "to the copy" would vandalise the repository this
  // harness exists to protect. Anything needing mutation must be under
  // scripts/ or src/, which are real copies.
  //
  // `data` is linked for a second reason: the key-universe half of the suite
  // needs a real map pack, and without one it SKIPS — which would report three
  // of these mutations as SURVIVED for a reason that is not the guard's fault.
  // The suite copies the pack again before touching it, so this stays read-only.
  for (const dir of ['node_modules', 'engine', 'data']) {
    const from = path.join(ROOT, dir); const to = path.join(tmp, dir);
    // A link to something that is not there is WORSE than no link: src/db/index.js
    // calls mkdirSync(DATA_DIR) at import, and mkdir through a dangling link
    // throws ENOENT — which crashed the whole suite on CI instead of letting it
    // skip. Absent, the suite creates a real empty data dir and skips cleanly.
    if (!existsSync(from)) continue;
    try { symlinkSync(from, to, 'junction'); } catch { cpSync(from, to, { recursive: true }); }
  }
  writeFileSync(path.join(tmp, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));
  return tmp;
}

/** Edit one file in the scratch copy. Fails loudly if the anchor has moved — a
 *  mutation whose anchor no longer matches is a STALE harness, not a pass. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

function runSuite(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-landmark-tiers.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// Anchored on the suite's own two-space indent: assertion names carry em dashes
// and the engine writes to stderr, so an unanchored '✗' would misread this.
const failedLines = (out) => out.split('\n').filter((l) => /^ {2}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

/* IS THERE A MAP PACK ON THIS MACHINE?
 *
 * `data/` is gitignored, so a fresh CI checkout has none — by construction, not
 * by accident. The key-universe half of the suite needs a real pack (it copies
 * one and adds a `miss` to its routes.json), so on CI that half SKIPS and the
 * one mutation only it can catch is not exercised.
 *
 * The first version of this harness made the control demand that both halves
 * ran, which made CI permanently red for a reason that is nobody's fault and is
 * not a defect in any guard. It now asks the machine what it has and SAYS which
 * arms it could not run — a skip that announces itself, rather than a silent cap
 * that lets a reduced run read as a full one. The laptop runs everything. */
const packRoot = path.join(ROOT, 'data', 'maps');
const HAVE_PACK = existsSync(packRoot) && readdirSync(packRoot).some((id) => (
  existsSync(path.join(packRoot, id, 'data', 'osm.json'))
  && existsSync(path.join(packRoot, id, 'data', 'gen_internal.js'))));

let problems = 0;
let skipped = 0;
const results = [];
const say = (row) => {
  results.push(row);
  console.log(`${row[0].padEnd(14)} ${row[1]}`);
  if (row[2]) console.log(`               ${row[2]}`);
};

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) {
    problems++;
    // Print the TAIL, not only the ✗ lines: a control that fails by CRASHING has
    // no ✗ lines at all, and "did not pass" with an empty detail is exactly the
    // report that sent somebody hunting the wrong thing once already.
    const detail = failedLines(r.out).map((l) => l.trim()).join(' | ')
      || r.out.trim().split('\n').slice(-6).map((l) => l.trim()).join(' / ');
    say(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guards', detail]);
  } else {
    const half = r.out.includes('so this half is not exercised here');
    if (half && HAVE_PACK) {
      // A pack is here and the suite skipped anyway — that IS a defect.
      problems++;
      say(['✗ CONTROL', 'a map pack is present but the key-universe half still skipped', packRoot]);
    } else if (half) {
      say(['ok CONTROL', 'an intact copy passes; no map pack on this machine, so the key-universe half is not exercised', 'expected on CI, where data/ is gitignored']);
    } else say(['ok CONTROL', 'an intact copy passes, both halves exercised', '']);
  }
  rmSync(tmp, { recursive: true, force: true });
}

const SUBSET = 'src/maps/safeSubset.js';
const ENGINE = 'src/maps/engine.js';
const EDITOR = 'public/app/editor.js';
const CHOOSER = 'public/app/landmarks.js';

const MUTATIONS = [
  {
    what: 'the tier vocabulary stops being checked',
    why: 'anything at all reaches poi_select.js, where an unknown tier is silently treated as `may` — the customer is told their answer was saved and no sheet changes',
    edits: [[SUBSET, "if (!POI_TIERS.has(tier))", 'if (false)']],
    expect: 'a tier outside must/may/miss is dropped',
  },
  {
    what: 'the key check stops refusing unknown POIs',
    why: 'a key naming nothing is written into the file, and the build reports it on stderr where nobody is standing',
    edits: [[SUBSET, "if (!poiSet.has(k)) { rejected.push(`internal.poiTiers[\"${k}\"] (unknown POI)`); continue; }", '']],
    expect: 'an unknown POI is dropped',
  },
  {
    what: 'the rename accepts any character',
    why: 'a rename REPLACES the identity and is written into data-key="…" by an escaper that covers &, < and > but NOT the double quote',
    edits: [[SUBSET, 'if (badPoiName(t))', 'if (false)']],
    expect: 'a double quote is refused',
  },
  {
    what: 'badPoiName stops looking for control characters',
    why: 'the quote arm above would still pass — this is the half of that guard nothing else can see',
    edits: [[SUBSET, 'if (c < 0x20 || c === 0x7f) return true;', 'if (false) return true;']],
    expect: 'a control character is refused',
  },
  {
    what: 'the rename length cap is removed',
    why: 'a 5,000-character name reaches the placer, which cannot seat it and drops it — the customer\'s answer fails in silence',
    edits: [[SUBSET, 'if (t.length > MAX_POI_NAME)', 'if (false)']],
    expect: '61 characters is refused',
  },
  {
    what: 'a blank rename discards the whole entry again',
    why: 'the bug the suite found on the day it was written: the tier thrown away because the optional box beside it held a space',
    edits: [[SUBSET, "} else if (o.as !== undefined && o.as !== null && typeof o.as !== 'string') {", '} else if (o.as !== undefined && o.as !== null) {']],
    expect: 'an all-space rename leaves the tier standing',
  },
  {
    what: 'an explicit `may` is dropped again',
    why: 'THE OA-215 FAULT, restored. The middle answer stops reaching disk, so nothing can tell a row somebody deliberately left alone from a row nobody has reached — and a 145-row list becomes one you cannot work through in more than one sitting',
    edits: [[SUBSET, '    tiers[k] = as ? { tier, as } : { tier };',
             "    if (tier === 'may' && !as) continue;\n    tiers[k] = as ? { tier, as } : { tier };"]],
    expect: 'an explicit may is recorded, so a reader can see what they have answered',
  },
  {
    what: 'the editor stops carrying the landmark answer',
    why: 'THE OTHER ONE THAT WOULD SHIP. sanitizeOverrides() rebuilds the overrides object from scratch, so a page that does not re-emit a key DELETES it — one save from the editor would throw away every must / may / miss and every rename a town had given us, silently, with a success message',
    edits: [[EDITOR, '  if (s.poiTiers && Object.keys(s.poiTiers).length) internal.poiTiers = s.poiTiers;\n', '']],
    expect: 'a landmark answer survives a save from the EDITOR page',
  },
  {
    what: 'the expert-only sweep forgets poiTiers is not the only internal key',
    why: 'the sweep is what stops rotationDeg, viewport and stop moves riding in beside a tier; widening it by one key must not have widened it to everything',
    edits: [[SUBSET, "if (k !== 'pois' && k !== 'poiTiers') rejected.push(`internal.${k} (expert-only)`);", '']],
    expect: 'an expert key beside poiTiers is still refused',
  },
  {
    what: 'the key universe shrinks back to what is DRAWN',
    why: 'THE ONE THAT WOULD SHIP. A miss in the MAP PACK\'s routes.json is applied at selection, so the POI never reaches the SVG the drawn enumeration scrapes — validate against that set and the key is refused, the place cannot be turned back on, and the tier is dropped on the next save. Measured: a miss in the CUSTOMER layer does not do this, because that render uses base overrides',
    edits: [[ENGINE, '  for (const p of enumerateCandidatesFromDir(dataDir, tiersOverlay)) keys.add(p.key);\n', '']],
    expect: 'so the editable universe contains it, and a save naming it is not rejected',
    needsPack: true,
  },
  // ---- OA-220. The chooser's own pure pieces, and the join to the icon set.
  {
    what: 'the road-name declutter stops testing for overlap',
    why: 'the failure nobody can see. A label wrongly PRINTED is visible; a label wrongly dropped looks exactly like a road with no name, and two printed on top of each other look like one road with a smudged name. Nothing about the drawing tells you which happened',
    edits: [[CHOOSER, 'if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;', 'if (false) continue;']],
    expect: 'two labels that would sit on top of each other become one',
  },
  {
    what: 'the road-name cap stops being honoured',
    why: 'without this arm the declutter could return its whole input and still pass every assertion above it, because those all use two or three candidates',
    edits: [[CHOOSER, 'if (out.length >= max) break;', 'if (false) break;']],
    expect: 'the cap is honoured however many would fit',
  },
  {
    what: 'the tally goes back to saying "left as they are"',
    why: 'the exact wording Peter objected to on 2026-09-01. It named two populations at once — an answered "show if there is room" and a row nobody had reached — and made a claim about the past that the page has no way to check',
    edits: [[CHOOSER, '<span class="lm-key may">${TIER_LABEL.may}</span>', '<span class="lm-key may">left as they are</span>']],
    expect: 'the tally no longer claims anything was "left as they are"',
  },
  {
    what: 'the tap test stops caring how far the pointer moved',
    why: 'a drag that happens to finish over a mark then selects it, so panning the map past a POI opens that POI — which is how the map-click handler behaves when it is wrong in the OTHER direction',
    edits: [[CHOOSER, 'return Math.abs(x1 - x0) <= slop && Math.abs(y1 - y0) <= slop;', 'return true;']],
    expect: 'a pointer that was dragged across the map is not',
  },
  {
    what: 'one category loses its pictogram',
    why: 'the JOIN between poi_select.js and icons.js, which nothing else holds together. A thirteenth category added to classify() would show a blank where a symbol belongs, on every map that has one, and no other gate would notice',
    edits: [[ENGINE, "for (const cat of Object.keys(GRID_COL)) out[cat] = icon(cat, 0, 0, 10, 'charcoal', 'grid');",
      "for (const cat of Object.keys(GRID_COL)) { if (cat === 'school') continue; out[cat] = icon(cat, 0, 0, 10, 'charcoal', 'grid'); }"]],
    expect: 'and every one of them has a pictogram the chooser can show',
  },
  {
    what: 'the universe admits every key instead',
    why: 'the other direction. Without this arm a suite made of refusals would pass with key validation switched off entirely — a check whose subject cannot exist',
    edits: [[ENGINE, '  for (const p of enumeratePoisFromDir(dataDir)) keys.add(p.key);\n  return [...keys];', '  for (const p of enumeratePoisFromDir(dataDir)) keys.add(p.key);\n  return [...keys];'],
      [SUBSET, 'const poiSet = new Set(poiKeys);', 'const poiSet = { has: () => true };']],
    expect: 'an unknown POI is dropped',
  },
];

for (const m of MUTATIONS) {
  if (m.needsPack && !HAVE_PACK) {
    skipped++;
    say(['-- skipped', m.what, 'needs a real map pack under data/maps, and this machine has none']);
    continue;
  }
  const tmp = scratch();
  let row;
  try {
    for (const [file, find, to] of m.edits) damage(tmp, file, find, to);
    const r = runSuite(tmp);
    if (r.code === 0) {
      problems++;
      row = ['✗ SURVIVED', m.what, 'the suite stayed GREEN — nothing is testing this'];
    } else if (caughtBy(r.out, m.expect)) {
      row = ['ok caught', m.what, `by "${m.expect}"`];
    } else {
      problems++;
      row = ['✗ WRONG CAUSE', m.what, `expected "${m.expect}", got: ${failedLines(r.out).map((l) => l.trim()).join(' | ') || '(no ✗ line)'}`];
    }
  } catch (e) {
    problems++; row = ['✗ STALE', m.what, e.message];
  }
  rmSync(tmp, { recursive: true, force: true });
  say(row);
}

console.log('');
if (problems) {
  console.error(`✗ ${problems} of ${results.length} arm(s) did not behave — the landmark-tier suite is not proving what it claims`);
  process.exit(1);
}
// Say what was NOT run. A reduced run that reports like a full one is the shape
// this project keeps meeting: coverage silently narrowed, and a green line that
// reads as though it covered everything.
const ran = results.length - 1 - skipped;
console.log(`✓ ${ran} mutation(s) each caught by the assertion named for them, and the control passes`
  + (skipped ? `\n  ${skipped} arm(s) NOT run here — no map pack under data/maps. Run this on the laptop to exercise them.` : ''));
