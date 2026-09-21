// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// Bring one map's STORED renders into line with whether that map is a sample.
//
// WHY A RECONCILER EXISTS AT ALL (buses-data OA-320). The band is baked into the
// bytes at render time, which is right for it and wrong for its two neighbours:
// draftStamp.js had to move to serve time because a version's state changes
// every time somebody publishes, and watermark.js because the answer differs
// between two viewers at the same instant. The band is neither — for a given map
// it is the same for every viewer, and it changes on exactly one event, an admin
// reassigning the map to another organisation. So the answer lives in the bytes
// and this is what is run when that one event happens.
//
// WITHOUT IT THE FIX WOULD HAVE THE SHAPE OF THE FAULT. A claim baked into bytes
// that outlives the thing it was a claim about is precisely what OA-320 was
// filed to remove; leaving stored sheets unreconciled would move the problem
// from "the flag is site-wide" to "the answer is frozen at render time", which
// is the same bug with a smaller blast radius.
//
// IT NEVER RE-RUNS A GENERATOR. Each stored SVG is rewritten through the same
// stampPilot()/unstampPilot() pair the renderer uses and the JPG re-rasterised
// with the same parameters, so a reconciled version is byte-for-byte what the
// renderer would have produced had it known. Web previews (*-web.jpg) are
// derived copies and are deleted; the public route regenerates them on demand.

import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MAPS_DIR } from '../db/paths.js';
import { PILOT } from '../config.js';
import { stampPilot, unstampPilot, hasPilotBand } from './pilotStamp.js';
import { rasterise } from './renderMap.js';

const subdirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(path.join(p, d)).isDirectory()) : []);

/** Every map id that has a renders/ folder in the store. */
export function storedMapIds() {
  return subdirs(MAPS_DIR).filter((id) => existsSync(path.join(MAPS_DIR, id, 'renders')));
}

/**
 * Reconcile every stored sheet of one map.
 *
 * @param {string|number} mapId
 * @param {boolean} isSample  does this map's customer publish SAMPLE maps?
 * @param {{apply?: boolean, log?: (line: string) => void}} [opts]
 * @returns {Promise<{seen: number, changed: number, want: boolean}>}
 */
export async function reconcileMapRenders(mapId, isSample, { apply = false, log } = {}) {
  // The site-wide flag still wins, and it wins in the OFF direction only: with
  // PILOT_MODE=0 nothing carries a band, sample or not. `sample: true` cannot
  // switch the pilot back on, which is the same composition renderMap.js has.
  const want = PILOT.on && !!isSample;
  const renders = path.join(MAPS_DIR, String(mapId), 'renders');
  let seen = 0;
  let changed = 0;

  for (const version of subdirs(renders)) {
    const dir = path.join(renders, version);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      const svgPath = path.join(dir, file);
      const before = readFileSync(svgPath, 'utf8');
      seen += 1;
      if (hasPilotBand(before) === want) continue;

      const after = want ? stampPilot(before) : unstampPilot(before);
      // stampPilot() declines a document with no usable viewBox rather than
      // throwing, so a no-op here is "not ours to touch" and not a failure.
      if (after === before) continue;
      changed += 1;
      const label = `map ${mapId} ${version}/${file}`;
      if (!apply) { log?.(`· would ${want ? 'stamp' : 'unstamp'}: ${label}`); continue; }

      writeFileSync(svgPath, after);
      const jpg = svgPath.replace(/\.svg$/i, '.jpg');
      await rasterise(svgPath, jpg);
      const web = svgPath.replace(/\.svg$/i, '-web.jpg');
      if (existsSync(web)) rmSync(web); // derived; regenerated on demand
      log?.(`· ${want ? 'stamped' : 'unstamped'}: ${label}`);
    }
  }
  return { seen, changed, want };
}
