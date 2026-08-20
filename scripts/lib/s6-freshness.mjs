// Is a town's independent verification (S6) older than the data it verifies?
// technical-audit_2026-08-19 V3.
//
// THE FINDING. The byte gates prove the renderer is deterministic — that the
// same inputs give the same bytes. S6 is the stage that asks the different
// question: is the map RIGHT. It is the cross-model red-team pass, the thing
// that catches a route drawn that no longer runs. On the day of the audit every
// one of the eight towns was S6-stale by 8–31 days, and all thirteen maps were
// live. So what busmaps.uk was serving had passed a reproducibility check and
// not a correctness check since its last refresh.
//
// The staleness was already COMPUTED — the gate board prints `28d STALE` beside
// each town — and nothing acted on it. That is the whole of the finding: a
// number on a board that no gate reads is a number.
//
// THE RULE, matching the skill's status.js so the two cannot disagree: S6 is
// stale when the latest S6 run pre-dates the newest of the latest S1, S2 and S3
// runs. S1/S2/S3 are the INPUTS (pulled facts, fetched geometry, hand-authored
// config); if any of them moved after the last verification, the verification
// was of a different map.
//
// PLACES HAVE NO S6, by design — the place skill runs P1–P5 and stops. That is
// an exemption, not a skip: `check()` says so explicitly and the caller prints
// it, because "the gate did not apply" and "the gate passed" must never look the
// same at the terminal. See the audit's own V2 on exactly that failure.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The manifest run record matching a stage's `latest` id, or null. */
function latestRun(manifest, stage) {
  const s = manifest.stages && manifest.stages[stage];
  if (!s || !s.latest) return null;
  return (s.runs || []).find((r) => r.id === s.latest) || null;
}

/**
 * Walk up from an S5-render directory to the map folder holding manifest.json.
 *
 * A render dir is `<map>/S5-render/<version>`, so the map folder is two levels
 * up — but this takes the first ancestor that actually HAS a manifest rather
 * than counting, so it still works for a hand-assembled or relocated fixture.
 * Returns null if none of the first four ancestors has one.
 */
export function mapDirFor(srcDir) {
  let d = path.resolve(srcDir);
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(d, 'manifest.json'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

const dayssince = (at) => {
  const t = Date.parse(String(at).length <= 16 ? `${at}:00Z` : `${at}Z`);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;
};

/**
 * @returns {{
 *   verdict: 'fresh'|'stale'|'never'|'not-applicable'|'no-manifest',
 *   town: string|null, s6At: string|null, newestDataAt: string|null,
 *   ageDays: number|null, message: string,
 * }}
 *
 * `kind` is 'area' or 'place'. It has to be told: a place manifest carries an
 * S6 stage key like an area's, with `latest: null` and `runs: []` forever,
 * because the shared stage machinery writes all six slots whether or not the
 * pipeline fills them. Reading that as "never verified" and refusing was the
 * first thing this got wrong — every place delivery was blocked by a stage its
 * skill does not have. Structure cannot distinguish them; the caller can.
 */
export function checkS6({ srcDir, mapDir, kind = 'area' } = {}) {
  const dir = mapDir || (srcDir ? mapDirFor(srcDir) : null);
  if (!dir) {
    return {
      verdict: 'no-manifest', town: null, s6At: null, newestDataAt: null, ageDays: null,
      message: `No manifest.json found at or above ${srcDir} — this does not look like a map-tree render folder, so S6 freshness cannot be established either way.`,
    };
  }

  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (e) {
    return { verdict: 'no-manifest', town: null, s6At: null, newestDataAt: null, ageDays: null, message: `Could not read ${path.join(dir, 'manifest.json')}: ${e.message}` };
  }

  const town = manifest.town || manifest.place || path.basename(dir);
  const hasS6Runs = Boolean(manifest.stages && manifest.stages.S6 && (manifest.stages.S6.runs || []).length);
  if (kind === 'place' || !(manifest.stages && manifest.stages.S6)) {
    return {
      verdict: 'not-applicable', town, s6At: null, newestDataAt: null, ageDays: null,
      message: kind === 'place'
        ? `${town} is a place map. The place skill runs P1–P5 and has no independent-verification stage, so there is no S6 to be stale — its manifest's empty S6 slot is the shared stage machinery, not a missing run.`
        : `${town}'s manifest has no S6 stage at all.`,
    };
  }

  const s6 = latestRun(manifest, 'S6');
  const newestDataAt = ['S1', 'S2', 'S3']
    .map((k) => latestRun(manifest, k))
    .filter(Boolean)
    .reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);

  if (!s6 || !hasS6Runs) {
    return { verdict: 'never', town, s6At: null, newestDataAt, ageDays: null, message: `${town} is an area map and has never had an S6 verification pass. Nothing has independently checked that this map is correct.` };
  }
  const ageDays = dayssince(s6.at);
  if (newestDataAt && s6.at < newestDataAt) {
    return {
      verdict: 'stale', town, s6At: s6.at, newestDataAt, ageDays,
      message: `${town}'s S6 verification (${s6.id}, ${s6.at}${ageDays == null ? '' : `, ${ageDays}d ago`}) pre-dates its newest data (${newestDataAt}). It verified a different map from the one being delivered.`,
    };
  }
  return { verdict: 'fresh', town, s6At: s6.at, newestDataAt, ageDays, message: `${town}'s S6 (${s6.id}) is newer than its data — verified.` };
}

/**
 * A dated waiver for one map, from scripts/s6-waivers.json.
 *
 * WHY WAIVERS EXIST AT ALL. On the day this gate landed, all eight towns were
 * stale — so shipping it without waivers would have made it RED on its first
 * run, for everything, and a check that is red on day one gets muted within a
 * week. (The audit's own V4 names gate fatigue as a live problem in this
 * project, and scripts/audit-allowlist.json exists for exactly the same reason.)
 *
 * WHY THEY EXPIRE. A waiver with no end date is a deletion of the rule written
 * in a way that looks like a decision. `until` makes it a debt with a date on
 * it: when it passes, the gate refuses again and someone has to either run S6
 * or consciously renew.
 */
export function findWaiver(waivers, town, { now = new Date() } = {}) {
  const list = (waivers && waivers.waive) || [];
  const w = list.find((x) => String(x.map).toLowerCase() === String(town).toLowerCase());
  if (!w) return null;
  const until = Date.parse(`${w.until}T23:59:59Z`);
  return { ...w, expired: Number.isFinite(until) ? now.getTime() > until : true };
}
