// Joining the Buses side's monthly scan to portal maps.
//
//   node scripts/test-upcoming-join.mjs        (or: npm run test:upcoming-join)
//
// Three things here are worth pinning down, because each one failed silently
// rather than loudly before it was fixed:
//
//   1. MIS-ATTRIBUTION, which reaches the public. Place maps used to be matched
//      to their TOWN's section by substring on map.subject ("Aldi, Tannery Road,
//      High Wycombe" contains "High Wycombe"). Duplicate flags were never the
//      risk — messages are deduped per map per report date — but the matched
//      section also seeds the map's PUBLIC "changes coming" banner. On the real
//      2026-08-17 report that made the Aldi map advertise "[NEW] WW1", a service
//      that does not serve it. The legacy assertions below prove the old rule
//      really did produce that banner, so the fix is measured against a check
//      that can fail rather than one that was always green.
//   2. A "to verify"-only section. The verdict "2 to verify" (0 actionable, some
//      [ENDS?]) did not match the old heading regex, so the section vanished. A
//      possible withdrawal is exactly the advance notice this scan exists for.
//   3. COVERAGE. A place section must match its own map, and a town section must
//      no longer reach any place map.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-upcoming-'));
process.env.DATA_DIR = scratch;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { parseSections, reportHasPlaces, mapsForSection, mapsForSectionLegacy, sectionsForMap, bannerNoteFor,
  unscannedPlaceMaps } = await import('./lib/upcoming-report.mjs');

// A report in the shape gtfs_upcoming.py now writes: a town, that town's place,
// and a town whose only findings are "to verify". CRLF on purpose — the real
// files are written on Windows.
const REPORT = [
  '# Upcoming bus changes — get ahead of the game',
  '',
  '## High Wycombe — 3 upcoming',
  '_region buckinghamshire_',
  '- **[NEW] WW1** — not currently running; service registered to start 2026-08-31',
  '- **[CHANGE] M40** — already running; service registered to start 2026-09-06',
  '- **[CHANGE] X74** — already running; service registered to start 2026-09-06',
  '',
  '## High Wycombe Aldi — 2 upcoming',
  '_kind place · region buckinghamshire · town High Wycombe · radius 0.8 km_',
  '- **[CHANGE] M40** — already running; service registered to start 2026-09-06',
  '- **[CHANGE] X74** — already running; service registered to start 2026-09-06',
  '',
  '## St Ives — 1 to verify',
  '_region cambridgeshire_',
  '- **[ENDS?] 21** — registered service runs out 2026-10-01 with nothing beyond',
  '',
  '## St Neots — nothing upcoming',
  '_region cambridgeshire_',
  '- No upcoming changes detected in the current feed.',
  '',
  '## Not checked — dataset unavailable',
  '- **Somewhere** — region not registered',
  '',
].join('\r\n');

const MAPS = [
  { id: 1, kind: 'area', name: 'High Wycombe', slug: 'high-wycombe', subject: 'High Wycombe, Buckinghamshire' },
  { id: 2, kind: 'place', name: 'High Wycombe Aldi', slug: 'highwycombe-aldi', subject: 'Aldi, Tannery Road, High Wycombe' },
  { id: 3, kind: 'area', name: 'St Ives', slug: 'st-ives', subject: 'St Ives, Cambridgeshire' },
  { id: 4, kind: 'place', name: 'St Ives Waitrose', slug: 'st-ives-waitrose', subject: 'Waitrose, St Ives' },
];

const sections = parseSections(REPORT);
const byName = (n) => sections.find((s) => s.name === n);
const live = () => sections.filter((s) => s.actionable).map((s) => s.name);

console.log('parsing');
eq('every scanned unit is returned, "Not checked" is not',
  sections.map((s) => s.name), ['High Wycombe', 'High Wycombe Aldi', 'St Ives', 'St Neots']);
eq('…and `actionable` marks the ones with something to report',
  live(), ['High Wycombe', 'High Wycombe Aldi', 'St Ives']);
