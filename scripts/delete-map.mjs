// Retire a map row entirely — the companion import-map.mjs lacks: a real
// customer taking over a town a demo org already holds must not end up
// owning a SECOND "St Ives", and re-importing under the same --slug fails
// (import-map.mjs: "a map with slug ... already exists"). This deletes the
// old row first so the fresh import gets a clean v1.0, per the policy that
// one town has at most one live map at a time (demo XOR real customer).
//
//   node scripts/delete-map.mjs --slug st-ives            # dry run (default)
//   node scripts/delete-map.mjs --slug st-ives --yes       # actually delete
//   node scripts/delete-map.mjs --map 7 --yes
//
// Then re-import fresh, e.g.:
//   node scripts/import-map.mjs --src "<S5-render dir>" --name "St Ives" \
//        --slug st-ives --customer "St Ives (Cambs) u3a"
//
// What this removes: the map row, its map_version rows, publish_request rows,
// proposed_update rows (and their staged/archived files), and the object-store
// folder (data/maps/<id>/) from disk. It does NOT delete audit_log rows — that
// table is append-only by design (schema.sql), so the deletion itself is
// recorded there and earlier entries are left with a dangling map_id, same as
// any other retired row. It does NOT delete message rows (enquiries/feedback
// aren't the map's to take with it) — their map_id is nulled instead so old
// feedback survives as unattributed rather than vanishing or pointing at a
// row that no longer exists.

import { existsSync, rmSync } from 'node:fs';
import {
  db, getMap, getMapBySlug, recordAudit,
} from '../src/db/index.js';
import { mapDir } from '../src/maps/store.js';
import { arg, has } from './lib/cli.mjs';


const slug = arg('slug');
const mapArg = arg('map');
const yes = has('yes');

if (!slug && mapArg == null) {
  console.error('Usage: node scripts/delete-map.mjs --slug <slug> [--yes]');
  console.error('   or: node scripts/delete-map.mjs --map <id> [--yes]');
  process.exit(2);
}

const found = mapArg != null ? getMap(Number(mapArg)) : getMapBySlug(slug);
if (!found) {
  console.error(`✗ no map found for ${mapArg != null ? `--map ${mapArg}` : `--slug "${slug}"`}`);
  process.exit(1);
}
// getMapBySlug is a plain `SELECT * FROM map` with no customer join, so
// re-fetch via getMap() to get customer_name for the summary below regardless
// of which flag resolved the row.
const map = getMap(found.id);

const versionCount = db.prepare('SELECT COUNT(*) AS n FROM map_version WHERE map_id = ?').get(map.id).n;
const publishCount = db.prepare('SELECT COUNT(*) AS n FROM publish_request WHERE map_id = ?').get(map.id).n;
const proposedCount = db.prepare('SELECT COUNT(*) AS n FROM proposed_update WHERE map_id = ?').get(map.id).n;
const messageCount = db.prepare('SELECT COUNT(*) AS n FROM message WHERE map_id = ?').get(map.id).n;
const dir = mapDir(map.id);

console.log(`Map #${map.id}  "${map.name}"  (slug: ${map.slug}, kind: ${map.kind}, status: ${map.status})`);
console.log(`  owner: ${map.customer_name || '(unowned)'}${map.customer_id != null ? ` (#${map.customer_id})` : ''}`);
console.log(`  versions: ${versionCount}   publish requests: ${publishCount}   proposed updates: ${proposedCount}   messages: ${messageCount}`);
console.log(`  object-store folder: ${dir}${existsSync(dir) ? '' : '  (already absent)'}`);

if (!yes) {
  console.log('\nDry run only — nothing deleted. Re-run with --yes to actually delete this map.');
  process.exit(0);
}

// node:sqlite's DatabaseSync has no .transaction() helper (that's a
// better-sqlite3-ism) — wrap the statements in an explicit BEGIN/COMMIT
// instead, same as any plain SQL client.
db.exec('BEGIN');
try {
  // Clear the two self-referencing pointers first (current/published version)
  // so nothing points at a map_version row about to be removed.
  db.prepare('UPDATE map SET current_version_id = NULL, published_version_id = NULL WHERE id = ?').run(map.id);
  db.prepare('UPDATE message SET map_id = NULL WHERE map_id = ?').run(map.id);
  db.prepare('DELETE FROM publish_request WHERE map_id = ?').run(map.id);
  db.prepare('DELETE FROM proposed_update WHERE map_id = ?').run(map.id);
  db.prepare('DELETE FROM map_version WHERE map_id = ?').run(map.id);
  db.prepare('DELETE FROM map WHERE id = ?').run(map.id);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

recordAudit({
  actorEmail: 'cli:delete-map',
  action: 'map.delete',
  mapId: map.id,
  detail: {
    name: map.name, slug: map.slug, kind: map.kind, customerId: map.customer_id,
    versionCount, publishCount, proposedCount, messageCount,
  },
});

console.log(`\n✓ deleted map #${map.id} ("${map.name}", slug: ${map.slug}) — row, versions, and object-store folder removed.`);
process.exit(0);
