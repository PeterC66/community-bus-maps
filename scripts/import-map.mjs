// Seed ONE map into the object store from a staged Buses run dir.
//
// P1 needs a real map to edit; this is the minimal importer (P2 generalises it
// to a multi-map, multi-customer importer). It copies a map's generators + JSON
// inputs into the git-ignored object store, records a `map` row, and renders the
// baseline as version 1.0 — with EMPTY overrides, so v1.0 is byte-identical to
// the shipped leaflet.
//
//   node scripts/import-map.mjs --src "<S5-render dir>" --name "St Ives" \
//        [--slug st-ives] [--kind area] [--subject "St Ives"]
//
// --src must contain gen_internal.js / gen_external.js and their *.json inputs
// (e.g. a ".../St Ives/S5-render/v6.6_..." folder in the separate Buses repo).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMapBySlug, insertMap, setMapDataDir, insertVersion, setCurrentVersion,
  getCustomerByName, insertCustomer,
} from '../src/db/index.js';
import { ensureMapDirs, mapDataDir, overridesPath, BASE_OVERRIDES } from '../src/maps/store.js';
import { renderVersion, defaultOutputs } from '../src/maps/engine.js';

const ORG_TYPES = ['council', 'shop', 'business', 'school', 'function-organiser', 'charity-nt', 'other'];

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const src = arg('src');
const name = arg('name');
if (!src || !name) {
  console.error('Usage: node scripts/import-map.mjs --src "<run dir>" --name "<Display Name>" [--slug ..] [--kind area|place] [--subject ..]');
  process.exit(2);
}
const SRC = path.resolve(src);
const slug = slugify(arg('slug', name));
const kind = arg('kind', 'area');
const subject = arg('subject', name);
const customerName = arg('customer');
const customerType = arg('customer-type', 'other');

if (!existsSync(SRC)) { console.error(`✗ --src not found: ${SRC}`); process.exit(1); }

// AREA maps carry their generators per-map (they travel in the src render dir).
// PLACE maps DON'T — the make-place-bus-leaflet skill keeps one engine, not per
// map — so the portal VENDORS the place engine (engine/place/) and copies it into
// the map's data folder here. Validate the right shape for the given --kind.
const PLACE_ENGINE_DIR = fileURLToPath(new URL('../engine/place', import.meta.url));
const PLACE_GENS = ['gen_internal.js', 'gen_internal_place.js', 'gen_external_places.js'];
const AREA_GENS = ['gen_internal.js', 'gen_external.js'];
const isPlace = kind === 'place';

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
  if (!presentGens.length) {
    console.error(`✗ --src carries none of the area generators (${AREA_GENS.join(', ')}).`);
    console.error('  If this is a place map, pass --kind place (its engine is vendored in engine/place/).');
    process.exit(3);
  }
  for (const g of AREA_GENS) if (!existsSync(path.join(SRC, g))) console.warn(`· note: ${g} not present — that output will be skipped`);
}
if (getMapBySlug(slug)) {
  console.error(`✗ a map with slug "${slug}" already exists — pick another --slug or remove it from the DB.`);
  process.exit(1);
}

// Resolve (or create) the owning customer.
let customerId = null;
if (customerName) {
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
  console.warn('· note: no --customer given → map is unowned (only an admin can see it). Pass --customer "Name".');
}

// 1) DB row + object-store folders
const id = insertMap({ customer_id: customerId, slug, name, kind, subject, data_dir: '', outputs: defaultOutputs(), status: 'draft' });
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
  const keep = /^gen_.*\.js$/.test(f) || (f.endsWith('.json') && !f.endsWith('.bak'));
  if (!keep) continue;
  cpSync(path.join(SRC, f), path.join(dest, f));
  copied++;
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

// 3) Baseline overrides = {} and render v1.0
writeFileSync(overridesPath(id), '{}\n');
const storageKey = 'v1.0';
console.log('· rendering baseline v1.0 (this runs both generators + rasterises)…');
const r = await renderVersion(id, {}, storageKey, defaultOutputs());
const versionId = insertVersion({ map_id: id, major: 1, minor: 0, note: 'Imported baseline', overrides: {}, storage_key: storageKey });
setCurrentVersion(id, versionId);

console.log(`\n✓ imported "${name}" as map #${id} (slug: ${slug}, kind: ${kind})`);
for (const [f, sz] of Object.entries(r.files)) console.log(`    ${f}  ${Number(sz).toLocaleString('en-GB')} B`);
console.log(`\n  Edit it at:  http://127.0.0.1:${process.env.PORT || 5180}/app/maps/${id}`);
process.exit(0);
