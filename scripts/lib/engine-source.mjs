/*
 * engine-source.mjs — WHICH vendored generator a pack's copy came from (OA-143).
 *
 * THE PROBLEM. A map's data pack carries its own copy of the generators and
 * `generateSvg()` runs THAT copy, so `track-engine.mjs` keeps them level with
 * `engine/` after every re-vendor. It can only do that where the pack's filename
 * says what the file is. An AREA pack stores its external generator as
 * `gen_external.js`, and the portal vendored TWO of them until 2026-09-02 —
 * `engine/area/gen_external_radial.js` and `engine/area/gen_external_busway.js` —
 * so the name did not say. The tracker refuses to guess, which is right:
 * overwriting a busway map with the radial generator is a silent corruption of
 * the pack, discovered at the next render.
 *
 * THE BUSWAY TEMPLATE IS GONE AND THIS FILE STAYS, deliberately. Two reasons, and
 * neither is sentiment. The live store holds packs imported before that date and
 * this laptop cannot read them, so a pack that names the dropped generator has to
 * be something the next `track:engine` REPORTS rather than something a person
 * remembers to look for — it prints the pack by name and, since 2026-09-02, exits
 * non-zero. And a declaration is the right shape whatever the count of templates
 * happens to be today: `gen_external.js` still does not say what it is a copy of. The measured cost of refusing was
 * **eight of eighteen live maps skipped, every run, for ever** — every town's
 * external sheet, which is a whole sheet type on every town we publish.
 *
 * THE FIX IS TO RECORD THE ANSWER WHERE IT IS KNOWN, WHICH IS AT IMPORT.
 * `import-map.mjs` picks the file it stages; it writes what it picked here.
 * `track-engine.mjs` reads it and tracks the pack like any other. Nothing
 * infers, at any point, on any run — a pack that does not declare is skipped
 * exactly as before. `backfill-engine-source.mjs` is the one-off that fills in
 * the packs imported before this file existed, and it is the ONLY place allowed
 * to work the answer out rather than be told it.
 *
 * WHY A MAP AND NOT A `style` STRING. The thing that has to be true is "this
 * pack file equals that vendored file"; a `style: "radial"` needs a second
 * lookup table to become that sentence, and the table is what would drift. The
 * stored value is the vendored path itself, relative to `engine/`, so the
 * tracker can act on it directly.
 *
 * WHY NOT SIMPLY KEEP THE VENDORED FILENAME IN THE PACK. Because `renderMap.js`
 * resolves a map's external generator by the name `gen_external.js`, on every
 * pack that exists. Renaming is a bigger change to a hotter path than recording
 * a fact beside it, and it would have to be right for every already-imported map
 * on the first render after deploy.
 *
 * A PACK THAT CARRIES ITS OWN HAND-EDITED GENERATOR MUST NOT BE TRACKED, and
 * this design gets that for free: `import-map.mjs` writes provenance only when
 * it staged a vendored file. A payload that brought its own is left undeclared,
 * so the tracker leaves it alone — which is the correct outcome and not a
 * limitation.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* Portal-owned, and named so it cannot collide with anything a generator reads.
 * It lives inside the pack's `data/` because that is the directory that travels
 * with the map — a sibling of the generator it describes. `import-map.mjs`
 * copies `*.json` out of the payload BEFORE writing this, so a skill payload
 * that ever carried the same name cannot overwrite the portal's answer. */
export const ENGINE_SOURCE_FILE = 'engine-source.json';

/* What a declaration looks like on disk:
 *
 *   { "recorded": "import",                        // or "backfill"
 *     "at": "2026-08-30T13:41:02.118Z",
 *     "generators": { "gen_external.js": "area/gen_external_radial.js" } }
 *
 * `generators` maps a PACK filename to a path relative to `engine/`. Only
 * ambiguous names need an entry; the unambiguous ones are in the tracker's own
 * table and always have been. */

export function readEngineSource(dataDir) {
  const p = path.join(dataDir, ENGINE_SOURCE_FILE);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return (j && typeof j.generators === 'object' && j.generators) ? j : null;
  } catch {
    // Unreadable is NOT "absent": absent means nobody has answered, and
    // unreadable means somebody answered and we cannot hear it. The caller is
    // told the difference so it can say so rather than silently skipping.
    return { generators: {}, unreadable: true };
  }
}

/** The vendored path (relative to engine/) recorded for one pack file, or null. */
export function sourceOf(dataDir, packFile) {
  const rec = readEngineSource(dataDir);
  if (!rec || rec.unreadable) return null;
  const v = rec.generators[packFile];
  return (typeof v === 'string' && v) ? v : null;
}

/** Record (or update) one pack file's provenance. `how` is 'import' or 'backfill'. */
export function writeEngineSource(dataDir, generators, how) {
  const p = path.join(dataDir, ENGINE_SOURCE_FILE);
  const prev = readEngineSource(dataDir);
  const merged = Object.assign({}, (prev && !prev.unreadable) ? prev.generators : {}, generators);
  const out = { recorded: how, at: new Date().toISOString(), generators: merged };
  writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
  return out;
}
