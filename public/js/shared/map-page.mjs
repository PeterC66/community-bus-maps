// The words a crawler reads on /m/<slug> (buses-data OA-501). Shared by the
// server, which writes them into the page, and by scripts/test-ssr.mjs, which
// holds them to what the action asked for.
//
// WHY THIS EXISTS. /m/wisbech was on Google from 19 September 2026 and ranked
// for nothing: its <title> was "Buses within Wisbech", which does not contain
// the words "bus map" that people search for, and the HTML a crawler received
// had no heading and no text, because the page fills its own body in the
// browser. So the title now names the place first and says "bus map", and the
// server writes an <h1> and one sentence naming the place and its services.
//
// A plain ES module for the reason map-card.mjs is one: the server imports it.
// The browser script public/js/public-map.js is a classic script and keeps its
// own copy of the headline string; the two are the same sentence on purpose.

import { esc } from './map-card.mjs';

/** The visible heading: "Buses within Wisbech" / "Buses serving St Neots Co-op". */
export function mapHeadline(map) {
  return map.kind === 'place' ? `Buses serving ${map.name}` : `Buses within ${map.name}`;
}

/** The <title>, as text: the place first, then "bus map", then the headline. */
export function mapTitle(map) {
  return `${map.name} bus map — ${mapHeadline(map)}`;
}

/** "1, 2, 3 and X1" — the service numbers in the order the list gives them, each once. */
export function serviceList(ids) {
  const seen = [...new Set((ids || []).map((s) => String(s).trim()).filter(Boolean))];
  if (seen.length <= 1) return seen.join('');
  return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
}

/**
 * The one sentence under the heading, as HTML (every value escaped here).
 * `ids` are the published version's service numbers; with none — a payload
 * whose service list cannot be read — the sentence still names the place.
 */
export function mapLead(map, ids) {
  const name = esc(map.name);
  const list = serviceList(ids);
  const n = list ? [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))].length : 0;
  if (!n) {
    return map.org && map.org.name
      ? `The ${name} bus maps, published by ${esc(map.org.name)}, free to view, print and share.`
      : `The ${name} bus maps, free to view, print and share.`;
  }
  const noun = n === 1 ? 'bus service' : 'bus services';
  return map.kind === 'place'
    ? `The ${name} bus maps show the ${n} ${noun} that ${n === 1 ? 'calls' : 'call'} there: ${esc(list)}.`
    : `The ${name} bus maps show ${n} ${noun}: ${esc(list)}.`;
}
