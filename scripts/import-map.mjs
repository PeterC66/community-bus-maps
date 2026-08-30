// Seed ONE map into the object store from a staged Buses run dir.
//
// P1 needs a real map to edit; this is the minimal importer (P2 generalises it
// to a multi-map, multi-customer importer). It copies a map's generators + JSON
// inputs into the git-ignored object store, records a `map` row, and renders the
// baseline as version 1.0 — with EMPTY overrides, so v1.0 is byte-identical to
// the shipped leaflet.
//
//   node scripts/import-map.mjs --src "<S5-render dir>" --name "St Ives" \
//        [--slug st-ives] [--kind area] [--subject "St Ives"] [--disagreements <pdf>]
//
// --disagreements overrides the auto-detected customer-facing PDF (normally
// found at "<TownDir>/_latest/disagreements.pdf", walked up from --src). Area
// maps only — see findDisagreementsPdf() below.
//
// --src must contain gen_internal.js / gen_external.js and their *.json inputs
// (e.g. a ".../St Ives/S5-render/v6.6_..." folder in the separate Buses repo).
//
// FULFILLING AN APPROVED REQUEST (the importer↔map-request seam). A customer's
// request creates a placeholder `map` row that an admin approves; this importer
// can BUILD THAT ROW rather than a second one:
//
//   node scripts/import-map.mjs --list-requests          # the build queue
//   node scripts/import-map.mjs --request 7 --src "<S5-render dir>"
//
// In --request mode the row's owner, kind, name, slug and subject come from the
// approved request (each overridable with the usual flag), the row moves
// 'approved' → 'draft', and the fulfilment is written to the audit log. There is
// no placeholder left to archive and quota counts the map once.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeEngineSource, ENGINE_SOURCE_FILE } from './lib/engine-source.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMapBySlug, insertMap, setMapDataDir, insertVersion, setCurrentVersion,
  getCustomerByName, insertCustomer, getMap, getCustomer, setMapStatus, setMapOutputs,
  listAwaitingBuild, updateMapIdentity, listVersions, recordAudit, setMapBannerNoteAuto,
} from '../src/db/index.js';
import { ensureMapDirs, mapDataDir, overridesPath, BASE_OVERRIDES, BUILD_WARNINGS, writeSheetDeclaration } from '../src/maps/store.js';
import { renderVersion, defaultOutputs } from '../src/maps/engine.js';
import { newestReportPath, parseSections, sectionsForMap, bannerNoteFor } from './lib/upcoming-report.mjs';
import { requireScan } from './lib/vendored.mjs';

const ORG_TYPES = ['council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt', 'other'];

/**
 * Auto-detect a town's customer-facing disagreements PDF (see gen_disagreements.py
 * in the make-bus-leaflet skill, which converts disagreements.docx -> .pdf via
 * LibreOffice). --src is normally "<TownDir>/S5-render/<run>", so walking up a
 * few levels finds "<TownDir>/_latest/disagreements.pdf" — the newest copy the
 * skill's refresh_latest.js keeps up to date. Best-effort only: an explicit
 * --disagreements path always wins, and if neither resolves the map simply
 * imports without one — it's a static extra, not a required input.
 */
