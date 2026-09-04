// Repair unreadable route-number badges on renders that already exist.
//
// src/render/badgeContrast.js fixes this at render time, so every sheet produced
// from now on is fine. Anything rendered BEFORE it landed still carries the fault
// — including versions already reviewed and published, which are exactly the
// sheets the public can download — and would only be corrected the next time the
// customer happens to save a new version.
//
// This never re-runs a generator. It rewrites each stored SVG through the same
// fixBadgeContrast() the renderer uses and re-rasterises the JPG with the same
// parameters, so a repaired version is what the renderer would have produced.
// Web previews (*-web.jpg) are derived copies and are simply deleted; the public
// route regenerates them on the next request.
//
// Usage:
//   node scripts/fix-badge-contrast.mjs            # report what would change
//   node scripts/fix-badge-contrast.mjs --apply    # do it

import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/db/paths.js';   // paths only: importing src/db opens and migrates the database
import { fixBadgeContrast } from '../src/render/badgeContrast.js';
import { rasterise } from '../src/render/renderMap.js';

const APPLY = process.argv.includes('--apply');
const MAPS = path.join(DATA_DIR, 'maps');

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(path.join(p, d)).isDirectory()) : []);

let seen = 0, changed = 0;

for (const mapId of dirs(MAPS)) {
  const renders = path.join(MAPS, mapId, 'renders');
  for (const version of dirs(renders)) {
    const dir = path.join(renders, version);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      const svgPath = path.join(dir, file);
      const before = readFileSync(svgPath, 'utf8');
      seen += 1;
      const after = fixBadgeContrast(before);
      if (after === before) continue; // already legible — untouched, byte for byte
      changed += 1;
      const label = `map ${mapId} ${version}/${file}`;
      if (!APPLY) { console.log(`· would repair: ${label}`); continue; }

      writeFileSync(svgPath, after);
      await rasterise(svgPath, svgPath.replace(/\.svg$/i, '.jpg'));
      const web = svgPath.replace(/\.svg$/i, '-web.jpg');
      if (existsSync(web)) rmSync(web); // derived; regenerated on demand
      console.log(`· repaired: ${label}`);
    }
  }
}

console.log(
  `\n${APPLY ? 'Done' : 'Dry run'} — ${seen} stored sheet(s) inspected, ${changed} ${APPLY ? 'repaired' : 'would be repaired'}.`
  + (APPLY ? '' : '\nRe-run with --apply to write.'),
);
