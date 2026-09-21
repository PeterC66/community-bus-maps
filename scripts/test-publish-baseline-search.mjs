#!/usr/bin/env node
// A MAP PUBLISHED FROM THE COMMAND LINE MUST BE SEARCHABLE BY THE PLACES ON IT
// (buses-data OA-379, 2026-09-16).
//
//   node scripts/test-publish-baseline-search.mjs   (or: npm run test:publish-baseline-search)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments, there are no placeholders, and it works in a throwaway DATA_DIR — it
// never touches the real portal data.
//
// WHY IT SPAWNS THE REAL SCRIPT INSTEAD OF DOING WHAT THE SCRIPT DOES.
//
// scripts/test-search.mjs already covers the search itself, thoroughly. It could
// not have caught this bug, and the reason is worth stating: its seedMap() helper
// calls writePlacesSidecar() itself, "mirroring what the approve handler does". A
// fixture that re-implements the rule under test can only ever confirm the rule —
// never the production code that has to keep it. So for a year the suite proved
// that a sidecar makes a map searchable while nothing proved that publishing wrote
// one, and scripts/publish-baseline.mjs did not.
//
// This test therefore builds a draft map and then hands it to the actual
// `publish-baseline.mjs` as a child process, exactly as an operator would, and
// asks the question a reader asks: type the name of a village on the sheet, and is
// the map there? Its companion scripts/check-publish-paths.mjs asks the same thing
// of every OTHER publish path by reading the source, because spawning each of them
// is not practical; the two halves are meant to be read together.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-publish-baseline-'));
process.env.DATA_DIR = scratch;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const db = await import('../src/db/index.js');
const { mapDataDir, versionDir } = await import('../src/maps/store.js');
const { readPlacesSidecar } = await import('../src/search/place-index.js');

// --- a draft map, rendered and awaiting its first publication ----------------
//
// The place names are invented rather than borrowed from a real sheet, so a
// failure here cannot be a coincidence of some other fixture carrying the same
// village. "Sidecar Magna" appears nowhere else in this repository.
const ACTOR = 'baseline-test-admin@example.com';
const SLUG = 'baseline-search-town';
const DESTINATION = 'Farbrook Parva';
const STOP = 'Sidecar Magna';

const customerId = db.insertCustomer({ name: 'Baseline Search Test Council' });
db.insertUser({ customer_id: customerId, email: ACTOR, name: 'Baseline Test Admin', role: 'admin' });

const mapId = db.insertMap({
  customer_id: customerId, slug: SLUG, name: 'Baseline Search Town', kind: 'area',
  subject: 'Baseline Search Town, Testshire', data_dir: `maps/${SLUG}`, status: 'draft',
});
const versionId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
db.setCurrentVersion(mapId, versionId);

const dataDir = mapDataDir(mapId);
mkdirSync(dataDir, { recursive: true });
writeFileSync(path.join(dataDir, 'routes.json'), JSON.stringify({
  external: [{ route: '69', label: DESTINATION, stops: [STOP, DESTINATION] }],
}));
// A public page needs at least one output file on disk (publicOutputs()); a stub
// SVG is enough and no generator runs.
mkdirSync(versionDir(mapId, 'v1.0'), { recursive: true });
writeFileSync(path.join(versionDir(mapId, 'v1.0'), 'internal.svg'), '<svg/>');

// --- the control: it is NOT searchable before the script runs ---------------
//
// Without this, a test that finds the map afterwards proves nothing about the
// script — the map might have been findable all along.
{
  const { searchPlaces, bumpSearchIndex } = await import('../src/search/index.js');
  bumpSearchIndex();
  console.log('\nbefore publishing — the control');
  check('a draft map is not in the search at all', searchPlaces(STOP).results.length === 0);
  check('…and it has no place-name sidecar', readPlacesSidecar(mapId, 'v1.0') === null);
}

// --- run the real thing ------------------------------------------------------

console.log('\nrunning scripts/publish-baseline.mjs, as an operator would');
const run = spawnSync(process.execPath, [path.join(HERE, 'publish-baseline.mjs'), '--actor', ACTOR, '--slug', SLUG], {
  encoding: 'utf8',
  env: { ...process.env, DATA_DIR: scratch },
});
const out = (run.stdout || '') + (run.stderr || '');
check('it exits 0', run.status === 0, `exit ${run.status}; output was:\n${out}`);
check('it says it published the map', /published baseline-search-town v1\.0/.test(out), out);
// The sidecars are on disk but the running portal caches its index in process, so
// a line nobody can act on is worse than no line at all.
check('it tells the operator the portal needs restarting', /[Rr]estart the portal/.test(out), out);

// --- what the reader gets ----------------------------------------------------

console.log('\nafter publishing');
check('the version has a place-name sidecar on disk', existsSync(path.join(versionDir(mapId, 'v1.0'), 'places.json')));
{
  const sidecar = readPlacesSidecar(mapId, 'v1.0');
  check('…which names the destination', !!sidecar && sidecar.places.some((p) => p.name === DESTINATION && p.role === 'destination'), JSON.stringify(sidecar));
  check('…and the stop along the way', !!sidecar && sidecar.places.some((p) => p.name === STOP && p.role === 'stop'), JSON.stringify(sidecar));
}
{
  // A fresh process, because this one built its index before the child ran and the
  // child cannot reach into it — which is the same reason the script prints the
  // restart line above.
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { searchPlaces } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'src', 'search', 'index.js')).href)});
    process.stdout.write(JSON.stringify(searchPlaces(${JSON.stringify(STOP)}).results.map((r) => ({ slug: r.map.slug, reason: r.reason }))));
  `], { encoding: 'utf8', env: { ...process.env, DATA_DIR: scratch } });
  let results = [];
  try { results = JSON.parse(probe.stdout || '[]'); } catch { /* reported below */ }
  check(`searching "${STOP}" now finds the map`, results.some((r) => r.slug === SLUG),
    `stdout ${JSON.stringify(probe.stdout)} stderr ${probe.stderr}`);
  check('…and explains itself by the route that goes there',
    results.some((r) => /Route 69 passes through Sidecar Magna/.test(r.reason)), JSON.stringify(results));
}

try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
