// Stage a monthly data refresh for an existing map as a *proposed update* (P5).
//
// This is the CENTRAL-PIPELINE entry point: after you (expertly, elsewhere)
// regenerate a town's data for the new month, run this to offer it to the
// customer. It does NOT touch the live map — it stages the fresh payload beside
// it and computes a plain-language diff of what changed. The customer then
// reviews an old-vs-new preview in the portal and Accepts (re-applies their
// overrides as a new major version) or Declines.
//
//   node scripts/propose-update.mjs --map st-ives --src "<fresh S5-render dir>" \
//        [--note "BODS August 2026 refresh"] [--no-notify]
//
// --map is a slug or numeric map id; --src must carry gen_internal.js /
// gen_external.js + the *.json inputs (a Buses ".../S5-render/vX_..." folder).
// A newer refresh supersedes any still-pending one for the same map.
//
// --no-notify stages the update WITHOUT emailing the customer (buses-data
// OA-152). A multi-map round otherwise sends one near-identical notice per map
// — the 2026-08-28 round put 18 in one inbox — and there was no way to rehearse
// a delivery against a real customer record without mailing them. deliver-map.mjs
// forwards the flag unchanged, and scripts/notify-update-round.mjs ends the round
// with one digest per customer. The update is staged exactly as without it; only
// step 4 is skipped, and the run says so.
//
// --dry-run (buses-data OA-228) runs every refusal above the first write — the
// map, its built data, --src, the payload's shape, the live routes.json — and
// then says what it WOULD do: the pending update it would supersede, the files it
// would stage, the service-facts and landmarks diff (computed against --src,
// which is what the staged JSON is copied from), and whether the customer would
// be emailed. It writes no row, no folder and no file, and emails nobody. It
// takes cli.mjs's confirm('remote'): the default is still to stage, because a
// script that suddenly stops writing is how a delivery round becomes a silent
// no-op.

import { cpSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMap, getMapBySlug, getCustomer, getOpenProposedForMap, supersedePendingProposed,
  insertProposedUpdate, setProposedDataDir, setProposedSummary,
} from '../src/db/index.js';
import { ensureProposedDirs, mapDataDir, BASE_OVERRIDES, BUILD_WARNINGS, writeSheetDeclaration } from '../src/maps/store.js';
import { dataChangeSummary } from '../src/refresh/index.js';
import { notify, appUrl, isManaged } from '../src/email/notify.js';
import { arg, has, confirm } from './lib/cli.mjs';


const mapRef = arg('map');
const src = arg('src');
const noNotify = has('no-notify');
const { dryRun } = confirm('remote');
if (!mapRef || !src) {
  console.error('Usage: node scripts/propose-update.mjs --map <slug|id> --src "<fresh render dir>" [--note "..."] [--no-notify] [--dry-run]');
  process.exit(2);
}

// Resolve the map (numeric id or slug).
const map = /^\d+$/.test(mapRef) ? getMap(Number(mapRef)) : getMapBySlug(mapRef);
if (!map) { console.error(`✗ no map matching "${mapRef}"`); process.exit(1); }
if (!map.current_version_id || !map.data_dir) {
  console.error(`✗ map "${map.slug}" (#${map.id}) has no built data yet — nothing to refresh.`);
  process.exit(1);
}

const SRC = path.resolve(src);
if (!existsSync(SRC)) { console.error(`✗ --src not found: ${SRC}`); process.exit(1); }

// Validate the fresh payload for the map's kind. Area maps carry their generators
// in src; place maps are staged with the vendored place engine (engine/place/), so
// the src only needs its inputs (routes.json + place.json).
const PLACE_ENGINE_DIR = fileURLToPath(new URL('../engine/place', import.meta.url));
const PLACE_GENS = ['gen_internal.js', 'gen_internal_place.js', 'gen_external_places.js'];
const AREA_GENS = ['gen_internal.js', 'gen_external.js'];
const isPlace = map.kind === 'place';
if (isPlace) {
  if (!existsSync(path.join(SRC, 'routes.json')) || !existsSync(path.join(SRC, 'place.json'))) {
    console.error('✗ --src is not a place payload (needs routes.json + place.json).');
    process.exit(3);
  }
} else if (!AREA_GENS.some((g) => existsSync(path.join(SRC, g)))) {
  console.error(`✗ --src carries none of the area generators (${AREA_GENS.join(', ')}).`);
  process.exit(3);
}

