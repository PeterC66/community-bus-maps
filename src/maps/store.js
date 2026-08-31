// Object store for maps. Everything here lives UNDER DATA_DIR, which is
// git-ignored — per-map data, overrides and renders never enter the repo.
//
//   <DATA_DIR>/maps/<id>/
//     data/                 the map's generators + *.json inputs (its S4/S5 payload)
//     overrides.json        canonical saved safe-subset edits (source of truth)
//     renders/v<maj>.<min>/  internal.svg internal.jpg external.svg external.jpg meta.json
//
// The generator reads its inputs from data/ (LEAFLET_DIR) and writes the working
// SVG back into data/; a completed render is then copied into renders/v<ver>/.

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db/index.js';

export const MAPS_DIR = path.join(DATA_DIR, 'maps');

export function mapDir(id) {
  return path.join(MAPS_DIR, String(id));
}
export function mapDataDir(id) {
  return path.join(mapDir(id), 'data');
}
export function overridesPath(id) {
  return path.join(mapDir(id), 'overrides.json');
}
// Expert framing baked into a map's payload (river-hide, frozen viewport). It is
// NOT a customer edit: it lives inside data/ and is merged UNDER the customer's
// safe-subset overrides at render time. Area maps have none (absent ⇒ empty ⇒
// byte-identical baseline). See src/maps/engine.js and engine/place/README.md.
/**
 * THE ENGINE'S OWN VERDICT ON THE BUILD (OA-046).
 *
 * The bus skill writes `build-warnings.txt` beside every S4 and S5 run: a count
 * line, then the warnings, with BLOCKING meaning the engine refused to draw
 * something or drew a label that names nothing. 161 of them existed on the map
 * tree and ZERO reached anything downstream — the file is git-ignored on that
 * side, and the string "build-warnings" appeared nowhere in this repository at
 * all. So the verdict was computed, was correct, was acted on once by whoever
 * watched the rollout terminal, and was then thrown away.
 *
 * It is carried with a delivery for the one thing this side cannot do: the
 * portal renders a NEW version with STRICT_GUARDS=1 and gets its own answer,
 * but for the version being IMPORTED it has none, and re-deriving one would
 * give today's engine's opinion of an older pack rather than the verdict the
 * sheet actually shipped under.
 */
export const BUILD_WARNINGS = 'build-warnings.txt';

/**
 * Parse a `build-warnings.txt` into something a screen can show.
 *
 * Tolerant by design: an unreadable or unrecognised file reports `null` rather
 * than throwing or guessing a zero. A FALSE ZERO is the one answer that would
 * be worse than no answer at all — it would tell an approver the engine was
 * happy with a sheet it had refused to draw.
 *
 * @returns {{total:number, blocking:number, blockingLines:string[]}|null}
 */
export function readBuildWarnings(dir) {
  let raw;
  try { raw = readFileSync(path.join(dir, BUILD_WARNINGS), 'utf8'); } catch { return null; }
  const head = /^\s*(\d+)\s+warnings?,\s*(\d+)\s+blocking\./m.exec(raw);
  if (!head) return null;
  const blockingLines = [];
  let inBlocking = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^---\s*BLOCKING/i.test(line)) { inBlocking = true; continue; }
    if (/^---/.test(line)) { inBlocking = false; continue; }
    if (inBlocking && line.trim()) blockingLines.push(line.trim());
  }
  return { total: Number(head[1]), blocking: Number(head[2]), blockingLines };
}

