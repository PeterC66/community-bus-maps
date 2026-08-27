// Keep every stored map's generator tracking the vendored engine (OA-130).
//
// A map's data pack carries its own copy of the generator, and `generateSvg()`
// runs THAT copy — `path.join(dataDir, generator)` — so an engine fix does not
// reach a published map until somebody re-imports it. Measured 2026-08-27, the
// packs were 1,383 lines behind and required eleven modules they do not mention,
// which resolve through SKILL_ASSETS to `engine/` and so happen to work.
//
// Peter's decision, 2026-08-27: TRACK, not freeze. Freezing guarantees a
// published map re-renders identically for its whole life; tracking means one
// engine fix reaches every map. This script is what makes tracking true — run it
// after every re-vendor.
//
// WHAT IT DOES AND DOES NOT DO. It copies the vendored generator over the pack's
// copy. It NEVER re-renders: the stored SVGs and JPGs are untouched, so nothing a
// member of the public can see changes today. What changes is the NEXT render of
// that map — a preview, an accepted proposed update, a re-publish — which will
// use the current engine instead of the one frozen at import.
//
// AMBIGUOUS FILES ARE SKIPPED, LOUDLY. An area pack's `gen_external.js` was
// copied from either `engine/area/gen_external_radial.js` or `..._busway.js` and
// the pack does not record which, so this script will not guess; it reports them
// and leaves them alone. Re-import such a map to move it forward.
//
// Usage, from the repository root (C:\Claude\community-bus-maps on the laptop,
// /opt/community-bus-maps inside the container on the VPS). No placeholders:
//   node scripts/track-engine.mjs            # report; exit 1 if any pack is behind
//   node scripts/track-engine.mjs --apply    # bring them forward
//
// The reporting form exits NON-ZERO when a pack is behind, so it works as a check
// as well as a report: a re-vendor that forgets this step fails it.

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// DATA_DIR is resolved the same way src/db/index.js resolves it, rather than by
// importing that module for one constant: importing it OPENS AND MIGRATES the
// database as a side effect, which is a lot of machinery — and a lot of ways to
// fail — for a script that only reads files off disk.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : fileURLToPath(new URL('../data', import.meta.url));

const APPLY = process.argv.includes('--apply');
const MAPS = path.join(DATA_DIR, 'maps');
const ENGINE = fileURLToPath(new URL('../engine', import.meta.url));

// pack filename -> the vendored file it must equal. Only unambiguous ones.
const TRACKED = {
  'gen_internal.js': 'place/gen_internal.js',
  'gen_internal_place.js': 'place/gen_internal_place.js',
  'gen_external_places.js': 'place/gen_external_places.js',
};
// Carried by a pack, vendored under more than one name — see the header.
const AMBIGUOUS = { 'gen_external.js': 'engine/area/gen_external_{radial,busway}.js' };

// CRLF-normalised, the same rule engine/vendored.json uses, so a checkout under
// core.autocrlf=true does not report every pack as behind.
const hash = (p) => createHash('sha256')
  .update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(path.join(p, d)).isDirectory()) : []);

if (!existsSync(MAPS)) {
  console.log(`· no map store at ${MAPS} — nothing to do.`);
  process.exit(0);
}

let behind = 0, current = 0, skipped = 0;
const rows = [];

for (const id of dirs(MAPS)) {
  const dataDir = path.join(MAPS, id, 'data');
  if (!existsSync(dataDir)) continue;
  for (const [name, vendoredRel] of Object.entries(TRACKED)) {
    const packFile = path.join(dataDir, name);
    if (!existsSync(packFile)) continue;
    const vendored = path.join(ENGINE, vendoredRel);
    if (!existsSync(vendored)) {
      rows.push(['?', id, name, `no vendored ${vendoredRel} to track — re-vendor first`]);
      skipped++;
      continue;
    }
    const was = hash(packFile), now = hash(vendored);
    if (was === now) { current++; continue; }
    behind++;
    rows.push([APPLY ? '→' : '✗', id, name, `${was} → ${now}`]);
    if (APPLY) writeFileSync(packFile, readFileSync(vendored));
  }
  for (const [name, where] of Object.entries(AMBIGUOUS)) {
    if (!existsSync(path.join(dataDir, name))) continue;
    rows.push(['·', id, name, `vendored as ${where} — which one is not recorded, so it is left alone`]);
    skipped++;
  }
}

console.log(`\nMap packs tracking the vendored engine — ${MAPS}\n`);
if (!rows.length) console.log('  nothing to report');
for (const [mark, id, name, note] of rows) {
  console.log(`  ${mark} map ${String(id).padEnd(6)} ${name.padEnd(24)} ${note}`);
}
console.log(`\n${current} already current, ${behind} ${APPLY ? 'brought forward' : 'BEHIND'}, ${skipped} skipped.`);

if (behind && !APPLY) {
  console.log('\nThese maps run a generator frozen at import, so no engine fix reaches them.');
  console.log('Bring them forward with:  node scripts/track-engine.mjs --apply');
  console.log('Nothing is re-rendered — the stored sheets are untouched, and the NEXT');
  console.log('render of each map uses the current engine (OA-130: track, not freeze).');
}
if (APPLY && behind) {
  console.log('\nStored sheets are UNCHANGED. Re-render a map to see the current engine in its output.');
}
process.exitCode = (behind && !APPLY) ? 1 : 0;
