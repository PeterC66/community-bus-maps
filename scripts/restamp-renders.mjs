// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// Applies (or removes) the pilot band on renders that already exist in the
// object store.
//
// The band is added at render time (src/render/renderMap.js), so anything
// rendered BEFORE the pilot landed — including versions already signed off and
// published — still carries none. Those are exactly the sheets a member of the
// public can download, so they are the ones that most need it.
//
// This never re-runs a generator. It rewrites each stored SVG through the same
// stampPilot() the renderer uses and re-rasterises the JPG with the same
// parameters, so a restamped version is what the renderer would have produced.
// Web previews (*-web.jpg) are derived copies and are simply deleted; the
// public route regenerates them on the next request.
//
// Usage:
//   node scripts/restamp-renders.mjs            # report what would change
//   node scripts/restamp-renders.mjs --apply    # do it
//   PILOT_MODE=0 node scripts/restamp-renders.mjs --apply   # strip the band

import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/db/index.js';
import { PILOT } from '../src/config.js';
import { stampPilot } from '../src/render/pilotStamp.js';
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
      const has = before.includes('id="pilot-band"');
      // PILOT_MODE=0 → strip; otherwise → add. Either way, only act when the
      // file is not already in the state we want.
      const want = PILOT.on;
      seen += 1;
      if (has === want) continue;

      const after = want ? stampPilot(before) : unstamp(before);
      if (after === before) continue;
      changed += 1;
      const label = `map ${mapId} ${version}/${file}`;
      if (!APPLY) { console.log(`· would ${want ? 'stamp' : 'unstamp'}: ${label}`); continue; }

      writeFileSync(svgPath, after);
      const jpg = svgPath.replace(/\.svg$/i, '.jpg');
      await rasterise(svgPath, jpg);
      const web = svgPath.replace(/\.svg$/i, '-web.jpg');
      if (existsSync(web)) rmSync(web); // derived; regenerated on demand
      console.log(`· ${want ? 'stamped' : 'unstamped'}: ${label}`);
    }
  }
}

/** Undo stampPilot: drop the band + background and unwrap the content group. */
function unstamp(svg) {
  return svg
    // The leading \n is the one stampPilot() inserts after the <svg> open tag.
    .replace(/\n<rect id="pilot-bg"[^>]*\/>\n?/, '')
    .replace(/<g id="pilot-content"[^>]*>\n?/, '')
    .replace(/<\/g>\n<g id="pilot-band">[\s\S]*?<\/g>\n/, '');
}

console.log(
  `\n${APPLY ? 'Done' : 'Dry run'} — ${seen} stored sheet(s) inspected, ${changed} ${APPLY ? 'changed' : 'would change'}.`
  + (APPLY ? '' : '\nRe-run with --apply to write.'),
);