export const BASE_OVERRIDES = 'base-overrides.json';
// P7 — the expert's hand-placed junction pins for the tube-map diagram, written by
// the pin editor into the map's data folder and read by the diagram engine on every
// render. Expert work, not a customer edit and not part of a monthly payload, so it
// is carried forward when fresh data is swapped in (see swapInProposedData).
export const DIAGRAM_LAYOUT = 'diagram-layout.json';
// OA-143 - WHICH of the two vendored external generators a pack's `gen_external.js`
// is a copy of. An AREA pack stores it under a name that cannot say which, so the
// answer is recorded beside it and `track-engine.mjs` reads it rather than guessing.
// Nothing in src/ writes this file; it is written by `scripts/import-map.mjs` at
// import and by `scripts/backfill-engine-source.mjs` as a one-off. It is carried
// forward across a data refresh by swapInProposedData() (OA-199), which is the only
// reason src/ needs the name at all.
//
// THE NAME IS DUPLICATED, DELIBERATELY, AND THE DUPLICATION IS PINNED BY A TEST.
// `scripts/lib/engine-source.mjs` owns the authoritative constant and cannot import
// this module: `test-engine-source.mjs` builds a scratch world holding a copy of
// `scripts/` ONLY, so a src/ import would break the suite that guards the tracker.
// Importing the other way round would drag `src/db` - and a database migration -
// into a script whose whole point is to run without one. So the two literals are
// asserted equal in `scripts/test-carry-forward.mjs` rather than wished equal.
export const ENGINE_SOURCE = 'engine-source.json';
export function diagramLayoutPath(id) {
  return path.join(mapDataDir(id), DIAGRAM_LAYOUT);
}
export function baseOverridesPath(id) {
  return path.join(mapDataDir(id), BASE_OVERRIDES);
}
export function rendersDir(id) {
  return path.join(mapDir(id), 'renders');
}
/**
 * The customer-facing version NUMBER from a storage key: 'v5.0' -> '5.0'.
 *
 * One place, because two things print it and they must not disagree: the version
 * pill in the app, and the line the engine now prints in the footer band of the
 * sheet itself (footer.js `design.sheetVersion`). A reader on a noticeboard scans
 * the QR and lands on the public page; the number on the paper and the number on
 * the page have to be the same number.
 */
export function versionNumber(storageKey) {
  const m = /^v(\d+\.\d+)$/.exec(String(storageKey || ''));
  return m ? m[1] : null;
}

export function versionDir(id, storageKey) {
  return path.join(rendersDir(id), storageKey);
}

// P5 — a staged monthly refresh lives under proposed/<pid>/data until the
// customer accepts it (then it is swapped into data/) or declines (left as-is).
export function proposedRoot(id) {
  return path.join(mapDir(id), 'proposed');
}
export function proposedDataDir(id, pid) {
  return path.join(proposedRoot(id), String(pid), 'data');
}
// When a refresh is accepted, the outgoing live data is moved here (never deleted).
export function archiveRoot(id) {
  return path.join(mapDir(id), 'archive');
}

/** Create the folder skeleton for a new map and return its paths. */
export function ensureMapDirs(id) {
  const dirs = { root: mapDir(id), data: mapDataDir(id), renders: rendersDir(id) };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  // The vendored generators are CommonJS (they use require), but the repo root
  // package.json is "type":"module" and the object store lives inside the repo.
  // Drop a CommonJS-island marker beside the generators so Node runs them as CJS
  // (mirrors engine/package.json). Nearest package.json wins over the repo's.
  const marker = path.join(dirs.data, 'package.json');
  if (!existsSync(marker)) writeFileSync(marker, '{ "type": "commonjs" }\n');
  return dirs;
}

/**
 * Create the staging folder for a proposed update and drop the CommonJS-island
 * marker beside its generators (so the staged generators run when we render the
 * old-vs-new preview from this folder). Returns the staged data dir.
 */
export function ensureProposedDirs(id, pid) {
  const dataDir = proposedDataDir(id, pid);
  mkdirSync(dataDir, { recursive: true });
  const marker = path.join(dataDir, 'package.json');
  if (!existsSync(marker)) writeFileSync(marker, '{ "type": "commonjs" }\n');
  return dataDir;
}

