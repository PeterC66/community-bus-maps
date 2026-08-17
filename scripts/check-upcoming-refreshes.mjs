// Cross-reference the Buses side's monthly "get ahead" GTFS scan against the
// portal's own maps, and flag any LIVE map (built, owned by any customer —
// demo or real, Path A from the "External maps feature planning" plan) whose
// town/place has upcoming service changes.
//
// This does NOT call propose-update.mjs automatically: gtfs_upcoming.py only
// mines the GTFS feed for changes not yet reflected in the SHIPPED LEAFLET —
// it does not regenerate one. Actually refreshing a map still needs a human
// (+ Claude) to re-run the make-bus-leaflet/make-place-bus-leaflet skill for
// that town and produce a fresh S5-render dir, which is exactly the judgement
// work docs/R4-update-cycle.md (R4) already describes. What this script
// automates is the OTHER half: turning "a human reads upcoming-report_*.md
// and remembers which of those towns have portal maps" into a queued flag —
// reusing the existing admin Messages inbox, no new UI.
//
// It also (P8) auto-suggests each hit map's public "changes coming" banner —
// see setMapBannerNoteAuto in src/db/index.js, which refuses to overwrite a
// note an admin/customer has since edited by hand.
//
//   node scripts/check-upcoming-refreshes.mjs [--report "<path to upcoming-report_*.md>"]
//
// Without --report, the newest upcoming-report_<date>.md under
// "<BUSES_DIR>/_gtfs/upcoming/" is used (BUSES_DIR defaults the same way
// scripts/seed-demo.mjs does). Safe to run repeatedly: a map already flagged
// for a given report date is not flagged again (checked against existing
// 'refresh-flag' messages).

import { existsSync, readFileSync } from 'node:fs';
import { listMaps, listMessages, insertMessage, setMapBannerNoteAuto } from '../src/db/index.js';
import { newestReportPath, reportDateOf, parseSections, bannerNoteFor, reportHasPlaces, mapsForSection, mapsForSectionLegacy, unscannedPlaceMaps } from './lib/upcoming-report.mjs';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const reportPath = arg('report') || newestReportPath();
if (!reportPath || !existsSync(reportPath)) {
  console.error(`✗ no upcoming-report_*.md found (looked under BUSES_DIR/_gtfs/upcoming/; pass --report to point at one explicitly).`);
  process.exit(1);
}
const reportDate = reportDateOf(reportPath);
const sections = parseSections(readFileSync(reportPath, 'utf8'));
if (!sections.length) {
  console.log(`No actionable town or place sections found in ${reportPath} — nothing to check.`);
  process.exit(0);
}

const maps = listMaps().filter((m) => m.cur_key); // only maps that have actually been built
const existing = listMessages().filter((m) => m.kind === 'refresh-flag');
const alreadyFlagged = (mapId) => existing.some((m) => m.map_id === mapId && m.body.includes(`report ${reportDate}`));

// A report that names places joins exactly, per kind (see mapsForSection). Only a
// pre-places report falls back to the old town-substring rule — on a report that
// has place sections, that rule attributes a place's flag AND its public banner to
// its town's section instead of its own.
const hasPlaces = reportHasPlaces(sections);
const mapsFor = (section) => (hasPlaces ? mapsForSection : mapsForSectionLegacy)(maps, section);

let flagged = 0, skippedNoMap = 0, skippedDuplicate = 0, bannered = 0;
const unmatchedPlaces = [];
for (const section of sections.filter((s) => s.actionable)) {
  const { name, kind, parent, upcoming, toVerify, bullets } = section;
  const hits = mapsFor(section);
  if (!hits.length) {
    skippedNoMap++;
    // A place section with no map is worth naming: the usual cause is the portal
    // map's name drifting from the place folder's, which the exact join can't see
    // through. Silence there would look identical to "nothing to do".
    if (kind === 'place') unmatchedPlaces.push(name);
    continue;
  }
  const bulletsText = bullets.join('\n');
  const verify = toVerify ? `, ${toVerify} to verify` : '';
  const skill = kind === 'place' ? 'make-place-bus-leaflet' : 'make-bus-leaflet';
  const where = kind === 'place' && parent ? `${name} (place, in ${parent})` : name;
  const banner = bannerNoteFor(bullets);
  for (const m of hits) {
    if (banner && setMapBannerNoteAuto(m.id, banner)) bannered++;
    if (alreadyFlagged(m.id)) { skippedDuplicate++; continue; }
    const text = `Upcoming bus changes for ${where} (report ${reportDate}): ${upcoming} upcoming${verify}.\n\n${bulletsText}\n\n` +
      `This map ("${m.name}", ${m.customer_name || 'unowned'}) may need a refresh. Re-run the ` +
      `${skill} skill for ${name} to produce a fresh render, then:\n` +
      `  node scripts/propose-update.mjs --map ${m.slug} --src "<fresh S5-render dir>"`;
    insertMessage({ kind: 'refresh-flag', body: text, map_id: m.id });
    flagged++;
    console.log(`· flagged map "${m.slug}" (#${m.id}, ${m.customer_name || 'unowned'}) — ${where}: ${upcoming} upcoming${verify}`);
  }
}

console.log(`\n${flagged} flag(s) queued in the admin Messages inbox, ${skippedDuplicate} already flagged for this report, ${skippedNoMap} section(s) with no matching portal map, ${bannered} public banner(s) set/refreshed.`);
if (unmatchedPlaces.length) {
  console.log(`⚠ ${unmatchedPlaces.length} place section(s) matched no portal map by name — check for a name mismatch: ${unmatchedPlaces.join(', ')}`);
}

// The reverse gap, and the more dangerous one: a live place map the scan never
// looked at, whose silence reads exactly like good news.
const unscanned = unscannedPlaceMaps(sections, maps);
if (unscanned.length) {
  console.log(`⚠ ${unscanned.length} live place map(s) absent from this report — NOT scanned, which is not the same as "no changes": ${unscanned.map((m) => m.slug).join(', ')}`);
  console.log('  Each needs a built place folder of the same name under Areas/<Town>/Places/ or Places/ for the monthly scan to see it.');
}
if (flagged) console.log('Review at /app/admin (Messages tab) — each entry names the map and the propose-update.mjs command to run once a fresh render exists.');
