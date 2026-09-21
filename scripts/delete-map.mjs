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
//
// It DOES delete map_adviser_grant rows, and names every adviser on the way out.
// A grant is one person's standing invitation to look at ONE map (buses-data
// OA-154 D1), and `map_id` there is NOT NULL REFERENCES map(id) with
// `PRAGMA foreign_keys = ON` — so leaving them alone would not dangle harmlessly
// the way an audit row does, it would ROLL THE WHOLE DELETE BACK with a bare
// SQLite constraint error. The grant table arrived three weeks after this script
// and nothing joined the two up, so a handover of a town that happens to have a
// local adviser would have failed at the worst possible moment, with an error
// about a foreign key rather than about an adviser.
//
// REVOKING IS NOT AN ALTERNATIVE. A revoked grant KEEPS its row — that is the
// whole point of `revoked_at`, so one person's history with one map stays one
// row — so the constraint bites just the same. The rows therefore go, and the
// advisers are printed and written into the `map.delete` audit detail, because
// the town still has a map after the re-import and the same person almost
// certainly still needs to see it. Re-granting is a deliberate act by a human,
// which is what it was the first time.

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
// Who can see this map, and will NOT be able to see its replacement unless
// somebody re-grants it. Revoked rows are counted but not listed: they are
// history, and the person they name has no access left to lose.
const grants = db.prepare(
  `SELECT g.user_id, g.note, g.revoked_at, u.email, u.name
     FROM map_adviser_grant g JOIN user u ON u.id = g.user_id
    WHERE g.map_id = ?
    ORDER BY (g.revoked_at IS NOT NULL), u.email`,
).all(map.id);
const liveGrants = grants.filter((g) => !g.revoked_at);
const dir = mapDir(map.id);

console.log(`Map #${map.id}  "${map.name}"  (slug: ${map.slug}, kind: ${map.kind}, status: ${map.status})`);
console.log(`  owner: ${map.customer_name || '(unowned)'}${map.customer_id != null ? ` (#${map.customer_id})` : ''}`);
console.log(`  versions: ${versionCount}   publish requests: ${publishCount}   proposed updates: ${proposedCount}   messages: ${messageCount}`);
console.log(`  adviser grants: ${grants.length}${liveGrants.length ? `   (${liveGrants.length} LIVE — see below)` : ''}`);
console.log(`  object-store folder: ${dir}${existsSync(dir) ? '' : '  (already absent)'}`);

// Printed before the --yes gate as well as after it, so the DRY RUN is where
// you find out. An adviser is somebody a human asked, by name, in writing.
if (liveGrants.length) {
  console.log(`\n! ${liveGrants.length} local adviser${liveGrants.length === 1 ? '' : 's'} can see this map today and will lose it:`);
  for (const g of liveGrants) {
    console.log(`    ${g.email}${g.name ? ` (${g.name})` : ''}${g.note ? ` — ${g.note}` : ''}`);
  }
  console.log('  Re-grant them on the new map after the import; nothing else will remind you.');
}

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
  db.prepare('DELETE FROM map_adviser_grant WHERE map_id = ?').run(map.id);
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
    // Same shape as the adviser.grant / adviser.revoke details, so one query
    // over the audit log answers "who could see this map" across all three.
    grantCount: grants.length,
    advisersDropped: liveGrants.map((g) => ({ userId: g.user_id, email: g.email, note: g.note || null })),
  },
});

console.log(`\n✓ deleted map #${map.id} ("${map.name}", slug: ${map.slug}) — row, versions, and object-store folder removed.`);
if (liveGrants.length) {
  console.log(`! ${liveGrants.length} adviser grant${liveGrants.length === 1 ? '' : 's'} went with it — re-grant after the import:`);
  for (const g of liveGrants) console.log(`    ${g.email}`);
}
process.exit(0);
