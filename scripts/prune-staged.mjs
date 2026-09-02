// Reclaim space from settled monthly refreshes (P7 ops).
//
//   node scripts/prune-staged.mjs [--days 90]              # dry run (default)
//   node scripts/prune-staged.mjs [--days 90] --yes         # actually delete
//
// P5 keeps everything on purpose: an accepted refresh archives the data it
// replaced (`maps/<id>/archive/`) and a declined or superseded one keeps its
// staged payload (`maps/<id>/proposed/<pid>/`), so a decision is reversible and
// auditable. Nothing pruned them, which was the standing follow-up this closes.
//
// What it removes, and only when the update was settled more than --days ago:
//   • staged payloads of proposed updates that are accepted / declined / superseded,
//   • the archived previous data of an accepted refresh.
//
// What it NEVER touches: pending updates (a customer still has to decide), the
// live `data/` of any map, and `renders/` — every rendered version stays, because
// a published version's bytes are the thing an approver reviewed.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { db } from '../src/db/index.js';
import { proposedRoot, archiveRoot } from '../src/maps/store.js';
import { dirSize } from '../src/ops/index.js';
import { arg } from './lib/cli.mjs';

const yes = process.argv.includes('--yes');
const dry = !yes;
const quiet = process.argv.includes('--quiet');
const days = Math.max(0, Number(arg('days', 90)));
const say = (...a) => { if (!quiet) console.log(...a); };
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

// Settled updates old enough to prune, with the map they belong to.
const settled = db
  .prepare(
    `SELECT id, map_id, status, COALESCE(reviewed_at, created_at) AS settled_at
       FROM proposed_update
      WHERE status <> 'pending'
        AND COALESCE(reviewed_at, created_at) <= datetime('now', ?)
      ORDER BY map_id, id`,
  )
  .all(`-${days} days`);

const pending = new Set(
  db.prepare("SELECT id FROM proposed_update WHERE status = 'pending'").all().map((r) => r.id),
);

say(`Pruning settled refresh data older than ${days} day(s)${dry ? '  [DRY RUN]' : ''}`);
say(`· ${settled.length} settled update(s) in range, ${pending.size} still pending (never touched)\n`);

let freed = 0, removed = 0;
for (const pu of settled) {
  // the staged payload of this update
  const staged = path.join(proposedRoot(pu.map_id), String(pu.id));
  if (existsSync(staged)) {
    const bytes = dirSize(staged);
    say(`· map ${pu.map_id}  update #${pu.id} (${pu.status}, ${pu.settled_at})  staged  ${mb(bytes)}`);
    if (!dry) rmSync(staged, { recursive: true, force: true });
    freed += bytes; removed++;
  }
  // the data this accepted refresh replaced
  if (pu.status === 'accepted') {
    const archived = path.join(archiveRoot(pu.map_id), `proposed-${pu.id}-prev`);
    if (existsSync(archived)) {
      const bytes = dirSize(archived);
      say(`· map ${pu.map_id}  update #${pu.id} (accepted)                archive ${mb(bytes)}`);
      if (!dry) rmSync(archived, { recursive: true, force: true });
      freed += bytes; removed++;
    }
  }
}

// Tidy empty proposed/ + archive/ roots so the store stays readable.
if (!dry) {
  for (const mapId of new Set(settled.map((s) => s.map_id))) {
    for (const root of [proposedRoot(mapId), archiveRoot(mapId)]) {
      try { if (existsSync(root) && !readdirSync(root).length) rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

say(`\n${dry ? 'Would free' : 'Freed'} ${mb(freed)} from ${removed} folder(s).`);
if (dry) say('Dry run only — nothing deleted. Re-run with --yes to actually delete.');
process.exit(0);