// The four possible outputs of a map. `portal:true` = the portal engine can
// render it today (geographic + external); the schematic + diagram outputs are
// modelled so the toggle UI + data model are complete, but their generators are
// re-homed later (expert styles, P7), so they render as `portal:false` for now.
// `base` is the artefact basename in a render folder (<base>.svg / <base>.jpg).
//
// `gens` is a candidate list, tried in order: the first generator PRESENT in a
// map's data folder wins. This is how one output serves both kinds — an AREA map
// carries gen_internal.js / gen_external.js; a PLACE map carries the wrapper
// gen_internal_place.js (+ gen_internal.js) / gen_external_places.js. See
// resolveGen() in engine.js.
// The two EXPERT styles (P7) are portal-owned rather than per-map: a town's render
// folder never carried them, and they are geometry pre-stages that re-run the
// map's OWN gen_internal.js in a workspace. So they resolve from `engine/expert/`
// (`engine: 'expert'`) and are only available when the map's routes.json opts in
// with the config key the pre-stage requires (`requiresConfig`) — a map without it
// shows the output as unavailable instead of failing at render time.
//
// `requestOnly` marks an output the customer may SEE but not switch on: the
// tube-map diagram is generated and then pinned by hand in the pin editor, and
// those pins are ours to maintain on every later refresh, so it is quoted
// separately rather than being a tick-box. The editor shows it locked with an
// "Ask us" button; the lock itself is enforced in chooseOutputs() (engine.js) —
// hiding a checkbox is UX, not security.
//
// `buildAlways` marks an output that is RENDERED whenever the map's data
// supports it (config key present), independent of the `enabled` flag a
// customer switches: the schematic is cheap and deterministic to produce, so it
// is kept ready in every version's files, but it is still hidden from the
// customer's tabs/downloads and the public page until they tick the box —
// `enabled` there is a pure VISIBILITY gate, not a build gate. See
// effectiveOutputs() (engine.js, what gets rendered) vs outputsForClient() /
// visibleDownloadsForVersion() (server.js, what the customer is shown).
//
// `placeLabel` is the same output named for a PLACE map. A place map's sheets are
// titled "Buses serving <place>" and "Buses from <place>", so offering it "Within
// the area" and "To nearby towns" described somebody else's map (findings D1).
// The wording matches the public page's own labels (src/public/index.js) so the
// app and the page a reader lands on call the two sheets the same thing.
//
// 2026-08-19 — "Octolinear schematic" became "Simplified street map" (Peter's item 12).
// It was two pieces of jargon in a row of four labels that carry none, and it disagreed
// with this app's OWN public page, which has said "Simplified street map" since P8a. The
// new name says what the reader gets, sits in the same register as its three siblings,
// and keeps it distinct from the tube-map diagram — which is the distinction that matters,
// since both are abstractions of the same geography. The sheet's own corner note moved
// with it: the schematic now prints "Simplified — not to scale" where it used to claim,
// alongside the diagram, to be a "Diagram".
//
// `requiresFiles` is the same idea as `requiresConfig` one level down: an output
// whose generator needs DATA the payload may not carry. The boarding plan reads a
// stand register and a destination index that only a place built through the
// skill's Phase 3 has, and its generator exits non-zero when they are missing —
// which would fail the whole map's render, not just this sheet. Listing the files
// makes the output *unavailable* instead, which is the behaviour a customer and
// an importer both want. See resolveGen() (engine.js).
//
// 2026-08-23 — `boarding_plan`, the fifth output. "Where to board" answers the
// question the other four leave open: not "where do the buses go" but "I have
// decided to go to Bedford — which of these five identically-named stops do I
// stand at?" It is a third sheet on an existing PLACE map, not a new map kind:
// the index is keyed on DESTINATION (the standing criticism of spider maps is
// that they are keyed on route), and every boarding point is printed verbatim
// from NaPTAN, so the letter on the sheet is the letter on the flag. It is
// `requestOnly` for the same reason the tube-map diagram is — the frame radius,
// the empty-stand rule and the locator's landmarks are judgement calls we make
// per place, not a tick-box — and `requiresConfig: 'boardingPlan'` gives the
// decline-when-unavailable behaviour a place without lettered stops needs.
// Development Docs/boarding-plan-product_2026-08-22.md is the whole argument.
//
// 2026-08-24 - `internal_geographic` gains `requiresFiles` too, and a BOARDING-ONLY
// PLACE IS THE REASON. High Wycombe Town Centre and High Wycombe High Street ship a
// boarding plan and no internal or external sheet, so their payload has no
// `routes_paths.json` - but `import-map.mjs` copies the vendored place engine into
// EVERY place map, which makes `gen_internal_place.js` resolve and therefore makes
// the output look renderable. It then dies on the missing file and takes the whole
// import with it, leaving a half-built map row. Two of the four boarding sheets we
// hold could not be put on the portal at all.
//
// MEASURED BEFORE MAKING IT, because this changes what every existing map is
// offered: all 23 payload directories under data/maps carry routes_paths.json
// beside routes.json, as do both non-boarding fixtures. The only payload in the
// system without one is Places/_portal-fixture/High Wycombe High Street - the
// boarding-only fixture, which is exactly the case this is for. So the change is
// inert everywhere except where it is needed.
// What each sheet actually SHOWS, in one sentence: the hover text on the tabs
// that select it, in the editor's preview and on a reader's public page alike.
//
// 2026-08-27, Peter: on the public page it was "not obvious that all 3 tabs are
// buttons", and in the editor "not very obvious they are tabs" — which costs
// most in the editor, where the whole point of the row is that the customer
// REVIEWS every output before sending the map for publication. The tabs were
// restyled to read as buttons (public/css/styles.css, public/app/app.css) and
// given these descriptions.
//
// ONE table, not two, even though the LABELS above are deliberately two: a
// reader and an editor are told different things about the same sheet, but what
// is drawn ON the sheet does not change with who is looking at it, and a second
// copy is a second thing to forget. `place` is present only where the sheet is
// genuinely a different picture on a place map; everything else falls back to
// `area` rather than restating it.
export const OUTPUT_HINTS = {
  internal_geographic: {
    area:  'The street map: every bus route drawn along the roads it really uses, with the stops and local landmarks marked, so you can see where a bus actually goes through the area.',
    place: 'The close-up street map: the bus stops immediately around this place, and which routes call at each of them.',
  },
  external: {
    area:  'The onward-travel diagram: each route drawn out to the end of its line, so you can see which towns and villages you can reach from here, and on which bus.',
    place: 'Where you can get to from here: each destination shown once, with the buses that take you there.',
  },
  internal_schematic: {
    area:  'The same streets straightened and simplified — quicker to follow at a glance, and deliberately not to scale.',
  },
  internal_diagram: {
    area:  'The network drawn tube-map style: routes as coloured lines and interchanges as nodes, with geography set aside altogether.',
  },
  boarding_plan: {
    area:  'Which stop or stand to wait at, listed by where you want to GO rather than by route number.',
  },
};

