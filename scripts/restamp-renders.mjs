// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// Bring the renders already in the object store into line with whether each
// map is a SAMPLE map. The work is src/render/pilotReconcile.js; this is the
// operator's way to run it over every map at once.
//
// IT USED TO ASK ONE GLOBAL QUESTION AND NOW ASKS ONE PER MAP (buses-data
// OA-320). Until then it computed `want = PILOT.on` once and applied that answer
// to every stored sheet, because the band was gated on the site-wide PILOT_MODE
// and there was nothing else it could have asked. The band's own words are a
// claim about the map — "Not published by any organisation" — so the question
// is now per map, from that map's customer.
//
// AND THAT COSTS THE PROPERTY THE OLD IMPORT WAS PROTECTING, DELIBERATELY. This
// script used to import DATA_DIR from src/db/paths.js with a comment saying
// "paths only: importing src/db opens and migrates the database" — the point of
// OA-224 Tier 3.3, which stopped three scripts migrating the live database as a
// side effect of wanting to know where data/maps is. Reading a customer means
// opening the database, so that is given up here ON PURPOSE and stated rather
// than quietly reversed. It is acceptable for this one script because it is run
// by an operator, against the live store, as a deliberate act — the same footing
// as the deploy step in docs/PILOT.md — and never at import time by a test or a
// server. pilotReconcile.js itself still imports paths only, and takes the
// answer as an argument, so nothing that merely renders pulls a database in.
//
// Usage — folder: the repository root (C:\Claude\community-bus-maps on the
// laptop, /opt/community-bus-maps — DEPLOY_APP_DIR — on the host). No placeholders in either line.
//   node scripts/restamp-renders.mjs            # report what would change
//   node scripts/restamp-renders.mjs --apply    # do it
// PILOT_MODE=0 still strips every band from everything, sample or not.

import { getMap } from '../src/db/index.js';
import { isSampleCustomer } from '../src/render/pilotStamp.js';
import { reconcileMapRenders, storedMapIds } from '../src/render/pilotReconcile.js';

const APPLY = process.argv.includes('--apply');

let seen = 0;
let changed = 0;
const missing = [];

for (const mapId of storedMapIds()) {
  // A directory in the store with no row in the database is an orphan — a map
  // deleted, or a half-finished import. isSampleCustomer(null) answers "sample",
  // which is the honest direction: an orphan nobody can attribute keeps the band
  // that says nobody published it. It is counted and named rather than skipped
  // silently, because a store full of orphans is worth knowing about.
  const map = getMap(Number(mapId));
  if (!map) missing.push(mapId);
  const r = await reconcileMapRenders(mapId, isSampleCustomer(map), {
    apply: APPLY,
    log: (line) => console.log(line),
  });
  seen += r.seen;
  changed += r.changed;
}

if (missing.length) {
  console.log(`\n· ${missing.length} render folder(s) with no map row, treated as samples: ${missing.join(', ')}`);
}

console.log(
  `\n${APPLY ? 'Done' : 'Dry run'} — ${seen} stored sheet(s) inspected, ${changed} ${APPLY ? 'changed' : 'would change'}.`
  + (APPLY ? '' : '\nRe-run with --apply to write.'),
);
