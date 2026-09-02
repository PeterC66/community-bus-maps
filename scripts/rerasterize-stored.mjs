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
// --check was added on 2026-08-20 for the sharp 0.34 -> 0.35 upgrade
// (technical-audit_2026-08-19 S2), and is the mode to reach for after ANY change
// to the rasteriser or the base image. It answers the question a dry run could
// not: would re-rasterising these SVGs today produce DIFFERENT BYTES from what is
// stored? It rasterises to a scratch file, compares, and writes nothing.
//
// Why that question needs asking on the host and cannot be answered on the
// laptop: the stored JPGs were produced by the host's libvips against the host's
// fonts. Measured on Windows, sharp 0.34.5/libvips 8.17.3 -> 0.35.3/8.18.3 moved
// not one byte of either parity probe — but "unchanged on Windows" is not
// "unchanged on node:24-slim", and the Liberation Mono incident is the standing
// reminder that a rasteriser change can be invisible until someone looks at the
// artefact.
//
// Usage (from the repo root; on the host, wrap in `docker compose run --rm portal`):
//   node scripts/rerasterize-stored.mjs            # list what is there
//   node scripts/rerasterize-stored.mjs --check    # would any bytes change? writes nothing
//   node scripts/rerasterize-stored.mjs --apply    # re-rasterise every stored SVG

import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from '../src/db/paths.js';   // paths only: importing src/db opens and migrates the database
import { rasterise } from '../src/render/renderMap.js';

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const MAPS = path.join(DATA_DIR, 'maps');
const scratch = CHECK ? mkdtempSync(path.join(os.tmpdir(), 'cbm-reraster-')) : null;
let differ = 0;

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
      if (CHECK) {
        try {
          const probe = path.join(scratch, `${mapId}-${version}-${file}.jpg`.replace(/[\\/]/g, '_'));
          await rasterise(svgPath, probe);
          const same = readFileSync(probe).equals(readFileSync(jpgPath));
          rmSync(probe, { force: true });
          if (same) { console.log(`· unchanged: ${label}`); }
          else { differ += 1; console.log(`· WOULD CHANGE: ${label}`); }
        } catch (e) {
          failed += 1;
          console.error(`· FAILED: ${label} — ${e.message}`);
        }
        continue;
      }
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

if (CHECK) {
  rmSync(scratch, { recursive: true, force: true });
  console.log(`\nCheck — ${seen} stored JPG(s), ${differ} would change, ${failed} failed. Nothing was written.`);
  if (differ) {
    console.log('  The rasteriser no longer reproduces the stored bytes. That is not automatically wrong —');
    console.log('  a libvips upgrade can legitimately re-encode identically-looking output — but it means the');
    console.log('  published bytes and a re-render have parted company, so decide deliberately:');
    console.log('    - LOOK at one changed sheet before anything else. The Liberation Mono incident moved bytes');
    console.log('      too, and every sheet was wrong.');
    console.log('    - then `--apply` to bring the stored files back in line, and say so in CHANGELOG.md.');
  }
  // Differences are a finding to act on, not a script failure; only a genuine
  // rasterisation error is an error.
  process.exit(failed > 0 ? 1 : 0);
}

console.log(
  `\n${APPLY ? 'Done' : 'Dry run'} — ${seen} stored JPG(s) found, `
  + (APPLY ? `${done} re-rasterised, ${failed} failed.` : 'none written.\nRe-run with --apply to write, or --check to see whether any bytes would move.'),
);
process.exit(failed > 0 ? 1 : 0);
