// P9 Part B B7 — place-name search checks.
//
//   node scripts/test-search.mjs          (or: npm run test:search)
//
// Runs against a throwaway DATA_DIR (never the real portal data), seeding
// maps directly through the same db functions test-p6.mjs uses, then writing
// the routes.json a real map would carry and calling the same sidecar writer
// the approve handler calls (src/search/place-index.js). This proves the
// search endpoint's *access control* — a draft or an unlisted map's place
// names must never surface — without spinning up HTTP.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-search-'));
process.env.DATA_DIR = scratch;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const db = await import('../src/db/index.js');
const { mapDataDir, versionDir } = await import('../src/maps/store.js');
const { writePlacesSidecar } = await import('../src/search/place-index.js');
const { searchPlaces: rawSearch, bumpSearchIndex } = await import('../src/search/index.js');
// Most checks below only care about the matches, not the typo-tolerance
// metadata — this is the array-returning shape the old tests used.
const searchPlaces = (q) => rawSearch(q).results;

const areaRoutesJson = (label, stops) => ({
  external: [{ route: 'B', label, stops }],
});

/** Seed one map, optionally publishing it and writing its sidecar, mirroring
 * what the approve handler does in src/server.js. Returns { id, versionId, storageKey }. */
function seedMap({ customerId, slug, kind = 'area', subject = '', destination, stops = [],
  publish = true, listed = true, storageKey = 'v1.0' }) {
  const id = db.insertMap({ customer_id: customerId, slug, name: slug, kind, subject, data_dir: `maps/${slug}`, status: publish ? 'published' : 'draft' });
  const versionId = db.insertVersion({ map_id: id, major: 1, minor: 0, storage_key: storageKey, overrides: {} });
  db.setCurrentVersion(id, versionId);
  if (!listed) db.setMapPublicListed(id, false);

  const dataDir = mapDataDir(id);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'routes.json'), JSON.stringify(areaRoutesJson(destination, stops)));

  if (publish) {
    // A public page needs at least one output file on disk (src/public/index.js
    // publicOutputs()) — a stub SVG is enough, no generator run.
    const dir = versionDir(id, storageKey);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'internal.svg'), '<svg/>');
    db.setVersionState(versionId, 'published');
    db.setPublishedVersion(id, versionId);
    db.setMapStatus(id, 'published');
    writePlacesSidecar(id, storageKey, { kind, subject });
  }
  bumpSearchIndex();
  return { id, versionId, storageKey };
}

const activeCustomer = db.insertCustomer({ name: 'Search Test Council' });
const demoCustomer = db.insertCustomer({ name: 'Search Test Sample Org', is_demo: true });

console.log('\naccess control — only published, listed maps of active customers are searchable');
{
  seedMap({ customerId: activeCustomer, slug: 'search-a', subject: 'Search Town A', destination: 'Search Town A', stops: ['Findable Village'] });
  seedMap({ customerId: activeCustomer, slug: 'search-unlisted', subject: 'Search Town B', destination: 'Search Town B', stops: ['Hidden Unlisted Village'], listed: false });
  seedMap({ customerId: activeCustomer, slug: 'search-draft', subject: 'Search Town C', destination: 'Search Town C', stops: ['Hidden Draft Village'], publish: false });

  const foundListed = searchPlaces('Findable Village');
  check('a listed map\'s intermediate stop is searchable', foundListed.some((r) => r.map.slug === 'search-a'));

  const foundUnlisted = searchPlaces('Hidden Unlisted Village');
  check('an unlisted map\'s place names are NOT searchable', foundUnlisted.length === 0, JSON.stringify(foundUnlisted));

  const foundDraft = searchPlaces('Hidden Draft Village');
  check('an unpublished draft\'s place names are NOT searchable', foundDraft.length === 0, JSON.stringify(foundDraft));

  // Re-listing must make it searchable again once the index is bumped (B4).
  db.setMapPublicListed(db.getMapBySlug('search-unlisted').id, true);
  bumpSearchIndex();
  const foundAfterRelist = searchPlaces('Hidden Unlisted Village');
  check('re-listing restores searchability after a bump', foundAfterRelist.some((r) => r.map.slug === 'search-unlisted'));
}

console.log('\nthe "why" — an intermediate stop names its route');
{
  const hit = searchPlaces('Findable Village').find((r) => r.map.slug === 'search-a');
  check('a known intermediate stop returns its map', !!hit);
  check('the reason names the route it is on', !!hit && hit.reason.includes('Route B') && hit.reason.includes('Findable Village'), hit && hit.reason);
}

