// Is a question only somebody local can answer still outstanding on this map,
// where printing our guess would misdirect a passenger? buses-data OA-083.
//
// Every map build records the questions it could not settle from the feeds in
// the map folder's own `local-decisions.json`, beside `manifest.json`: one
// decision per question, with `severity` `advisory` or `blocking` and an
// `answer` that is null until somebody is asked. The schema is
// make-bus-leaflet/references/local-decisions.md in claude-skills. `blocking` is
// reserved for the case where a wrong answer sends a passenger to the wrong
// stop or tells them a bus runs that does not — and until this gate, nothing
// read it. Peter ruled on 2026-09-26 that those questions go to the customer by
// LETTER rather than into the editor, so this is the one place that holds the
// line: a map is not delivered while one of its blocking questions is open.
//
// ANSWERED means `answered` or `dont-know`. `dont-know` is a real, terminal
// answer — our default stands and is now a recorded decision — so it clears the
// gate. Everything else is outstanding: null (never asked), `asked` (asked and
// waiting), `open`, `partly-answered`, and any state this file has not learned,
// because a state nobody taught the gate must not fall out of it as a pass.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mapDirFor } from './s6-freshness.mjs';

export const ANSWERED_STATES = Object.freeze(['answered', 'dont-know']);

/** A decision's answer state as a string: 'never-asked' for a null answer or state. */
export function stateOf(d) {
  const s = d && d.answer && d.answer.state;
  return s == null ? 'never-asked' : String(s);
}

/**
 * The gate's reading of one map.
 *
 * @returns {{
 *   verdict: 'clear'|'no-file'|'outstanding'|'unreadable'|'no-manifest',
 *   map: string|null, file: string|null,
 *   outstanding: Array<{ id: string, state: string, question: string }>,
 *   message: string,
 * }}
 */
export function checkLocalDecisions({ srcDir, mapDir } = {}) {
  const dir = mapDir || (srcDir ? mapDirFor(srcDir) : null);
  if (!dir) {
    return { verdict: 'no-manifest', map: null, file: null, outstanding: [],
      message: `No manifest.json found at or above ${srcDir} — the map folder, and so its local-decisions.json, cannot be found.` };
  }
  let map = path.basename(dir);
  try {
    const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    map = m.town || m.place || map;
  } catch { /* the S6 gate reports an unreadable manifest; the folder name will do here */ }

  const file = path.join(dir, 'local-decisions.json');
  if (!existsSync(file)) {
    return { verdict: 'no-file', map, file, outstanding: [],
      message: `${map} has no local-decisions.json — the build recorded no question for somebody local.` };
  }
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    return { verdict: 'unreadable', map, file, outstanding: [],
      message: `Could not read ${file}: ${e.message}. Whether a blocking question is open is unknown — which is not the same as none.` };
  }
  if (!doc || !Array.isArray(doc.decisions)) {
    return { verdict: 'unreadable', map, file, outstanding: [],
      message: `${file} has no "decisions" array, so it cannot be read as local decisions.` };
  }

  const outstanding = doc.decisions
    .filter((d) => d && d.severity === 'blocking' && !ANSWERED_STATES.includes(stateOf(d)))
    .map((d) => ({ id: String(d.id), state: stateOf(d), question: String(d.question || '') }));
  if (!outstanding.length) {
    const blocking = doc.decisions.filter((d) => d && d.severity === 'blocking').length;
    return { verdict: 'clear', map, file, outstanding,
      message: `${map}: ${blocking} blocking question(s) recorded, every one answered.` };
  }
  return { verdict: 'outstanding', map, file, outstanding,
    message: `${map} has ${outstanding.length} blocking local question(s) still open: ${outstanding.map((o) => `${o.id} (${o.state})`).join(', ')}.` };
}

/**
 * A dated deferral for ONE decision on one map, from
 * scripts/local-decision-waivers.json. Keyed by map AND decision, never by map
 * alone: a waiver for a map would silently cover the next blocking question a
 * rebuild records, which is the question nobody has yet read. Expires the same
 * way scripts/s6-waivers.json does, for the same reason.
 */
export function findDecisionWaiver(waivers, map, decision, { now = new Date() } = {}) {
  const list = (waivers && waivers.waive) || [];
  const w = list.find((x) => String(x.map).toLowerCase() === String(map).toLowerCase()
    && String(x.decision) === String(decision));
  if (!w) return null;
  const until = Date.parse(`${w.until}T23:59:59Z`);
  return { ...w, expired: Number.isFinite(until) ? now.getTime() > until : true };
}