/** The one-sentence description of an output, for the tab that selects it. */
export function outputHint(key, kind) {
  const h = OUTPUT_HINTS[key] || {};
  return (kind === 'place' && h.place) || h.area || '';
}

export const OUTPUTS = {
  internal_geographic: { gens: ['gen_internal_place.js', 'gen_internal.js'], base: 'internal',           label: 'Within the area', placeLabel: 'Serving this place', portal: true,
                         requiresFiles: ['routes_paths.json'] },
  // The place external's requirement is PER-GENERATOR, not per-output, and that
  // distinction is the whole of OA-009's second half. `gen_external_places.js`
  // aggregates `destinations` from routes.json; handed a payload with none it
  // exits 0 and draws a radial with no spokes — a blank sheet offered as "Where
  // those buses go", which is worse than an error. But putting
  // `requiresConfig: 'destinations'` on the OUTPUT would blank the external on
  // every live town map: 15 of the 23 payloads in the store are AREA maps fed by
  // `gen_external.js`, and none of them has a `destinations` key. Both guards are
  // read before a generator is chosen, so the requirement has to hang off the
  // candidate that has it.
  external:            { gens: ['gen_external.js', { file: 'gen_external_places.js', requiresConfig: 'destinations' }],
                         base: 'external',           label: 'To nearby places', placeLabel: 'Where those buses go', portal: true },
  internal_schematic:  { gens: ['gen_internal_schematic.js'], engine: 'expert', expert: true, requiresConfig: 'internalSchematic', base: 'internal-schematic', label: 'Simplified street map', portal: true, buildAlways: true },
  internal_diagram:    { gens: ['gen_internal_diagram.js'],   engine: 'expert', expert: true, requiresConfig: 'internalDiagram',   base: 'internal-diagram',   label: 'Tube-map diagram',     portal: true, requestOnly: true },
  boarding_plan:       { gens: ['gen_boarding.js'],           engine: 'expert', expert: true, requiresConfig: 'boardingPlan',
                         requiresFiles: ['stands.json', 'boarding_index.json'],
                         base: 'boarding', label: 'Where to board', placeLabel: 'Where to board', portal: true, requestOnly: true },
};

