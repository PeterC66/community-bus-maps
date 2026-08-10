// P9 Part B B2 — backfill the places.json sidecar for every currently-published
// version. Needed once because the 13 real maps were published on 2026-08-09,
// before the sidecar (B1) existed; safe to re-run any time (idempotent —
// derives from the live data dir, same as the publish-time write).
//
//   node scripts/build-place-index.mjs          (or: npm run places:build)

import { listPublishedMaps } from '../src/db/index.js';
import { writePlacesSidecar } from '../src/search/place-index.js';

const maps = listPublishedMaps().filter((m) => m.pub_key);
let n = 0;
for (const m of maps) {
  writePlacesSidecar(m.id, m.pub_key, { kind: m.kind, subject: m.subject });
  console.log(`· ${m.slug} (${m.pub_key})`);
  n++;
}
console.log(`\n${n} published version(s) indexed.`);
