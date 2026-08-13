// One-off remediation for the 2026-08-13 fontconfig fix (see CHANGELOG.md).
//
// Every published sheet's TEXT LAYOUT lives in the stored SVG as <text> elements,
// not as pre-measured glyph outlines -- the actual pixel positions are decided at
// RASTERISATION time by whatever font "Arial" resolves to on the host. Between
// 2026-08-09 and 2026-08-13 that was Liberation Mono (see the Dockerfile comment
// and CHANGELOG "the live host rendered every sheet in monospace"), so every
// stored JPG was mis-set even though the SVG bytes were always correct.
//
// This does NOT re-run any generator and does NOT touch a single SVG byte -- it
// only re-invokes rasterise() on the SVG that is already there, now that Arial
// correctly resolves to Liberation Sans. That keeps it out of scope of "changing
// a map": no route data, no timetable data, no overrides are read or written.
// Deliberately narrower than propose-update.mjs / import-map.mjs, which also
// regenerate the SVG from generators + current data.
//
// Usage:
//   node scripts/rerasterize-stored.mjs            # report what's there
//   node scripts/rerasterize-stored.mjs --apply    # re-rasterise every stored SVG

import { readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/db/index.js';
import { rasterise } from '../src/render/renderMap.js';

const APPLY = process.argv.includes('--apply');
const MAPS = path.join(DATA_DIR, 'maps');

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(path.join(p, d)).isDirectory()) : []);

let seen = 0, done = 0, failed = 0;

for (const mapId of dirs(MAPS)) {
  const renders = path.join(MAPS, mapId, 'renders');
  for (const version of dirs(renders)) {
    const dir = path.join(renders, version);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      const svgPath = path.join(dir, file);
      const jpgPath = svgPath.replace(/\.svg$/i, '.jpg');
      if (!existsSync(jpgPath)) continue; // this output has no raster sibling (e.g. schematic without one)
      seen += 1;
      const label = `map ${mapId} ${version}/${file}`;
      if (!APPLY) { console.log(`· would re-rasterise: ${label}`); continue; }
      try {
        await rasterise(svgPath, jpgPath);
        const web = svgPath.replace(/\.svg$/i, '-web.jpg');
        if (existsSync(web)) rmSync(web); // derived; regenerated on demand
        done += 1;
        console.log(`· re-rasterised: ${label}`);
      } catch (e) {
        failed += 1;
        console.error(`· FAILED: ${label} — ${e.message}`);
      }
    }
  }
}

console.log(
  `\n${APPLY ? 'Done' : 'Dry run'} — ${seen} stored JPG(s) found, `
  + (APPLY ? `${done} re-rasterised, ${failed} failed.` : 'none written.\nRe-run with --apply to write.'),
);
process.exit(failed > 0 ? 1 : 0);