const liveData = mapDataDir(map.id);
if (!existsSync(path.join(liveData, 'routes.json'))) {
  console.error(`✗ live data for "${map.slug}" is missing routes.json at ${liveData}`);
  process.exit(1);
}

// Which files of --src get staged: the *.json inputs plus the generators. A
// shipped overrides.json is EXPERT framing, staged as base-overrides.json below.
// See import-map.mjs: build-warnings.txt is the engine's verdict on this build
// and travels with it (OA-046). swapInProposedData() makes the staged folder the
// live data on accept, so it reaches the map itself from here.
const payloadFiles = () => readdirSync(SRC).filter((f) => {
  if (f === 'overrides.json' || f === BASE_OVERRIDES) return false; // framing handled below / never stage stale
  return /^gen_.*\.js$/.test(f) || f === BUILD_WARNINGS || (f.endsWith('.json') && !f.endsWith('.bak'));
});

const n = (a) => (a && a.length ? a.length : 0);
const lmName = (p) => String((p && p.name) || '').trim() || `(unnamed ${(p && p.cat) || '?'})`;
function printSummary(summary) {
  if (summary.unchanged) {
    console.log('    changes: none detected (the service facts and the landmark list are identical).');
  } else {
    if (n(summary.routesAdded)) console.log(`    routes added:   ${summary.routesAdded.join(', ')}`);
    if (n(summary.routesRemoved)) console.log(`    routes removed: ${summary.routesRemoved.join(', ')}`);
    if (n(summary.descChanged)) console.log(`    descriptions changed: ${summary.descChanged.map((d) => d.id).join(', ')}`);
    if (n(summary.stopsChanged)) console.log(`    stops changed:  ${summary.stopsChanged.map((s) => `${s.id} (+${s.added}/-${s.removed})`).join(', ')}`);
    if (n(summary.operatorsAdded)) console.log(`    operators added:   ${summary.operatorsAdded.join(', ')}`);
    if (n(summary.operatorsRemoved)) console.log(`    operators removed: ${summary.operatorsRemoved.join(', ')}`);
    if (summary.validity) console.log(`    validity: ${summary.validity.from || '—'} → ${summary.validity.to || '—'}`);
    // OA-253 — printed here as well as shown to the customer, because whoever
    // stages the update is the one who can still act on a surprising number
    // before anybody is emailed about it.
    if (n(summary.landmarksAdded)) console.log(`    new places:     ${summary.landmarksAdded.map(lmName).join(', ')}`);
    if (n(summary.landmarksRemoved)) console.log(`    places gone:    ${summary.landmarksRemoved.map(lmName).join(', ')}`);
  }
  // Said out loud rather than left as an absence: the landmark comparison is
  // suppressed when either payload lists no POI candidates at all, and a reader
  // who is not told cannot tell that from "nothing changed".
  if (summary.landmarksKnown === false) {
    console.log('    landmarks:      NOT compared — one of the two payloads lists no POI candidates at all.');
  }
}

const prior = getOpenProposedForMap(map.id);
const note = arg('note', `Data refresh staged ${new Date().toISOString().slice(0, 10)}`);

// --dry-run stops HERE: every refusal above has run, and nothing below has.
if (dryRun) {
  const files = payloadFiles();
  const who = map.customer_name || getCustomer(map.customer_id)?.name || 'The customer';
  console.log(`dry run — a proposed update for "${map.name}" (#${map.id})`);
  console.log(`    source: ${note}`);
  if (prior) console.log(`· would supersede still-pending proposed update #${prior.id}`);
  console.log(`· would stage ${files.length} payload file(s) from ${SRC}: ${files.join(', ') || '(none)'}`);
  if (isPlace) {
    console.log(`· would add the vendored place engine: ${PLACE_GENS.join(', ')}`);
    const framing = ['overrides.json', BASE_OVERRIDES].find((f) => existsSync(path.join(SRC, f)));
    if (framing) console.log(`· would stage ${framing} as ${BASE_OVERRIDES}`);
  }
  console.log('· the diff it would store (against --src, which the staged JSON is copied from):');
  printSummary(dataChangeSummary(liveData, SRC));
  if (noNotify) console.log('· would email nobody: --no-notify was given.');
  else if (isManaged(map.customer_id)) console.log(`· would email nobody: "${who}" is a managed customer.`);
  else console.log(`· would email "${who}" that the update is waiting (update-ready).`);
  console.log(`\ndry run complete — nothing staged for "${map.name}"; no row, no folder, no email.`);
  process.exit(0);
}