console.log('\nrevert changes the index');
{
  seedMap({ customerId: activeCustomer, slug: 'search-revert', subject: 'Revert Town', destination: 'Revert Town', stops: ['Old Route Village'], storageKey: 'v1.0' });
  const revertMap = db.getMapBySlug('search-revert');

  check('the original version\'s place is searchable', searchPlaces('Old Route Village').some((r) => r.map.slug === 'search-revert'));

  // A refresh publishes a second version with a different stop list — the
  // outgoing version keeps its own places.json (v1.0's sidecar untouched).
  const v2Id = db.insertVersion({ map_id: revertMap.id, major: 2, minor: 0, storage_key: 'v2.0', overrides: {} });
  mkdirSync(path.join(mapDataDir(revertMap.id)), { recursive: true });
  writeFileSync(path.join(mapDataDir(revertMap.id), 'routes.json'), JSON.stringify(areaRoutesJson('Revert Town', ['New Route Village'])));
  const v2Dir = versionDir(revertMap.id, 'v2.0');
  mkdirSync(v2Dir, { recursive: true });
  writeFileSync(path.join(v2Dir, 'internal.svg'), '<svg/>');
  db.setVersionState(revertMap.published_version_id, 'superseded');
  db.setVersionState(v2Id, 'published');
  db.setPublishedVersion(revertMap.id, v2Id);
  writePlacesSidecar(revertMap.id, 'v2.0', { kind: 'area', subject: 'Revert Town' });
  bumpSearchIndex();

  check('after publishing v2, the NEW stop is searchable', searchPlaces('New Route Village').some((r) => r.map.slug === 'search-revert'));
  check('after publishing v2, the OLD stop is no longer searchable', searchPlaces('Old Route Village').length === 0);

  // Revert the pointer back to v1.0 — its sidecar was never rewritten, so the
  // index just needs a bump (no re-render, matching src/server.js's revert route).
  db.setVersionState(v2Id, 'superseded');
  db.setVersionState(revertMap.current_version_id, 'published'); // v1.0
  db.setPublishedVersion(revertMap.id, revertMap.current_version_id);
  bumpSearchIndex();

  check('after reverting, the OLD stop is searchable again', searchPlaces('Old Route Village').some((r) => r.map.slug === 'search-revert'));
  check('after reverting, the NEW stop is no longer searchable', searchPlaces('New Route Village').length === 0);
}

console.log('\na demo org\'s result still carries isDemo');
{
  seedMap({ customerId: demoCustomer, slug: 'search-demo', subject: 'Demo Town', destination: 'Demo Town', stops: ['Demo Sample Village'] });
  const hit = searchPlaces('Demo Sample Village').find((r) => r.map.slug === 'search-demo');
  check('the demo map is found', !!hit);
  check('org.isDemo is true for a seeded demo organisation', !!hit && hit.map.org.isDemo === true);
}

console.log('\ntypo tolerance — only kicks in when the exact pass finds nothing');
{
  seedMap({ customerId: activeCustomer, slug: 'search-typo', subject: 'Typotown', destination: 'Typotown', stops: ['Swavesey'] });

  const exact = rawSearch('Swavesey');
  check('an exact spelling matches with no "corrected" flag', exact.results.some((r) => r.map.slug === 'search-typo'));
  check('...and corrected is null when the exact pass already found something', exact.corrected === null);

  const oneOff = rawSearch('Swavessey'); // one extra letter
  check('a one-letter typo still finds the map', oneOff.results.some((r) => r.map.slug === 'search-typo'), JSON.stringify(oneOff));
  check('...and reports what it corrected to', oneOff.corrected === 'Swavesey', oneOff.corrected);

  const destTypo = rawSearch('Typotwon'); // transposed letters, matches the destination/map name
  check('a typo in the map/destination name still finds it', destTypo.results.some((r) => r.map.slug === 'search-typo'), JSON.stringify(destTypo));

  const tooGarbled = rawSearch('Sxxxxxey'); // beyond the distance budget for an 8-char word
  check('a query too garbled to be "probably the same word" still misses', !tooGarbled.results.some((r) => r.map.slug === 'search-typo'), JSON.stringify(tooGarbled));

  const shortWord = rawSearch('Swx'); // 3-char word — maxTypos(3) === 0, no fuzzy leeway
  check('short words get no fuzzy leeway (avoids matching unrelated 3-letter words)', shortWord.results.length === 0, JSON.stringify(shortWord));
}