function findDisagreementsPdf(srcDir) {
  let dir = srcDir;
  for (let i = 0; i < 4; i++) {
    const cand = path.join(dir, '_latest', 'disagreements.pdf');
    if (existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

// AN UNOWNED MAP CAN NEVER BE PUBLICLY VISIBLE (OA-008).
//
// listPublicMaps() and getPublicMapBySlug() both JOIN customer, which is
// deliberate — it is what makes a suspended organisation's maps disappear — and
// the same join silently drops a map whose customer_id is NULL, however
// published it is. St Ives Bus Station was imported without --customer on
// 2026-08-24, went right through submit → review → publish to v2.0, reported
// status=published and public_listed=1, and served a 404.
//
// Until 2026-08-30 this was a console.warn and the import carried on. The honest
// answer then arrived two steps later, from the accept-publish run's own public
// check: "0/1 published and verified". Refusing here is the same answer at the
// only moment it is cheap to act on. --unowned is the escape hatch, because an
// owner CAN now be set afterwards (POST /api/admin/maps/:id/owner) and a
// deliberate no-owner import is a legitimate, if rare, thing to want.
const allowUnowned = has('unowned');
function refuseUnowned(why) {
  console.error(`✗ refusing to import an unowned map: ${why}.`);
  console.error('  A map with no owning organisation is dropped by every PUBLIC query — it can be');
  console.error('  submitted, reviewed and published, report status=published, and still serve a 404.');
  console.error('  Give it an owner:  --customer "Organisation Name"  [--customer-type council|shop|…]');
  console.error('  Or import it unowned on purpose with --unowned, and set the owner later with');
  console.error('  POST /api/admin/maps/<id>/owner from the admin console.');
  process.exit(1);
}
const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// `--list-requests` just prints the build queue and exits (no --src needed).
const queue = listAwaitingBuild();
if (has('list-requests')) {
  if (!queue.length) console.log('No approved map requests are awaiting a build.');
  else {
    console.log(`Approved map requests awaiting a build (${queue.length}):\n`);
    for (const q of queue) {
      console.log(`  #${q.id}  ${q.name}  [${q.kind}]  slug: ${q.slug}`);
      console.log(`        for: ${q.customer_name || '(unowned)'}   requested by ${q.requested_by_email || '—'} on ${q.created_at}`);
      if (q.subject) console.log(`        subject: ${q.subject}`);
      if (q.request_note) console.log(`        note: ${q.request_note}`);
      console.log(`        build it:  node scripts/import-map.mjs --request ${q.id} --src "<S5-render dir>"\n`);
    }
  }
  process.exit(0);
}

const src = arg('src');
const requestArg = arg('request');
const requestId = requestArg != null ? Number(requestArg) : null;
if (requestArg != null && !Number.isInteger(requestId)) {
  console.error(`✗ --request must be a map id (an integer), got "${requestArg}". Try --list-requests.`);
  process.exit(2);
}

// Fulfilling a request: the row supplies the defaults, so --name is optional.
// Fresh import: --name is how the row gets its identity, so it is required.
let request = null;
if (requestId != null) {
  request = getMap(requestId);
  if (!request) { console.error(`✗ no map #${requestId}. Try --list-requests.`); process.exit(1); }
  if (request.status !== 'approved') {
    console.error(`✗ map #${requestId} ("${request.name}") is "${request.status}", not an approved request.`);
    console.error(request.status === 'requested'
      ? '  Approve it in the admin console first (/app/admin → Map requests) — approval is the gate.'
      : '  Only an approved, not-yet-built request can be fulfilled. Import as a fresh map instead (omit --request).');
    process.exit(1);
  }
  if (request.current_version_id || listVersions(requestId).length) {
    console.error(`✗ map #${requestId} has already been built (version ${request.cur_key || '?'}).`);
    console.error('  To ship new DATA for a built map use scripts/propose-update.mjs (the monthly refresh), not the importer.');
    process.exit(1);
  }
}

const name = arg('name', request ? request.name : undefined);
if (!src || !name) {
  console.error('Usage: node scripts/import-map.mjs --src "<run dir>" --name "<Display Name>" --customer "Org" [--slug ..] [--kind area|place] [--subject ..] [--unowned]');
  console.error('   or: node scripts/import-map.mjs --request <mapId> --src "<run dir>"   (build an approved request)');
  console.error('   or: node scripts/import-map.mjs --list-requests');
  process.exit(2);
}
// Refused HERE, before --src is even resolved, because this one needs nothing
// but the flags: the answer is knowable at the cheapest possible moment and the
// import has not yet touched a file or a row.
if (!request && !process.argv.includes('--customer') && !allowUnowned) {
  refuseUnowned('no --customer was given');
}

const SRC = path.resolve(src);
const slug = slugify(arg('slug', request && !has('slug') ? request.slug : name));
const kind = arg('kind', request ? request.kind : 'area');
const subject = arg('subject', request ? request.subject || request.name : name);
const customerName = arg('customer');
const customerType = arg('customer-type', 'other');

if (!existsSync(SRC)) { console.error(`✗ --src not found: ${SRC}`); process.exit(1); }

// A request is for a specific KIND of map (it was counted against that quota) —
// building the other kind into it would silently mis-bill the customer.
if (request && kind !== request.kind) {
  console.error(`✗ map #${requestId} was requested as a "${request.kind}" map but --kind is "${kind}".`);
  console.error('  Reject the request and ask for the right kind rather than repurposing the row (quota is per kind).');
  process.exit(1);
}

// AREA maps carry their generators per-map (they travel in the src render dir).
// PLACE maps DON'T — the make-place-bus-leaflet skill keeps one engine, not per
// map — so the portal VENDORS the place engine (engine/place/) and copies it into
// the map's data folder here. Validate the right shape for the given --kind.
const PLACE_ENGINE_DIR = fileURLToPath(new URL('../engine/place', import.meta.url));
// AREA maps fall back to the vendored area engine when the payload carries no
// generators of its own -- see engine/area/README.md. gen_internal.js is shared
// with the place engine and is vendored once, in engine/place/.
const AREA_ENGINE_DIR = fileURLToPath(new URL('../engine/area', import.meta.url));
const AREA_STYLE = ['radial', 'busway'].includes(arg('external-style'))
  ? arg('external-style') : 'radial';
const PLACE_GENS = ['gen_internal.js', 'gen_internal_place.js', 'gen_external_places.js'];
const AREA_GENS = ['gen_internal.js', 'gen_external.js'];
const isPlace = kind === 'place';
let areaFallback = null;  // [[absolutePath, copyAsName], ...] when the payload has none

// The checks below ask whether the GENERATORS are vendored. Neither can ask
// whether the modules those generators require are, and on 2026-08-26 that was
// the difference between an import that works and one that dies at render:
// gen_internal.js had started requiring lane_normals.js AT LOAD, the copy planted
// in a map's data/ has no sibling to resolve it from, and the SKILL_ASSETS arm
// points at an engine/ that had never been given the file. A half-vendored engine
// should fail HERE, naming the file, rather than three steps later as a
// MODULE_NOT_FOUND stack trace out of a spawned child.
const ENGINE_ROOT = fileURLToPath(new URL('../engine', import.meta.url));
const unresolvedModules = requireScan({ engineDir: ENGINE_ROOT });
if (unresolvedModules.length) {
  for (const r of unresolvedModules) console.error(`✗ vendored engine is missing ${r.file} — ${r.note}`);
  console.error('  Run: node scripts/vendor-engine.mjs   (then commit engine/vendored.json with it)');
  process.exit(1);
}

if (isPlace) {
  if (!existsSync(path.join(SRC, 'routes.json'))) {
    console.error(`✗ --src has no routes.json — not a place payload: ${SRC}`); process.exit(1);
  }
  if (!existsSync(path.join(SRC, 'place.json'))) {
    console.error('✗ --src has no place.json (a place map is centred on a resolved point).');
    console.error('  If this is an area/town map, pass --kind area.');
    process.exit(1);
  }
  const rj = JSON.parse(readFileSync(path.join(SRC, 'routes.json'), 'utf8'));
  if (!Array.isArray(rj.destinations) || !rj.destinations.length) {
    console.warn('· note: routes.json has no destinations[] — the external map will be empty.');
  }
  for (const g of PLACE_GENS) if (!existsSync(path.join(PLACE_ENGINE_DIR, g))) {
    console.error(`✗ vendored place engine is missing ${g} in ${PLACE_ENGINE_DIR}`); process.exit(1);
  }
} else {
  const presentGens = AREA_GENS.filter((g) => existsSync(path.join(SRC, g)));
  // A payload that carries its own generators still wins, so an older map or a
  // town with a hand-edited generator imports byte-for-byte as it always did.
  // Only when it carries NONE do we reach for the vendored engine. Before this
  // fallback existed the import simply refused, and since the skill stopped
  // staging generators on 2026-08-04 that meant every real area delivery.
  if (!presentGens.length) {
    const vendored = [
      [path.join(PLACE_ENGINE_DIR, 'gen_internal.js'), 'gen_internal.js'],
      [path.join(AREA_ENGINE_DIR, `gen_external_${AREA_STYLE}.js`), 'gen_external.js'],
    ];
    for (const [from, as] of vendored) if (!existsSync(from)) {
      console.error(`✗ vendored area engine is missing ${path.basename(from)} at ${from}`);
      process.exit(3);
    }
    areaFallback = vendored;
    console.log(`· --src carries no generators — using the vendored area engine (external style: ${AREA_STYLE}).`);
    console.log('  Pass --external-style busway if the external map uses the busway template.');
  } else {
    for (const g of AREA_GENS) if (!existsSync(path.join(SRC, g))) console.warn(`· note: ${g} not present — that output will be skipped`);
  }
}
const slugOwner = getMapBySlug(slug);
if (slugOwner && slugOwner.id !== (request ? request.id : null)) {
  console.error(`✗ a map with slug "${slug}" already exists — pick another --slug or remove it from the DB.`);
  // The most likely cause: someone is importing a map a customer already asked
  // for. Point at the row instead of letting them build a duplicate.
  const pending = queue.find((q) => q.id === slugOwner.id);
  if (pending) {
    console.error(`\n  That slug belongs to APPROVED REQUEST #${slugOwner.id} ("${slugOwner.name}", awaiting a build).`);
    console.error(`  Build it in place instead of creating a second row:\n`);
    console.error(`      node scripts/import-map.mjs --request ${slugOwner.id} --src "${src}"\n`);
  }
  process.exit(1);
}

// Resolve the owning customer. Fulfilling a request keeps the requester's
// organisation — an importer typo must never re-home someone else's map.
let customerId = request ? request.customer_id : null;
if (request) {
  const owner = customerId != null ? getCustomer(customerId) : null;
  if (customerName && (!owner || owner.name !== customerName)) {
    console.error(`✗ map #${request.id} belongs to "${owner ? owner.name : '(unowned)'}" but --customer says "${customerName}".`);
    console.error('  Drop --customer to build it for its own organisation (re-owning a map is not an import job).');
    process.exit(1);
  }
  if (!owner && !allowUnowned) refuseUnowned(`approved request #${request.id} has no owning organisation`);
  console.log(`· fulfilling approved request #${request.id} for ${owner ? `"${owner.name}" (#${owner.id})` : '(UNOWNED — --unowned given)'}`);
} else if (customerName) {
  const existing = getCustomerByName(customerName);
  if (existing) {
    customerId = existing.id;
    console.log(`· owner: existing customer "${customerName}" (#${customerId})`);
  } else {
    const type = ORG_TYPES.includes(customerType) ? customerType : 'other';
    customerId = insertCustomer({ name: customerName, type });
    console.log(`· owner: created customer "${customerName}" (#${customerId}, ${type})`);
  }
} else {
  if (queue.length) {
    console.warn(`· note: ${queue.length} approved request(s) are awaiting a build — see --list-requests before importing a fresh row.`);
  }
  // Only --unowned reaches here: the no-owner case was refused above.
  console.warn('· UNOWNED (--unowned given) — this map is dropped by every public query and');
  console.warn('  cannot become publicly visible until an owner is set. Set one afterwards with');
  console.warn('  POST /api/admin/maps/<id>/owner from the admin console.');
}

// 1) DB row + object-store folders. Fulfilling a request ADOPTS its row (so the
//    placeholder becomes the built map) rather than inserting a second one.
let id;
if (request) {
  id = request.id;
  updateMapIdentity(id, { slug, name, subject });
  setMapOutputs(id, defaultOutputs());
} else {
  id = insertMap({ customer_id: customerId, slug, name, kind, subject, data_dir: '', outputs: defaultOutputs(), status: 'draft' });
}
const dirs = ensureMapDirs(id);
setMapDataDir(id, dirs.data);

// 2) Copy the map payload: the *.json inputs, plus the generators. Area maps carry
//    their generators in src; place maps get the vendored engine copied in. A
//    shipped overrides.json is EXPERT framing (river-hide / frozen viewport) → it
//    is stored as base-overrides.json, NOT as the customer overrides layer.
const dest = mapDataDir(id);
let copied = 0;
for (const f of readdirSync(SRC)) {
  if (f === 'overrides.json' || f === BASE_OVERRIDES) continue; // handled below / never import stale
  // build-warnings.txt rides along: it is the ENGINE's verdict on this exact
  // build, and the portal cannot re-derive it for a version it did not render
  // (OA-046). Everything else here is an input; this one is a finding.
  const keep = /^gen_.*\.js$/.test(f) || f === BUILD_WARNINGS || (f.endsWith('.json') && !f.endsWith('.bak'));
  if (!keep) continue;
  cpSync(path.join(SRC, f), path.join(dest, f));
  copied++;
}
if (areaFallback) {
  for (const [from, as] of areaFallback) { cpSync(from, path.join(dest, as)); copied++; }
  console.log(`· staged the vendored area engine into ${dest}`);
  /* RECORD WHICH EXTERNAL GENERATOR WE JUST CHOSE (OA-143). A pack stores it as
   * `gen_external.js` and the portal vendors two of them, so the filename cannot
   * say — and `track-engine.mjs` therefore skipped every area map, for ever,
   * which was eight of the eighteen live maps and every town's external sheet.
   * We know the answer HERE, because we picked the file a few lines up. Writing
   * it costs nothing and is the whole fix for future packs.
   *
   * Only the staged case is recorded, deliberately. A payload that brought its
   * OWN generator may have a hand-edited one, and a hand-edited generator must
   * never be overwritten by the vendored file — leaving it undeclared is what
   * keeps the tracker off it. */
  const generators = {};
  for (const [from, as] of areaFallback) {
    const rel = path.relative(ENGINE_ROOT, from).split(path.sep).join('/');
    if (as !== path.basename(from)) generators[as] = rel;   // only the renamed, ambiguous ones
  }
  if (Object.keys(generators).length) {
    writeEngineSource(dest, generators, 'import');
    console.log(`· recorded engine provenance → ${ENGINE_SOURCE_FILE} (${Object.entries(generators).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  }
}
if (isPlace) {
  for (const g of PLACE_GENS) { cpSync(path.join(PLACE_ENGINE_DIR, g), path.join(dest, g)); copied++; }
  // Expert framing: a fresh skill payload carries it as overrides.json; a
  // live-derived payload already has it split out as base-overrides.json. Accept either.
  const framing = [path.join(SRC, 'overrides.json'), path.join(SRC, BASE_OVERRIDES)].find(existsSync);
  if (framing) {
    cpSync(framing, path.join(dest, BASE_OVERRIDES));
    console.log(`· stored expert framing → ${BASE_OVERRIDES} (merged under customer edits at render)`);
  }
}
console.log(`· copied ${copied} payload files → ${dest}`);

// WHAT THIS PAYLOAD DECLARES IT HAS (OA-009). --src holds one `<base>.svg` per
// sheet the skill actually built, which is the same set the S4 manifest lists —
// and unlike the manifest it travels with the folder, so this reads the same on
// the laptop and on the host after a delivery scp. Without it the portal decides
// renderability from whether a GENERATOR resolves, which offered a sheet St Ives
// Bus Station had deliberately not built.
const declared = writeSheetDeclaration(dest, SRC);
if (declared) console.log(`· payload declares ${declared.length} sheet(s): ${declared.join(', ')}`);
else console.warn('· note: --src holds no sheet SVGs, so this payload declares nothing — renderability falls back to which generators resolve');

// Disagreements report (area maps only — places have no S1 audit yet, per
// make-place-bus-leaflet's SKILL.md). Static per-map extra, not a render
// output — renderVersion() in engine.js carries it into every version folder.
if (!isPlace) {
  const disagPath = arg('disagreements') || findDisagreementsPdf(SRC);
  if (disagPath && existsSync(disagPath)) {
    cpSync(disagPath, path.join(dest, 'disagreements.pdf'));
    console.log(`· copied disagreements report → ${dest}\\disagreements.pdf`);
  } else {
    console.warn('· note: no disagreements.pdf found (checked --disagreements and _latest/ up from --src) — importing without one');
  }
}

// 3) Baseline overrides = {} and render v1.0
writeFileSync(overridesPath(id), '{}\n');
const storageKey = 'v1.0';
console.log('· rendering baseline v1.0 (this runs both generators + rasterises)…');
const r = await renderVersion(id, {}, storageKey, defaultOutputs());
const versionId = insertVersion({ map_id: id, major: 1, minor: 0, note: 'Imported baseline', overrides: {}, storage_key: storageKey });
setCurrentVersion(id, versionId);

// P8: if we already know of an upcoming change this brand-new map doesn't
// reflect (e.g. this build itself is a fresh S1 scrape that predates a service
// change registered for next month), seed the public "changes coming" banner
// straight away rather than waiting for the next scheduled scan.
try {
  const reportPath = newestReportPath();
  if (reportPath) {
    const sections = sectionsForMap(parseSections(readFileSync(reportPath, 'utf8')), { kind, name, subject });
    const banner = sections.length ? bannerNoteFor(sections.flatMap((s) => s.bullets)) : null;
    if (banner) {
      setMapBannerNoteAuto(id, banner);
      console.log(`· seeded "changes coming" banner from ${path.basename(reportPath)}: ${banner}`);
    }
  }
} catch (e) {
  console.warn(`· note: could not check for upcoming changes to seed a banner (${e.message})`);
}

// A fulfilled request leaves 'approved' and becomes an ordinary DRAFT map: the
// customer can edit it and it reaches the public only through the publish gate.
// The fulfilment is a governance event, so it goes in the audit log.
if (request) {
  setMapStatus(id, 'draft');
  recordAudit({
    actorEmail: 'cli:import-map', action: 'maprequest.fulfil', mapId: id, versionId,
    detail: {
      name, kind, slug, version: storageKey, customerId,
      requestedAt: request.created_at, requestNote: request.request_note || null,
      renamed: slug !== request.slug || name !== request.name ? { fromSlug: request.slug, fromName: request.name } : undefined,
      src: SRC,
    },
  });
  console.log(`· request #${id} fulfilled → status "draft" (audit: maprequest.fulfil)`);
}

console.log(`\n✓ imported "${name}" as map #${id} (slug: ${slug}, kind: ${kind})`);
for (const [f, sz] of Object.entries(r.files)) console.log(`    ${f}  ${Number(sz).toLocaleString('en-GB')} B`);
console.log(`\n  Edit it at:  http://127.0.0.1:${process.env.PORT || 5180}/app/maps/${id}`);
process.exit(0);
