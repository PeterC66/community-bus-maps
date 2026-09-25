#!/usr/bin/env node
// End a delivery round with ONE "N map updates ready" email per customer
// (buses-data OA-152), instead of the one-per-map notice propose-update.mjs sends.
//
//   node scripts/notify-update-round.mjs --map st-ives,ramsey,march --dry-run
//   node scripts/notify-update-round.mjs --map st-ives,ramsey,march
//   node scripts/notify-update-round.mjs --ids 41,42,43
//
// --map takes the slugs (or numeric ids) of the maps the round staged, comma-
// separated with no spaces; each resolves to that map's one PENDING proposed
// update, which is this round's because a newer refresh supersedes an older one.
// --ids takes the proposed-update ids propose-update.mjs printed instead. Give
// one or the other. --dry-run prints who would get which digest and sends nothing.
//
// It reads DATA_DIR's database, so it runs on the VPS, inside the running portal
// container. From the laptop, with the slugs of the round in place of the example
// ones (there are no other placeholders):
//
//   npm --prefix "C:/Claude/community-bus-maps" run ssh -- "docker compose exec -T portal node scripts/notify-update-round.mjs --map st-ives,ramsey"
//
// THE ROUND. Stage every map with `npm run deliver -- … --no-notify`, which
// emails nobody, then run this once. Grouping and wording are the server's own
// (updateRoundDigests / notifyUpdateRound in src/email/notify.js), the same code
// behind POST /api/admin/notify-update-ready-batch; this is that route without an
// admin session, the way a delivery already reaches the host.
//
// ALL OR NOTHING BEFORE ANYTHING IS SENT. A map with no pending update, an
// unknown slug or an id that is not pending refuses the whole run with exit 1 and
// no email: a typo must not send a digest that silently leaves a map out, and a
// re-run after fixing it must not announce the rest twice. Recipients are
// counted, never printed. A send is recorded in the audit trail as
// notify.update-ready-batch, like the route's.
//
// Exit codes follow docs/CONVENTIONS.md: 0 sent (or planned, with --dry-run),
// 1 refused, 2 used wrongly.

import { getMap, getMapBySlug, getOpenProposedForMap, recordAudit } from '../src/db/index.js';
import { updateRoundDigests, notifyUpdateRound, recipientsFor } from '../src/email/notify.js';
import { arg, has } from './lib/cli.mjs';

const maps = arg('map');
const idsArg = arg('ids');
const dryRun = has('dry-run');
if (!maps === !idsArg) {
  console.error('Usage: node scripts/notify-update-round.mjs (--map <slug,slug,…> | --ids <id,id,…>) [--dry-run]');
  process.exit(2);
}
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

const problems = [];
let ids;
if (maps) {
  ids = [];
  for (const ref of list(maps)) {
    const map = /^\d+$/.test(ref) ? getMap(Number(ref)) : getMapBySlug(ref);
    if (!map) { problems.push(`no map matching "${ref}"`); continue; }
    const pu = getOpenProposedForMap(map.id);
    if (!pu) { problems.push(`"${map.slug}" has no pending proposed update — was it staged this round?`); continue; }
    ids.push(Number(pu.id));
  }
} else {
  ids = list(idsArg).map(Number);
  if (ids.some((n) => !Number.isInteger(n))) { console.error(`✗ --ids must be whole numbers: ${idsArg}`); process.exit(2); }
}

const { groups, skipped } = updateRoundDigests(ids);
for (const id of skipped) problems.push(`proposed update #${id} is not pending`);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error('Refused: nothing was sent. Fix the list and run it again.');
  process.exit(1);
}

console.log(`${groups.length} customer digest(s) for ${ids.length} staged update(s):`);
for (const g of groups) {
  console.log(`  customer #${g.customerId} — ${recipientsFor(g.customerId).length} recipient(s):`);
  for (const m of g.maps) console.log(`    #${m.proposedId}  ${m.mapName}${m.sourceNote ? ` (${m.sourceNote})` : ''}`);
}
const unowned = ids.length - groups.reduce((n, g) => n + g.maps.length, 0);
if (unowned) console.log(`  ${unowned} update(s) belong to a map with no customer, so nobody is told about them.`);

if (dryRun) {
  console.log('Dry run: nothing was sent.');
  process.exit(0);
}

const { results } = await notifyUpdateRound(ids, { info() {}, warn: console.warn });
recordAudit({ actorEmail: 'notify-update-round.mjs', action: 'notify.update-ready-batch', detail: { proposedIds: ids, skipped, results } });
for (const r of results) console.log(`  customer #${r.customerId}: ${r.sent} sent, ${r.skipped} not sent (${r.maps} map(s))`);
console.log(results.some((r) => r.sent)
  ? 'Sent.'
  : 'No email sent (no EMAIL_PROVIDER, or nobody with a deliverable address). The updates stay staged either way.');
process.exit(0);
