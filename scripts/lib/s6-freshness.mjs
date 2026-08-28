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
// TWO THINGS THIS GOT WRONG, both fixed 2026-08-28 (OA-003, OA-133).
//
// IT READ DATES AND NEVER THE VERDICT. The rule above answers "was the map
// verified AFTER its data moved". It never answered "and did it PASS". So after
// the 2026-08-26 runs, five towns that came back BLOCKED all reported `fresh`
// here and would have been accepted as verified — and the waiver file no longer
// protected them either, because `gateS6()` consults it only when the verdict is
// STALE, so a fresh-but-failing S6 skipped the deferral check entirely. Running
// the check turned five refusals into five silent passes. The verdict is now
// read from the run's own `verification.json`, whose `summary.verdict` is one of
// `pass` | `blocked` | `not-verified-uncurated-s1` (older files carry only
// `summary.pass`, and are read through that).
//
// AND IT EXEMPTED EVERY PLACE, on a premise that stopped being true on
// 2026-08-08. The old comment here said the place skill "runs P1–P5 and has no
// independent-verification stage, so there is no S6 to be stale". Every clause
// of that is now wrong: `make-place-bus-leaflet` gained one via
// `place_verified_services.js`, the procedure is written up in the skill's
// `references/s6-verify.md`, and two places hold real S6 runs. The tell was one
// line above the bug — `hasS6Runs` was computed and then never consulted, the
// same shape as the `status.js` fault where twelve sheet-gates were decorative
// for their whole lives. A place is now judged exactly as an area is; a place
// with an empty S6 slot reads `never`, which is true and is what the waiver file
// is for.
//
// THE EXEMPTION THAT REMAINS is a manifest with no S6 stage key at all, and it
// is still named out loud rather than passed over: "the gate did not apply" and
// "the gate passed" must never look the same at the terminal. See the audit's
// own V2 on exactly that failure.

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
 * Read the verdict the latest S6 run recorded, from its own verification.json.
 *
 * `summary.verdict` has existed since 2026-08-27 and is explicit. Runs stored
 * before that carry only `summary.pass`, so fall back to it rather than
 * treating an older report as unreadable — Ramsey's 2026-08-26 run is exactly
 * that shape and says `pass:false`, which is the case this gate exists for.
 *
 * A file that is absent or unparseable returns null, and the caller turns that
 * into `no-verdict`, NOT into a pass. verification.json is gitignored in the
 * data repo on purpose (our own code rebuilds it for free), so a fresh clone has
 * none of them; "I could not read the answer" and "the answer was yes" must not
 * report the same way.
 */
function readVerdict(runDir) {
  const p = path.join(runDir, 'verification.json');
  if (!existsSync(p)) return null;
  let v;
  try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  const sum = v && v.summary;
  if (!sum) return null;
  const verdict = sum.verdict || (sum.pass === true ? 'pass' : sum.pass === false ? 'blocked' : null);
  if (!verdict) return null;
  return { verdict, hard: sum.hard ?? null, soft: sum.soft ?? null, path: p };
}

