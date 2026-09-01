// What a generator said on the way to a SUCCESSFUL render, and which of it an
// editor can act on (OA-216).
//
// WHY THIS EXISTS. `gen_internal.js` ends by comparing the POIs a customer marked
// *Must show* against the labels the placer actually seated, and writes the
// difference to stderr — *"3 of 20 must POIs were still not placed on this
// sheet"*, naming each one. Its own comment calls that warning "the only thing
// standing between a classified POI and an answer that failed without saying so".
// Two siblings sit beside it: a `poi.tiers` key that matched no POI and did
// nothing, and a rename that collided so two places share one override key.
//
// All three are written with `process.stderr.write` and not with `refuse()`, and
// that is deliberate — they are not refusals to draw, the sheet is still worth
// having — so the run exits 0. And `renderMap.js` read stderr ONLY when the exit
// status was non-zero. On the success path, which is the path all three take, the
// whole stream was discarded unread and `generateSvg()` returned `log: stdout`,
// which none of them use.
//
// So the chooser's promise had a hole in it exactly where it was most expensive.
// An editor marks twenty places *Must show*, saves, and is told "Saved as version
// 2.3. The map has been redrawn with your choices" — while three of those choices
// did not happen. The page's soft cap at twelve was a guess offered in place of
// the real answer, which the generator had computed and thrown away.
//
// STDERR-ON-FAILURE-ONLY IS A CATEGORY ERROR RATHER THAN AN OVERSIGHT, and that
// is what decided the shape of this file: a guard is only ever as good as the
// READING of it, and a caller that opens the stream only when the exit status is
// non-zero has decided in advance that a run which succeeded has nothing to say.
// That is precisely the reasoning `STRICT_GUARDS` was invented to overturn.
//
// WHAT IT DELIBERATELY DOES NOT DO: hand the whole stream to the customer. Most
// of what a generator writes there is addressed to whoever is building the map —
// `labels:`, `placeIndex:`, `fit:`, `buildMeta:`, `exitDevice:` — and is about
// engine internals a customer cannot act on and should not have to read. So the
// selection is a LIST, not a filter of things to hide: a line is shown to the
// editor only if this file names its prefix and gives it a sentence in the
// editor's own words. Everything else is still returned in `all`, which is what
// the server logs, so nothing is lost — only unaddressed.

/** Prefixes an editor can act on, and how to say each one to them.
 *
 * The generator's own text is kept as the DETAIL rather than rewritten away: it
 * names the actual landmarks ("Tesco Extra", "The Priory") and the remedies, and
 * a translation that dropped those would be worse than the raw line. What the
 * heading adds is what the raw line cannot say — whether the customer's answer
 * happened, which is the only question they were asking. */
const EDITOR_FACING = [
  {
    prefix: 'poi.tiers:',
    /* All three `poi.tiers:` lines are about the customer's own classification,
     * which is why one prefix covers them. The heading is chosen from the line
     * so a reader is not told "a key did nothing" about a placement failure. */
    heading: (line) =>
      /must" POI|must POI|"must"/.test(line)
        ? 'Some places you marked Must show could not be fitted on the sheet'
        : /rename has collided/.test(line)
          ? 'Two places now share one name, so they share one entry'
          : 'Part of your answer named nothing on this sheet and did nothing',
  },
];

/**
 * Split a generator's stderr into what an editor should see and everything else.
 *
 * @param {string} stderr  the raw stream from a run that EXITED 0
 * @param {string} [generator]  the generator's filename, for the log lines
 * @returns {{ editor: {heading: string, detail: string}[], all: string[] }}
 */
export function readGenWarnings(stderr, generator = '') {
  const all = String(stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const editor = [];
  for (const line of all) {
    const rule = EDITOR_FACING.find((r) => line.startsWith(r.prefix));
    if (!rule) continue;
    editor.push({
      heading: rule.heading(line),
      // The prefix is an engine namespace, not something to show a customer.
      detail: line.slice(rule.prefix.length).trim(),
      generator,
    });
  }
  return { editor, all };
}

/**
 * Merge the warnings from several generator runs of one render.
 *
 * A map draws up to four sheets and each runs its own generator, so the same
 * unplaceable landmark can be reported more than once — by the schematic and by
 * the plain internal, say. An editor asked one question and wants one answer, so
 * identical headings collapse and their details are joined. Which SHEET could
 * not fit it is a fact about the engine's layout and not about their choice, so
 * it is kept only in `all`, which the server logs.
 */
export function mergeGenWarnings(perRun) {
  const seen = new Map();
  for (const w of perRun.flatMap((r) => r.editor || [])) {
    const key = w.heading + '\u0000' + w.detail;
    if (!seen.has(key)) seen.set(key, w);
  }
  return [...seen.values()].map(({ heading, detail }) => ({ heading, detail }));
}
