// GET /api/maps `lastDeliveryAt` — when the pipeline last delivered a map, as assertions.
//
//   node scripts/test-last-delivery.mjs        (or: npm run test:last-delivery)
//
// WHAT IT IS FOR. bus-work's worklist (claude-skills, bus-work/assets/worklist.mjs)
// raises "built here, never delivered" when a map's newest local S5 render is newer
// than the last delivery the portal holds. Nothing on the host records WHICH render
// a delivery came from (deliver-map.mjs step 0b says so), so the delivery's TIME is
// the one fact both sides hold. The worklist reads it with the read-only
// OPERATOR_TOKEN, which admits /api/maps and not /api/maps/:id, so it is a field of
// the list rather than of the detail.
//
// WHAT COUNTS. The map's first version (import-map.mjs writes it) and its newest
// proposed_update of ANY status (propose-update.mjs; deliver-map.mjs runs it). A
// version the customer saved is not a delivery. Each case below that moves the
// value is paired with one that must not, because a field that returned the newest
// version of any kind would pass every "it moved" case.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-lastdelivery-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
const TOKEN = 'operator-token-for-the-last-delivery-test';
process.env.OPERATOR_TOKEN = TOKEN;

let failures = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');

const custId = db.insertCustomer({ name: 'Test Council', type: 'council', quota_areas: 4, quota_places: 4 });
const mapId = db.insertMap({ customer_id: custId, slug: 'ours', name: 'Ours', kind: 'area', subject: 'Ours' });
const at = (table, id, when) => db.db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(when, Number(id));
const lastDelivery = async () => {
  const r = await app.inject({ method: 'GET', url: '/api/maps', headers: { authorization: `Bearer ${TOKEN}` } });
  const m = r.json().maps.find((x) => x.slug === 'ours');
  return m ? m.lastDeliveryAt : 'map missing';
};

eq('a map never built has no delivery', await lastDelivery(), null);

const v1 = db.insertVersion({ map_id: mapId, major: 1, minor: 0, note: 'Imported baseline', overrides: {}, storage_key: 'v1.0' });
at('map_version', v1, '2026-09-01 10:00:00');
eq('the import is the first delivery', await lastDelivery(), '2026-09-01 10:00:00');

const v2 = db.insertVersion({ map_id: mapId, major: 1, minor: 1, note: 'moved a label', overrides: {}, storage_key: 'v1.1' });
at('map_version', v2, '2026-09-05 10:00:00');
eq('a version the customer saved later is NOT a delivery', await lastDelivery(), '2026-09-01 10:00:00');

const pu1 = db.insertProposedUpdate({ map_id: mapId, source_note: 'BODS September refresh' });
at('proposed_update', pu1, '2026-09-10 10:00:00');
eq('a proposed update is a delivery', await lastDelivery(), '2026-09-10 10:00:00');

db.db.prepare("UPDATE proposed_update SET status = 'superseded' WHERE id = ?").run(Number(pu1));
eq('…and still counts once it is no longer pending', await lastDelivery(), '2026-09-10 10:00:00');

const pu2 = db.insertProposedUpdate({ map_id: mapId, source_note: 'BODS October refresh' });
at('proposed_update', pu2, '2026-10-10 10:00:00');
eq('the newest proposed update wins', await lastDelivery(), '2026-10-10 10:00:00');

const v3 = db.insertVersion({ map_id: mapId, major: 1, minor: 2, note: 'another save', overrides: {}, storage_key: 'v1.2' });
at('map_version', v3, '2026-10-12 10:00:00');
eq('…and a customer save after it still does not move it', await lastDelivery(), '2026-10-10 10:00:00');

db.db.prepare("UPDATE map_version SET retired_at = datetime('now') WHERE id = ?").run(Number(v1));
const other = db.insertMap({ customer_id: custId, slug: 'pruned', name: 'Pruned', kind: 'area', subject: 'Pruned' });
const ov = db.insertVersion({ map_id: other, major: 1, minor: 0, note: 'Imported baseline', overrides: {}, storage_key: 'v1.0' });
at('map_version', ov, '2026-08-01 09:00:00');
db.db.prepare("UPDATE map_version SET retired_at = datetime('now') WHERE id = ?").run(Number(ov));
const r = await app.inject({ method: 'GET', url: '/api/maps', headers: { authorization: `Bearer ${TOKEN}` } });
eq('a retired import still dates the delivery', r.json().maps.find((x) => x.slug === 'pruned').lastDeliveryAt, '2026-08-01 09:00:00');

console.log(failures ? `\n${failures} FAILED\n` : '\nAll last-delivery assertions pass.\n');
process.exit(failures ? 1 : 0);
