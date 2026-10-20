// Is this refresh covered by the month's ink review? buses-data OA-658.
//
// THE FINDING. The ink review (`ink_review.mjs` in claude-skills' bus-work) is the
// one human look a monthly refresh keeps: a map whose sheets moved reaches its
// customer only once Peter has accepted THAT build. `stage_refresh.mjs` asked the
// review before it ran this script, and nothing else did. On 2026-10-20 at 01:02
// Beaconsfield Simpson Centre v1.46 and Beaconsfield Waitrose v1.40 were delivered
// by hand, straight through `npm run deliver`, under accepts that were for v1.45 and
// v1.39 (proposed updates #186 and #187), and Peter was asked to accept them again
// after the customer already had them. So deliver-map.mjs now asks for itself.
//
// THE RULE. Find the map folder from --src (the manifest above it, as steps 0 and
// 0c do), walk up to the tree that holds `_gtfs/`, and read every
// `_gtfs/ink-review_<scan>.json` there. The CURRENT review — the newest scan's —
// judges the map if it lists the map's folder; an older one never does, because a
// named map stays in its review for good. The render being delivered is matched to its S4
// build through the manifest (`basedOn.S4`, else the build's version, never the
// folder name, because S5 names its folder by its own start minute). Then:
//   covered        no ink moved and the review compared this build, or Peter
//                  accepted this build;
//   uncovered      ink moved and he has not accepted this build, he held it, or the
//                  review compared another build (a rebuild since it was collected);
//   already-staged the review records this build as staged — a second delivery
//                  would be a second proposal and a second email;
//   not-in-review  no review lists this map, or there is no review tree above it
//                  (a committed fixture pack), and the gate says so out loud;
//   cannot-tell    a review file that will not parse (it might hold this map), a
//                  manifest that will not, or a render whose build cannot be found.
// Only `covered` and `not-in-review` pass. Like steps 0–0d, cannot-tell refuses.
//
// AND THE STAGING IS RECORDED HERE. A hand delivery used to leave the review's
// `staged` to whoever ran it (`ink_review.mjs --staged`), and St Ives Bus Station's
// #171 sat unrecorded for six days (buses-data OA-573). `recordArgs()` builds that
// same command from what this delivery knows, and deliver-map.mjs runs it once
// propose-update has staged the update. The record is the bus-work tool's own file,
// so the tool that owns it writes it; nothing here edits it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mapDirFor } from './s6-freshness.mjs';

const fwd = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');

/** The folder above `mapDir` that holds `_gtfs/` — the buses-data tree — or null. */
export function reviewRootFor(mapDir) {
  let d = path.resolve(mapDir);
  for (let i = 0; i < 6; i++) {
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
    if (existsSync(path.join(d, '_gtfs'))) return d;
  }
  return null;
}

