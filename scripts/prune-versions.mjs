// Retire the earlier versions of a map that piled up in development — buses-data
// OA-572, step 1. The companion delete-map.mjs lacks: that removes a whole map,
// this removes the CLUTTER of one that stays.
//
//   node scripts/prune-versions.mjs --slug st-ives                  # dry run (default)
//   node scripts/prune-versions.mjs --slug st-ives --keep 1 --yes   # retire, keeping the newest 1 as well
//   node scripts/prune-versions.mjs --map 7 --include-published --reason "development builds nobody linked to" --yes
//   node scripts/prune-versions.mjs --all                           # dry run over every map; never acts
//
//   --map <id> | --slug <slug>   the map. One of them, or --all.
//   --all                        every map, DRY RUN ONLY: --all with --yes is refused, so
//                                the estate is listed in one go but acted on one map at a time.
//   --keep <n>                   keep the newest n live versions as well as the protected ones
//                                (default 3; 0 keeps only what the rule protects).
//   --include-published          also retire versions that were once PUBLISHED and since superseded.
//   --reason "<text>"            required with --include-published, and recorded in the audit row.
//   --yes                        act. Without it nothing is written.
//
// RETIRE, NOT ERASE (Peter's ruling, 2026-10-10). A retired version's render folder
// (data/maps/<id>/renders/<key>/) is removed and `map_version.retired_at` is stamped;
// the row, its publish_request sign-off and its data-change record all stay, so the
// version number is never reused and no foreign key needs clearing. One
// `version.retire` audit row is written per version.
//
// WHAT MAY GO is decided by classifyVersions() in src/publish/retire.js and nowhere
// else — the working head, the published version, the revert target, the highest
// number and anything awaiting review are never retired, whatever the flags say. A
// once-published version needs --include-published AND a reason, because it is
// history: retiring it loses the editor's view of it and the option to revert to it.
// (A public link does NOT break — public routes serve the published key by slug.)
//
// THE WRITE is retireVersion() in src/publish/retire-write.js, the same function the
// admin button calls (OA-622), so the two doors cannot retire differently.
//
// Run with the server STOPPED where it writes, like the other writing scripts
// (docs/H1-operations-handbook.md §6). Exit codes: 0 done (or dry run), 1 a map
// not found or a write failed, 2 used wrongly.

import { db, getMap, getMapBySlug } from '../src/db/index.js';
import { classifyVersions } from '../src/publish/retire.js';
import { retireFactsFor, retireVersion } from '../src/publish/retire-write.js';
import { arg, has } from './lib/cli.mjs';

const slug = arg('slug');
const mapArg = arg('map');
const all = has('all');
const yes = has('yes');
const includePublished = has('include-published');
const reason = (arg('reason') || '').trim();
const keepArg = arg('keep');
const keep = keepArg == null ? 3 : Number(keepArg);

const usage = (msg) => {
  if (msg) console.error(`✗ ${msg}`);
  console.error('Usage: node scripts/prune-versions.mjs (--slug <slug> | --map <id> | --all) [--keep <n>]');
  console.error('         [--include-published --reason "<text>"] [--yes]');
  process.exit(2);
};
if ([slug, mapArg].filter((x) => x != null).length + (all ? 1 : 0) !== 1) usage('name exactly one of --slug, --map or --all');
if ((has('keep') && keepArg == null) || !Number.isInteger(keep) || keep < 0) usage(`--keep must be a whole number of 0 or more, not ${JSON.stringify(keepArg)}`);
if (all && yes) usage('--all is a dry run only; act on one map at a time with --map or --slug');
if (includePublished && !reason) usage('--include-published needs --reason "<text>": a once-published version\'s history somebody may want back, so say why');

let maps;
if (all) {
  maps = db.prepare('SELECT id FROM map ORDER BY id').all().map((r) => getMap(r.id));
} else {
  const found = mapArg != null ? getMap(Number(mapArg)) : getMapBySlug(slug);
  if (!found) {
    console.error(`✗ no map found for ${mapArg != null ? `--map ${mapArg}` : `--slug "${slug}"`}`);
    process.exit(1);
  }
  maps = [getMap(found.id)];
}

let totalWould = 0;
let totalDone = 0;
let failed = 0;

for (const map of maps) {
  const verdicts = classifyVersions(retireFactsFor(map, { keep }));
  const go = verdicts.filter((v) => v.verdict === 'retirable' && (!v.adminOnly || includePublished));
  const held = verdicts.filter((v) => v.verdict === 'retirable' && v.adminOnly && !includePublished);
  if (all && !go.length && !held.length) continue;   // the estate listing names only maps with something to say

  console.log(`\nMap #${map.id}  "${map.name}"  (slug: ${map.slug}, ${verdicts.length} version(s))`);
  for (const v of verdicts) {
    const would = go.includes(v);
    const mark = v.verdict === 'retired' ? '·' : would ? (yes ? '✗' : '-') : held.includes(v) ? '?' : '=';
    const label = would ? (yes ? 'RETIRE' : 'would retire') : held.includes(v) ? 'held' : v.verdict;
    console.log(`  ${mark} ${v.version.padEnd(8)} ${label.padEnd(12)} ${v.why}${held.includes(v) ? ' — pass --include-published --reason' : ''}`);
  }
  totalWould += go.length;
  if (!yes || !go.length) continue;

  for (const v of go) {
    try {
      const done = retireVersion({ map, verdict: v, actor: { email: 'cli:prune-versions' }, reason, keep, via: 'cli' });
      if (!done.retired) continue;                         // someone else retired it meanwhile
      totalDone++;
    } catch (e) {
      failed++;
      console.error(`  ✗ ${v.version}: ${e.message}`);
    }
  }
}

console.log('');
if (!yes) {
  console.log(`Dry run only — nothing retired. ${totalWould} version(s) would be retired. Re-run one map with --yes to act.`);
  process.exit(0);
}
console.log(`✓ retired ${totalDone} version(s): render folders removed, rows stamped, one version.retire audit row each.`);
process.exit(failed ? 1 : 0);