/**
 * @returns {{
 *   verdict: 'fresh'|'stale'|'never'|'failed'|'unverified'|'no-verdict'|'not-applicable'|'no-manifest',
 *   town: string|null, s6At: string|null, newestDataAt: string|null,
 *   ageDays: number|null, message: string,
 *   s6Verdict: string|null, hard: number|null, soft: number|null,
 * }}
 *
 * `kind` is 'area' or 'place'. It no longer changes the answer — places are
 * verified now and are judged the same way — but it is still taken, and still
 * reported, because the two read differently in a refusal message and every
 * caller already passes it.
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
  const what = kind === 'place' ? 'place' : 'area';
  const base = { town, s6At: null, newestDataAt: null, ageDays: null, s6Verdict: null, hard: null, soft: null };
  const hasS6Runs = Boolean(manifest.stages && manifest.stages.S6 && (manifest.stages.S6.runs || []).length);
  if (!(manifest.stages && manifest.stages.S6)) {
    return { ...base, verdict: 'not-applicable', message: `${town}'s manifest has no S6 stage at all.` };
  }

  const s6 = latestRun(manifest, 'S6');
  const newestDataAt = ['S1', 'S2', 'S3']
    .map((k) => latestRun(manifest, k))
    .filter(Boolean)
    .reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);

  if (!s6 || !hasS6Runs) {
    return { ...base, verdict: 'never', newestDataAt, message: `${town} is a ${what} map and has never had an S6 verification pass. Nothing has independently checked that this map is correct.` };
  }
  const ageDays = dayssince(s6.at);
  const stale = Boolean(newestDataAt && s6.at < newestDataAt);
  const when = `${s6.id}, ${s6.at}${ageDays == null ? '' : `, ${ageDays}d ago`}`;
  const staleNote = stale
    ? ` It is ALSO stale: it pre-dates the map's newest data (${newestDataAt}), so it verified a different map from the one being delivered.`
    : '';
  const got = readVerdict(path.join(dir, s6.dir || path.join('S6-verify', s6.id)));
  const found = { ...base, s6At: s6.at, newestDataAt, ageDays, s6Verdict: got ? got.verdict : null, hard: got ? got.hard : null, soft: got ? got.soft : null };

  // THE VERDICT COMES FIRST, before the dates. A run that came back BLOCKED is
  // not made acceptable by being recent, and a reader told only "stale" would go
  // and re-run S6 rather than look at what the last one said.
  if (!got) {
    return { ...found, verdict: 'no-verdict',
      message: `${town}'s latest S6 run (${when}) is recorded in the manifest, but its verification.json could not be read at ${path.join(dir, s6.dir || '', 'verification.json')}. What the run concluded is unknown — which is not the same as a pass.${staleNote}` };
  }
  if (got.verdict === 'blocked') {
    return { ...found, verdict: 'failed',
      message: `${town}'s latest S6 verification (${when}) came back BLOCKED: ${got.hard} hard finding(s), ${got.soft} soft. The map was independently checked and the check says it is wrong.${staleNote}` };
  }
  if (got.verdict !== 'pass') {
    return { ...found, verdict: 'unverified',
      message: `${town}'s latest S6 run (${when}) reports "${got.verdict}" rather than a pass — it could not reach a verdict, so nothing has established that this map is correct. (${got.hard} hard, ${got.soft} soft, and the hard count says nothing while the verdict is this.)${staleNote}` };
  }
  if (stale) {
    return { ...found, verdict: 'stale',
      message: `${town}'s S6 verification (${when}) PASSED, but it pre-dates its newest data (${newestDataAt}). It verified a different map from the one being delivered.` };
  }
  return { ...found, verdict: 'fresh',
    message: `${town}'s S6 (${s6.id}) is newer than its data and came back PASS — ${got.hard} hard, ${got.soft} soft. Verified.` };
}

/**
 * The verdicts that STOP a delivery unless a dated deferral covers them.
 *
 * This lives here, beside the function that produces the verdicts, rather than
 * in the caller's control flow, because the two drifting apart is the bug this
 * whole change is about: `gateS6()` consulted the waiver file under a comment
 * reading `// stale | never`, so when a sixth verdict could reach that point the
 * deferral check would silently not apply to it. A caller asks this set rather
 * than re-listing them, and `refuses()` is what the tests assert through.
 *
 * `fresh` is the only pass. `not-applicable` and `no-manifest` are handled by the
 * caller before this is reached and are deliberately absent: one is an exemption
 * that must be printed rather than waived, the other a refusal that a deferral
 * must not be able to buy off, because it means the gate could not see its
 * evidence at all.
 */
export const REFUSING_VERDICTS = Object.freeze(['stale', 'never', 'failed', 'unverified', 'no-verdict']);
export function refuses(verdict) { return REFUSING_VERDICTS.includes(verdict); }

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