/** Every `_gtfs/ink-review_<scan>.json` under `root`, newest first; `review` is null and `error` set for one that will not parse. */
export function readReviews(root) {
  const dir = path.join(root, '_gtfs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => /^ink-review_(\d{4}-\d{2}-\d{2})\.json$/.exec(f)).filter(Boolean)
    .map((m) => m[1]).sort().reverse()
    .map((scan) => {
      const file = path.join(dir, `ink-review_${scan}.json`);
      try {
        const review = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(review && review.maps) ? { scan, file, review } : { scan, file, review: null, error: 'it has no "maps" list' };
      } catch (e) { return { scan, file, review: null, error: e.message }; }
    });
}

const versionOf = (id) => (String(id || '').match(/^v(\d+(?:\.\d+)*)_/) || [])[1] || null;

/** The S4 build an S5 run renders: its declared `basedOn.S4`, else the S4 run of the same version. */
export function buildOf(manifest, render) {
  if (!render) return null;
  if (render.basedOn && render.basedOn.S4) return render.basedOn.S4;
  const v = render.version || versionOf(render.id);
  const runs = (manifest && manifest.stages && manifest.stages.S4 && manifest.stages.S4.runs) || [];
  const hit = v && runs.find((r) => (r.version || versionOf(r.id)) === v);
  return hit ? hit.id : null;
}

/**
 * The gate's reading of one delivery.
 *
 * @returns {{
 *   verdict: 'covered'|'uncovered'|'already-staged'|'not-in-review'|'cannot-tell',
 *   message: string, scan: string|null, map: string|null, build: string|null,
 *   root: string|null, file: string|null,
 * }}
 */
export function checkInkReview({ srcDir } = {}) {
  const none = { scan: null, map: null, build: null, root: null, file: null };
  const mapDir = srcDir ? mapDirFor(srcDir) : null;
  if (!mapDir) return { ...none, verdict: 'cannot-tell', message: `No manifest.json found at or above ${srcDir}, so which map this is, and whether the ink review covers it, cannot be told.` };
  const root = reviewRootFor(mapDir);
  if (!root) return { ...none, verdict: 'not-in-review', message: `No _gtfs/ folder above ${mapDir}, so this is not a map tree an ink review covers.` };
  const reviews = readReviews(root);
  const rel = fwd(path.relative(root, mapDir));
  if (!reviews.length) return { ...none, root, verdict: 'not-in-review', message: `${root} holds no ink review, so none lists ${rel}.` };
  /* The CURRENT review only: a map somebody named is carried in its review for good,
   * and an October accept must not go on deciding a December rebuild. */
  const r = reviews[0];
  if (!r.review) return { ...none, root, verdict: 'cannot-tell', file: r.file, message: `${r.file}, the current ink review, will not parse (${r.error}), and it may hold this map — whether it covers this delivery cannot be told.` };
  const dirOf = (x) => fwd(x.dir === undefined ? `Areas/${x.map}` : x.dir);
  const m = r.review.maps.find((x) => x && dirOf(x) === rel);
  if (!m) return { ...none, root, verdict: 'not-in-review', file: r.file, message: `${rel} is not in the current ink review (${r.scan}).` };
  const at = { ...none, root, scan: r.scan, map: m.map, file: r.file };

  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(mapDir, 'manifest.json'), 'utf8')); } catch (e) {
    return { ...at, verdict: 'cannot-tell', message: `${m.map}'s manifest.json will not parse (${e.message}), so the build this render draws cannot be found.` };
  }
  const srcRel = fwd(path.relative(mapDir, path.resolve(srcDir)));
  const render = ((manifest.stages && manifest.stages.S5 && manifest.stages.S5.runs) || []).find((x) => fwd(x.dir) === srcRel);
  const build = buildOf(manifest, render);
  if (!build) return { ...at, verdict: 'cannot-tell', message: `${srcRel} is ${render ? 'an S5 run whose S4 build is not in' : 'not an S5 run listed in'} ${m.map}'s manifest, so whether the ${r.scan} review covers it cannot be told.` };
  const said = { ...at, build };

  if (m.staged && m.staged.after === build) return { ...said, verdict: 'already-staged', message: `the ${r.scan} review records ${m.map} ${build} as staged by ${m.staged.by} at ${m.staged.at}${m.staged.proposal ? ` (proposed update #${m.staged.proposal})` : ''} — a second delivery would be a second proposal and a second email.` };
  if (m.after !== build) return { ...said, verdict: 'uncovered', message: `the ${r.scan} review compared ${m.map} ${m.after || '(no build)'}, and this render is of ${build}${m.answer ? `; the ${m.answer.verdict} was for ${m.answer.after}` : ''}. Re-collect it (ink_review.mjs --scan ${r.scan}), which carries an answer forward when the ink is unchanged.` };
  if (m.status === 'no-ink') return { ...said, verdict: 'covered', message: `the ${r.scan} review found no ink moved on ${m.map} ${build}.` };
  if (m.status !== 'ink-moved') return { ...said, verdict: 'uncovered', message: `the ${r.scan} review could not read ${m.map} (${m.status}${m.detail ? `: ${m.detail}` : ''}).` };
  if (!m.answer || m.answer.after !== build) return { ...said, verdict: 'uncovered', message: `${m.map}'s ink moved in the ${r.scan} review and Peter has not accepted ${build}.` };
  if (m.answer.verdict !== 'accept') return { ...said, verdict: 'uncovered', message: `Peter held ${m.map} ${build} in the ${r.scan} review${m.answer.note ? ` (${m.answer.note})` : ''}.` };
  return { ...said, verdict: 'covered', message: `Peter accepted ${m.map} ${build} in the ${r.scan} review${m.answer.self ? ' (by rule)' : ''}.` };
}

/** The proposed-update number propose-update.mjs prints on success, or null. */
export function proposalFrom(output) {
  const m = /proposed update #(\d+) staged for/.exec(String(output || ''));
  return m ? Number(m[1]) : null;
}

/**
 * The argv, after `node`, that records this staging in the review with the bus-work
 * tool that owns the record. `notify` is 'digest' when the delivery went with
 * --no-notify, so the round's one email is still owed (buses-data OA-152).
 */
export function recordArgs({ inkReviewJs, root, scan, map, slug, proposal, by, notify }) {
  return [inkReviewJs, '--buses', root, '--scan', scan, '--staged', '--town', map, '--map', slug, '--proposal', String(proposal), '--by', by, ...(notify ? ['--notify', notify] : [])];
}
