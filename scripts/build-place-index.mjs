// P9 Part B B2 — backfill the places.json sidecar for every currently-published
// version. Needed once because the 13 real maps were published on 2026-08-09,
// before the sidecar (B1) existed; safe to re-run any time (idempotent —
// derives from the live data dir, same as the publish-time write).
//
//   node scripts/build-place-index.mjs [--dry-run]     (or: npm run places:build)
//
// It writes into the live store, so it takes the REMOTE vocabulary of
// docs/CONVENTIONS.md through cli.mjs's confirm(): the default is to do it, and
// `--dry-run` names every version it would index and writes no sidecar
// (buses-data OA-228). test-build-place-index.mjs proves that by looking for the
// file on disk after the run.

import { listPublishedMaps } from '../src/db/index.js';
import { writePlacesSidecar } from '../src/search/place-index.js';
import { confirm } from './lib/cli.mjs';

const { dryRun } = confirm('remote');

const maps = listPublishedMaps().filter((m) => m.pub_key);
let n = 0;
for (const m of maps) {
  if (!dryRun) writePlacesSidecar(m.id, m.pub_key, { kind: m.kind, subject: m.subject });
  console.log(`· ${dryRun ? 'would index ' : ''}${m.slug} (${m.pub_key})`);
  n++;
}
console.log(dryRun
  ? `\n${n} published version(s) would be indexed — --dry-run, nothing written.`
  : `\n${n} published version(s) indexed.`);