// Files a rendered version can hold, with content types (derived from OUTPUTS).
// `disagreements.pdf` isn't a render output (nothing toggles it, no SVG/JPG
// pair) — it's a static per-map extra carried forward by renderVersion() from
// the map's data folder, same as diagram-layout.json. See docs/DEVELOPING.md.
export const OUTPUT_FILES = Object.fromEntries([
  ...Object.values(OUTPUTS).flatMap((o) => [
    [`${o.base}.svg`, 'image/svg+xml'],
    [`${o.base}.jpg`, 'image/jpeg'],
  ]),
  ['disagreements.pdf', 'application/pdf'],
]);

// --- What the payload says it HAS (OA-009) ----------------------------------
//
// Until now the portal decided an output was renderable from whether a
// GENERATOR resolved, and it got both possible answers wrong. St Ives Bus
// Station has no external radial — the solver cannot fan its eight spokes
// without putting Cambridge in the wrong direction, and the skill's own board
// reports its external as `-`. The portal rendered a 20,563-byte external.svg
// with real spokes anyway, offered it, and it had to be switched off by hand.
//
// The truth was never far away: an S5-render folder contains exactly the sheets
// the skill built, one `<base>.svg` per output, and that is the same set the S4
// manifest record lists. So the PAYLOAD DECLARES ITSELF, and reading the
// declaration needs no manifest — which matters, because delivery scps only the
// --src folder to the host and the manifest never travels with it.
//
// Written at import and at every staged refresh; read by resolveGen(). ABSENT
// MEANS "DON'T KNOW", not "nothing": a map imported before this keeps exactly
// the behaviour it has today until its next refresh writes one.
export const SHEETS_FILE = 'sheets.json';

/** The `<base>.svg` files present in a payload source dir, as output bases. */
export function sheetsInPayloadDir(srcDir) {
  const bases = new Set(Object.values(OUTPUTS).map((o) => o.base));
  let found = [];
  try {
    found = readdirSync(srcDir)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4))
      .filter((b) => bases.has(b));
  } catch { return []; }
  // Deterministic, and in the OUTPUTS order rather than the filesystem's, so two
  // imports of the same payload write byte-identical declarations.
  return Object.values(OUTPUTS).map((o) => o.base).filter((b) => found.includes(b));
}

/**
 * Record what a payload declares, beside the payload. No-op when the source
 * folder holds no sheets at all — a source we cannot read must not be turned
 * into a declaration that every output is unavailable.
 * @returns {string[]|null} the bases declared, or null when nothing was written
 */
export function writeSheetDeclaration(dataDir, srcDir) {
  const sheets = sheetsInPayloadDir(srcDir);
  if (!sheets.length) return null;
  writeFileSync(
    path.join(dataDir, SHEETS_FILE),
    JSON.stringify({ schema: 1, sheets, source: path.basename(srcDir), declaredAt: new Date().toISOString() }, null, 2) + '\n',
  );
  return sheets;
}

/** What a stored payload declares, or null when it declares nothing. */
export function readSheetDeclaration(dataDir) {
  try {
    const d = JSON.parse(readFileSync(path.join(dataDir, SHEETS_FILE), 'utf8'));
    return Array.isArray(d && d.sheets) && d.sheets.length ? d.sheets : null;
  } catch { return null; }
}
