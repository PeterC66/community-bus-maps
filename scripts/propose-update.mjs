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
//        [--note "BODS August 2026 refresh"]
//
// --map is a slug or numeric map id; --src must carry gen_internal.js /
// gen_external.js + the *.json inputs (a Buses ".../S5-render/vX_..." folder).
// A newer refresh supersedes any still-pending one for the same map.

import { cpSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  getMap, getMapBySlug, getOpenProposedForMap, supersedePendingProposed,
  insertProposedUpdate, setProposedDataDir, setProposedSummary,
} from '../src/db/index.js';
import { ensureProposedDirs, mapDataDir } from '../src/maps/store.js';
import { dataChangeSummary } from '../src/refresh/index.js';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const mapRef = arg('map');
const src = arg('src');
if (!mapRef || !src) {
  console.error('Usage: node scripts/propose-update.mjs --map <slug|id> --src "<fresh render dir>" [--note "..."]');
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

// Only the AREA engine is vendored; a src without the portal generators is a
// place map (different engine, not re-homed yet) — refuse rather than stage junk.
const PORTAL_GENS = ['gen_internal.js', 'gen_external.js'];
if (!PORTAL_GENS.some((g) => existsSync(path.join(SRC, g)))) {
  console.error(`✗ --src carries none of the portal generators (${PORTAL_GENS.join(', ')}). Looks like a place map — not supported yet.`);
  process.exit(3);
}

const liveData = mapDataDir(map.id);
if (!existsSync(path.join(liveData, 'routes.json'))) {
  console.error(`✗ live data for "${map.slug}" is missing routes.json at ${liveData}`);
  process.exit(1);
}

// A newer refresh replaces any still-pending one (only one open per map).
const prior = getOpenProposedForMap(map.id);
if (prior) {
  supersedePendingProposed(map.id);
  console.log(`· superseded still-pending proposed update #${prior.id}`);
}

// 1) Row first, so we can name the staging folder after its id.
const note = arg('note', `Data refresh staged ${new Date().toISOString().slice(0, 10)}`);
const pid = insertProposedUpdate({ map_id: map.id, source_note: note });
const stagedData = ensureProposedDirs(map.id, pid);

// 2) Stage the payload: generators + every *.json input (the generator rebuilds
//    the SVG/JPG outputs, so we don't copy those or the raw timetable HTML).
let copied = 0;
for (const f of readdirSync(SRC)) {
  const keep = /^gen_.*\.js$/.test(f) || (f.endsWith('.json') && !f.endsWith('.bak'));
  if (!keep) continue;
  cpSync(path.join(SRC, f), path.join(stagedData, f));
  copied++;
}
console.log(`· staged ${copied} payload files → ${stagedData}`);

// 3) Diff the service facts (what the customer will see), and store it.
const summary = dataChangeSummary(liveData, stagedData);
setProposedDataDir(pid, stagedData);
setProposedSummary(pid, summary);

// --- readable report ---
const n = (a) => (a && a.length ? a.length : 0);
console.log(`\n✓ proposed update #${pid} staged for "${map.name}" (#${map.id})`);
console.log(`    source: ${note}`);
if (summary.unchanged) {
  console.log('    changes: none detected (the service facts are identical).');
} else {
  if (n(summary.routesAdded)) console.log(`    routes added:   ${summary.routesAdded.join(', ')}`);
  if (n(summary.routesRemoved)) console.log(`    routes removed: ${summary.routesRemoved.join(', ')}`);
  if (n(summary.descChanged)) console.log(`    descriptions changed: ${summary.descChanged.map((d) => d.id).join(', ')}`);
  if (n(summary.stopsChanged)) console.log(`    stops changed:  ${summary.stopsChanged.map((s) => `${s.id} (+${s.added}/-${s.removed})`).join(', ')}`);
  if (n(summary.operatorsAdded)) console.log(`    operators added:   ${summary.operatorsAdded.join(', ')}`);
  if (n(summary.operatorsRemoved)) console.log(`    operators removed: ${summary.operatorsRemoved.join(', ')}`);
  if (summary.validity) console.log(`    validity: ${summary.validity.from || '—'} → ${summary.validity.to || '—'}`);
}
console.log(`\n  The customer reviews + accepts it at:  /app/maps/${map.id}`);
process.exit(0);