// ---------------------------------------------------------------------------
// A STREET IS NOT A PLACE (buses-data OA-311). Every case below is a real name
// off the live index on 2026-09-11, and the first two are the fault Peter found
// within the hour of OA-308 tier 2 going out: searching "York" returned three
// Buckinghamshire sheets because route 104 passes along York Road (UB8), and
// "London" returned three more because of London Road.
console.log('\na thoroughfare answers only to its whole name');
{
  seedMap({
    customerId: activeCustomer, slug: 'search-streets', subject: 'Street Town',
    destination: 'Street Town',
    stops: ['York Road (UB8)', 'London Road', 'Chessmount Rise', 'Hemingford Grey', 'Bar Hill', 'Bourne End'],
  });
  // Bar Hill and Bourne End are VILLAGES whose names end in street types. Each
  // is a destination on another map in the estate, and that is the only thing
  // telling this index they are places — the whole point of the knownPlaces
  // exemption.
  seedMap({
    customerId: activeCustomer, slug: 'search-barhill', subject: 'Bar Hill',
    destination: 'Bar Hill', stops: ['Somewhere Else'],
  });
  seedMap({
    customerId: activeCustomer, slug: 'search-bourne', subject: 'Bourne End',
    destination: 'Bourne End', stops: ['Another Stop'],
  });

  check('"York" no longer returns a map whose only link is York Road',
    !searchPlaces('York').some((r) => r.map.slug === 'search-streets'),
    JSON.stringify(searchPlaces('York').map((r) => r.reason)));
  check('"London" no longer returns a map whose only link is London Road',
    !searchPlaces('London').some((r) => r.map.slug === 'search-streets'),
    JSON.stringify(searchPlaces('London').map((r) => r.reason)));
  check('a bracketed qualifier does not save the street from the rule — "York Road" still finds it',
    searchPlaces('York Road').some((r) => r.map.slug === 'search-streets'),
    'the whole name must still match: a reader checking whether their own road is on a map');
  check('the whole name of a plain street matches too',
    searchPlaces('Chessmount Rise').some((r) => r.map.slug === 'search-streets'));
  check('one word of a street name does not', searchPlaces('Chessmount').length === 0);

  // The villages. If any of these four go red the rule has eaten real places,
  // which is a worse fault than the one it fixes.
  check('"Hemingford" still finds Hemingford Grey — a place, not a street',
    searchPlaces('Hemingford').some((r) => r.map.slug === 'search-streets'));
  check('"Bar Hill" still finds the map that passes through it',
    searchPlaces('Bar Hill').some((r) => r.map.slug === 'search-streets'),
    'Bar Hill ends in a street type and is exempt because it is a destination elsewhere');
  check('…and the map it is the subject of', searchPlaces('Bar Hill').some((r) => r.map.slug === 'search-barhill'));
  // THIS is the check the exemption exists for, and finding that out took a
  // falsification run: with the exemption deleted, "Bar Hill" and "Bourne End"
  // still matched IN FULL, so every other case here stayed green and the
  // exemption looked like decoration. What it actually buys is the PARTIAL
  // query — somebody typing the first word of the village they live in.
  check('"Bourne" finds Bourne End, because a village is not a street',
    searchPlaces('Bourne').some((r) => r.map.slug === 'search-streets'),
    JSON.stringify(searchPlaces('Bourne').map((r) => r.map.slug)));
  check('a typo on a street name gets no second chance either',
    searchPlaces('Yorkk Road').length === 0,
    'the fuzzy pass must not reopen what the exact pass closed');
}

console.log('\nsanity — an unrelated query still misses cleanly');
check('a nonsense query returns no results', searchPlaces('zzznotarealplacezzz').length === 0);
check('a one-character query is rejected (below MIN_QUERY_LEN)', searchPlaces('a').length === 0);

console.log('\ncheck-chrome.mjs still passes (A1)');
{
  try {
    execFileSync(process.execPath, [path.resolve(import.meta.dirname, 'check-chrome.mjs')], { stdio: 'pipe' });
    check('nav/footer markers unchanged across public/*.html', true);
  } catch (e) {
    check('nav/footer markers unchanged across public/*.html', false, e.stdout ? e.stdout.toString() : e.message);
  }
}

try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all search checks passed');
process.exit(failures ? 1 : 0);