check('a quiet unit is kept so "scanned and clear" ≠ "never scanned"', !byName('St Neots').actionable);
check('a "to verify"-only section survives', !!byName('St Ives') && byName('St Ives').actionable);
eq('  …with 0 upcoming and its verify count', [byName('St Ives').upcoming, byName('St Ives').toVerify], ['0', '1']);
eq('place section reads its kind, parent and radius',
  [byName('High Wycombe Aldi').kind, byName('High Wycombe Aldi').parent, byName('High Wycombe Aldi').radiusKm],
  ['place', 'High Wycombe', 0.8]);
eq('town section is kind area with no parent',
  [byName('High Wycombe').kind, byName('High Wycombe').parent], ['area', null]);
check('report is detected as place-aware', reportHasPlaces(sections));
eq('back-compat: a place section still reports its town', byName('High Wycombe Aldi').town, 'High Wycombe');

console.log('mis-attribution (the bug, reproduced)');
// Under the old rule the Aldi map was matched by its TOWN's section, and its own
// section matched nothing at all.
const legacyHits = sections.filter((s) => s.actionable && mapsForSectionLegacy(MAPS, s).some((m) => m.id === 2));
eq('legacy rule attributed the Aldi map to the TOWN section', legacyHits.map((s) => s.name), ['High Wycombe']);
eq('legacy rule left the Aldi place section matching nothing',
  mapsForSectionLegacy(MAPS, byName('High Wycombe Aldi')).map((m) => m.slug), []);
check('legacy public banner for the Aldi advertised WW1, which does not serve it',
  bannerNoteFor(legacyHits.flatMap((s) => s.bullets)).includes('WW1'));

const nowHits = sections.filter((s) => s.actionable && mapsForSection(MAPS, s).some((m) => m.id === 2));
eq('exact join attributes it to its own section', nowHits.map((s) => s.name), ['High Wycombe Aldi']);
check('its public banner now names a change that does affect it',
  !bannerNoteFor(nowHits.flatMap((s) => s.bullets)).includes('WW1'));

console.log('coverage');
eq('town section no longer reaches any place map',
  mapsForSection(MAPS, byName('High Wycombe')).map((m) => m.slug), ['high-wycombe']);
eq('a place map with no section of its own is not flagged by its town',
  mapsForSection(MAPS, byName('St Ives')).map((m) => m.slug), ['st-ives']);

// The gap that replaces the old coarse coverage, and the reason the quiet
// sections are kept: st-ives-waitrose has no place folder in the Buses tree, so
// the scan never looked at it. Silence there must be reportable as a coverage
// hole, not mistaken for "no changes".
eq('a live place map absent from the report is reported as unscanned',
  unscannedPlaceMaps(sections, MAPS).map((m) => m.slug), ['st-ives-waitrose']);
eq('…and a place that WAS scanned is not called a hole',
  unscannedPlaceMaps(sections, MAPS).filter((m) => m.id === 2), []);
eq('an old report reports no holes (it lists no places to compare against)',
  unscannedPlaceMaps(parseSections(['## High Wycombe — 1 upcoming', '- **[NEW] WW1** — x', ''].join('\r\n')), MAPS), []);

console.log('banner seeding at import time');
eq('a place map seeds from its own section',
  sectionsForMap(sections, MAPS[1]).map((s) => s.name), ['High Wycombe Aldi']);
eq('an area map seeds from its own section',
  sectionsForMap(sections, MAPS[0]).map((s) => s.name), ['High Wycombe']);

// A report written before the scan knew about places: the town-substring rule is
// the only coverage a place map has there, so it must still apply.
const OLD = ['## High Wycombe — 3 upcoming', '_region buckinghamshire_', '- **[NEW] WW1** — x', ''].join('\r\n');
const oldSections = parseSections(OLD);
console.log('pre-places reports');
check('an old report is not detected as place-aware', !reportHasPlaces(oldSections));
eq('legacy join still covers the place map there',
  mapsForSectionLegacy(MAPS, oldSections[0]).map((m) => m.slug), ['high-wycombe', 'highwycombe-aldi']);
eq('sectionsForMap falls back for an old report',
  sectionsForMap(oldSections, MAPS[1]).map((s) => s.name), ['High Wycombe']);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll upcoming-join checks passed');
process.exit(failures ? 1 : 0);