// A newer refresh replaces any still-pending one (only one open per map).
if (prior) {
  supersedePendingProposed(map.id);
  console.log(`· superseded still-pending proposed update #${prior.id}`);
}

// 1) Row first, so we can name the staging folder after its id.
const pid = insertProposedUpdate({ map_id: map.id, source_note: note });
const stagedData = ensureProposedDirs(map.id, pid);

// 2) Stage the payload (payloadFiles() above). Area maps carry their generators
//    in src; place maps get the vendored engine (engine/place/).
let copied = 0;
for (const f of payloadFiles()) {
  cpSync(path.join(SRC, f), path.join(stagedData, f));
  copied++;
}
if (isPlace) {
  for (const g of PLACE_GENS) { cpSync(path.join(PLACE_ENGINE_DIR, g), path.join(stagedData, g)); copied++; }
  // Expert framing: overrides.json (fresh skill payload) or base-overrides.json
  // (a live-derived payload) — stage whichever is present.
  const framing = [path.join(SRC, 'overrides.json'), path.join(SRC, BASE_OVERRIDES)].find(existsSync);
  if (framing) cpSync(framing, path.join(stagedData, BASE_OVERRIDES));
}
// What this payload declares it has (OA-009) — re-read from THIS delivery, not
// carried over from the live one, because a refresh is exactly when the set of
// sheets can change. See writeSheetDeclaration() in src/maps/store.js.
const declared = writeSheetDeclaration(stagedData, SRC);
console.log(`· staged ${copied} payload files → ${stagedData}`);
if (declared) console.log(`· payload declares ${declared.length} sheet(s): ${declared.join(', ')}`);
else console.warn('· note: --src holds no sheet SVGs, so this payload declares nothing — renderability falls back to which generators resolve');

// 3) Diff the service facts (what the customer will see), and store it.
const summary = dataChangeSummary(liveData, stagedData);
setProposedDataDir(pid, stagedData);
setProposedSummary(pid, summary);

// --- readable report ---
console.log(`\n✓ proposed update #${pid} staged for "${map.name}" (#${map.id})`);
console.log(`    source: ${note}`);
printSummary(summary);
console.log(`\n  The customer reviews + accepts it at:  /app/maps/${map.id}`);

// 4) Tell them it is there (findings B2). Staging used to be silent: the update
// sat in the portal until somebody happened to sign in, which is how one can
// sit for weeks. Skipped without EMAIL_PROVIDER, and never fatal — the update
// is staged either way, so a mail failure must not fail this run.
if (noNotify) {
  console.log(`  No email sent: --no-notify was given. "${map.customer_name || 'The customer'}" has not been told this update is waiting.`);
  console.log(`  At the end of the round, one email per customer: node scripts/notify-update-round.mjs --map ${map.slug},<the round's other slugs>`);
  process.exit(0);
}
// A managed customer hears from Peter, never from the portal (buses-data
// OA-468): the same as --no-notify, and said as plainly.
if (isManaged(map.customer_id)) {
  console.log(`  No email sent: "${map.customer_name || 'The customer'}" is a managed customer — Peter writes to them himself (the refresh letter).`);
  process.exit(0);
}
const mailed = await notify('update-ready', {
  customerId: map.customer_id,
  mapName: map.name, sourceNote: note,
  mapUrl: appUrl(`/app/maps/${map.id}`),
});
console.log(mailed.sent
  ? `  Emailed ${mailed.sent} person${mailed.sent === 1 ? '' : 's'} at "${map.customer_name || 'the customer'}".`
  : '  No email sent (no EMAIL_PROVIDER, or nobody with a deliverable address).');
process.exit(0);
