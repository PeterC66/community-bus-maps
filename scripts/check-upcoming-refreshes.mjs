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
import { newestReportPath, reportDateOf, parseSections, bannerNoteFor } from './lib/upcoming-report.mjs';

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
  console.log(`No town sections found in ${reportPath} — nothing to check.`);
  process.exit(0);
}

const maps = listMaps().filter((m) => m.cur_key); // only maps that have actually been built
const existing = listMessages().filter((m) => m.kind === 'refresh-flag');
const alreadyFlagged = (mapId) => existing.some((m) => m.map_id === mapId && m.body.includes(`report ${reportDate}`));

// Area maps match the town name exactly (map.name IS the town, e.g. "St Ives").
// Place maps have no town field of their own — match by substring on
// map.subject, which conventionally carries the town name (e.g. "Waitrose, St
// Ives", "Aldi, Tannery Road, High Wycombe"). Loose on purpose: a missed match
// just means a human catches it the old way (reading the report directly);
// a false match just means an extra "you might want to check this" message.
function mapsForTown(town) {
  const lower = town.toLowerCase();
  return maps.filter((m) => (
    m.kind === 'area' ? m.name.toLowerCase() === lower : (m.subject || '').toLowerCase().includes(lower)
  ));
}

let flagged = 0, skippedNoMap = 0, skippedDuplicate = 0, bannered = 0;
for (const { town, upcoming, toVerify, bullets } of sections) {
  const hits = mapsForTown(town);
  if (!hits.length) { skippedNoMap++; continue; }
  const bulletsText = bullets.join('\n');
  const verify = toVerify ? `, ${toVerify} to verify` : '';
  const banner = bannerNoteFor(bullets);
  for (const m of hits) {
    if (banner && setMapBannerNoteAuto(m.id, banner)) bannered++;
    if (alreadyFlagged(m.id)) { skippedDuplicate++; continue; }
    const text = `Upcoming bus changes for ${town} (report ${reportDate}): ${upcoming} upcoming${verify}.\n\n${bulletsText}\n\n` +
      `This map ("${m.name}", ${m.customer_name || 'unowned'}) may need a refresh. Re-run the ` +
      `make-bus-leaflet skill for ${town} to produce a fresh render, then:\n` +
      `  node scripts/propose-update.mjs --map ${m.slug} --src "<fresh S5-render dir>"`;
    insertMessage({ kind: 'refresh-flag', body: text, map_id: m.id });
    flagged++;
    console.log(`· flagged map "${m.slug}" (#${m.id}, ${m.customer_name || 'unowned'}) — ${town}: ${upcoming} upcoming${verify}`);
  }
}

console.log(`\n${flagged} flag(s) queued in the admin Messages inbox, ${skippedDuplicate} already flagged for this report, ${skippedNoMap} town(s) with no matching portal map, ${bannered} public banner(s) set/refreshed.`);
if (flagged) console.log('Review at /app/admin (Messages tab) — each entry names the map and the propose-update.mjs command to run once a fresh render exists.');
