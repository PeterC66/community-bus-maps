// Where the verify gates get their fixtures, and what happens when there aren't
// any. technical-audit_2026-08-19 V2 — the finding the audit said to fix if only
// one thing gets fixed.
//
// THE FINDING. `npm run verify` is what demonstrates the product's central
// technical claim: same inputs, same bytes. It needed `FIXTURE_DIR` pointing at
// a folder under `Areas/**/S5-render/**` in the buses-data repo, and that path
// is git-ignored. So the area gate and the escape-hatch gate could not run in
// CI, could not run in a fresh clone, and could not be run by a second developer
// or by an acquirer's technical reviewer — only by one person on one laptop.
//
// And the failure was SILENT. Both scripts printed "not set or missing —
// skipping" and exited 0. The README said so plainly ("a green run in a fresh
// clone proves nothing about the renderer"), which makes it documented rather
// than fixed. A gate that passes when it did not run is not a gate; it is a
// habit. The same class of bug had already bitten once inside this very
// mechanism: when FIXTURE_DIR became a `;`-separated list, verify-reproduce.mjs
// ran existsSync on the whole list, decided it was missing, and went green with
// the byte check not running at all — caught by counting RESULT lines, not by
// any exit code.
//
// THE FIX, in two halves.
//
// 1. A fixture is now COMMITTED, at `Areas/_portal-fixture/<Town>` in
//    buses-data, the way `Places/_portal-fixture` already committed a place
//    one. `resolveFixtures()` finds it automatically, so the normal case needs
//    no configuration at all: clone both repos side by side, or set BUSES_DIR,
//    and `npm run verify` runs for real.
//
// 2. When there is genuinely nothing to run against, the gate FAILS. Not
//    skips. `--allow-skip` exists for the one legitimate case — a contributor
//    who has cloned only the portal and wants `npm test` to pass — and it says
//    loudly what it did not prove.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { warnIfBehindCommitted } from './fixture-freshness.mjs';
import { advanceToNewestRender } from './newest-render.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(HERE, '..', '..');

/**
 * Candidate locations for the buses-data checkout, in order.
 *
 * BUSES_DIR is the explicit answer and comes first. The two relative guesses
 * cover the layouts that actually exist: CI checks the repos out side by side
 * into one workspace, and a developer cloning both into one folder gets the
 * same shape for free.
 */
function busesDirCandidates() {
  const out = [];
  if (process.env.BUSES_DIR) out.push(process.env.BUSES_DIR);
  out.push(path.resolve(PORTAL_ROOT, '..', 'buses-data'));
  out.push(path.resolve(PORTAL_ROOT, '..', 'Buses'));
  return out;
}

/** Every committed fixture folder under `<kind>/_portal-fixture/`, sorted. */
function committedFixtures(kind) {
  for (const base of busesDirCandidates()) {
    const dir = path.join(base, kind, '_portal-fixture');
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    const dirs = names
      .map((n) => path.join(dir, n))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } })
      .sort();
    if (dirs.length) return dirs;
  }
  return [];
}

/**
 * Resolve the fixture list for one gate.
 *
 * @param {'area'|'place'} kind
 * @returns {{ fixtures: string[], source: 'env'|'committed'|'none' }}
 *
 * The env variable WINS when it points at something that exists. That ordering
 * is deliberate: the laptop's .env points at the live render tree, which is
 * where a real regression shows up first, and a committed fixture that silently
 * overrode it would make the local gate weaker than it is today.
 *
 * AND IT SAYS SO WHEN THAT MAKES IT WEAKER INSTEAD (OA-180, 2026-08-30). The
 * env path carries a version number, so it goes stale at every rollout and
 * nothing reads it: this laptop spent six days gating `v6.55` while CI gated
 * the `v6.59` the committed fixture had been refreshed from — same command,
 * two answers, no message. `warnIfBehindCommitted()` compares the two packs'
 * `build-meta.json` and prints when the env entry is the older one. It is
 * sited HERE, in the resolver, rather than in each gate: six scripts call this
 * function, the fault is a property of the resolution and not of any one gate,
 * and a check every caller has to remember to make is one that a seventh
 * caller will not.
 */
export function resolveFixtures(kind) {
  const envVar = kind === 'place' ? 'PLACE_FIXTURE_DIR' : 'FIXTURE_DIR';
  const fromEnv = (process.env[envVar] || '')
    .split(';')            // `;` not `:` — these are Windows absolute paths
    .map((f) => f.trim())
    .filter((f) => f && existsSync(f));
  if (fromEnv.length) {
    /* AND SINCE 2026-09-01 IT REMOVES THE STALENESS CLASS RATHER THAN NAGGING
     * ABOUT IT (OA-211). The warning below was accurate, prominent and
     * ignorable, and the run still went red afterwards — a false DIFFERS on the
     * one gate whose whole job is to be believed. An entry shaped
     * `Areas/<Town>/S5-render/<version>` names the TOWN; this advances it to
     * that town's current render, read from its `manifest.json`, and prints the
     * substitution. It runs BEFORE the warning on purpose, so the two machines
     * are usually gating the same pack and the warning is left to say something
     * that is still true. Anything it cannot resolve is passed through
     * untouched, so the warning still covers every case it used to. */
    const advanced = advanceToNewestRender(fromEnv);
    warnIfBehindCommitted(kind, advanced);
    return { fixtures: advanced, source: 'env' };
  }

  const committed = committedFixtures(kind === 'place' ? 'Places' : 'Areas');
  if (committed.length) return { fixtures: committed, source: 'committed' };

  return { fixtures: [], source: 'none' };
}

/**
 * Nothing to run against. Decide whether that is a failure (it is) and say so
 * in enough detail that the reader can fix it, then exit.
 *
 * Called only when `resolveFixtures` returned nothing.
 */
export function reportNoFixture(kind, { allowSkip = process.argv.includes('--allow-skip') } = {}) {
  const envVar = kind === 'place' ? 'PLACE_FIXTURE_DIR' : 'FIXTURE_DIR';
  const dirName = kind === 'place' ? 'Places' : 'Areas';

  if (allowSkip) {
    console.log(`· SKIPPED (--allow-skip): no ${envVar} and no committed fixture under ${dirName}/_portal-fixture.`);
    console.log('  NOTHING WAS PROVED about the renderer by this run. --allow-skip exists for a clone');
    console.log('  of the portal alone; it is not a way of getting a green board.');
    return; // caller exits 0
  }

  console.error(`✗ no fixture — this gate did not run, and that is a FAILURE, not a skip.`);
  console.error('');
  console.error('  Until 2026-08-20 this printed "skipping" and exited 0, so a fresh clone, a CI run and');
  console.error('  a second developer all got a green result from a gate that had not executed. That is the');
  console.error('  finding the audit called the single most important structural item in the report (V2).');
  console.error('');
  console.error('  Looked for, in order:');
  console.error(`    1. $${envVar}  (a ';'-separated list of render folders; entries that do not exist are ignored)`);
  for (const base of busesDirCandidates()) {
    console.error(`    2. ${path.join(base, dirName, '_portal-fixture')}`);
  }
  console.error('');
  console.error('  Fix it by doing ONE of these:');
  console.error(`    - set BUSES_DIR in .env to your buses-data checkout (it holds ${dirName}/_portal-fixture);`);
  console.error(`    - set ${envVar} to a render folder directly;`);
  console.error('    - clone buses-data next to this repo, so the relative path above resolves.');
  console.error('');
  console.error('  Only if you have cloned the portal alone and cannot get the data repo:');
  console.error('    npm run verify -- --allow-skip     (and understand that it proves nothing)');
  process.exit(1);
}
