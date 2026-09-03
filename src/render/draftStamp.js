// The DRAFT / IN REVIEW marking on a version that has not been published,
// applied at download time on the authenticated per-version route
// (/api/maps/:id/versions/:key/:file in server.js).
//
// WHY IT IS HERE AND NOT IN THE RENDER. A version is always a draft at the moment
// it is rendered, and publishing it does not re-render: approving a publish request
// flips review_state and moves the map's pointer, and the bytes the approver signed
// off are the bytes that go public. So the render can only carry what is true in
// BOTH states — the plain number, "Map version 5.0" — and the state has to be added
// on the way out to whoever is looking at an unpublished copy.
//
// The alternatives were worse. Re-rendering on publish would mean the artwork that
// was reviewed is not the artwork that was published, which is the one guarantee
// this product rests on. Rewriting the stored file in place at publish time would
// mutate a reviewed artefact inside the publish transaction, at the worst possible
// moment to have a new failure mode.
//
// The source render is never touched: this writes siblings beside it and reuses
// them on later requests, regenerating only when the source is newer — the same
// contract as watermark.js, whose shape this deliberately copies.
//
// WHAT IT REWRITES. Exactly one <text> element, the one footer.js emits for
// design.sheetVersion. It is matched on its own words rather than on an id,
// because giving it an id would change the engine's output and move all thirteen
// shipped sheets for a marking none of them carries.

import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { rasterise } from './renderMap.js';
import { parseDbDate } from '../db/dates.js';

// footer.js draws it end-anchored in the footer's own grey. Capturing the whole
// element and its attributes lets the replacement inherit them, so the marked line
// sits exactly where the plain one did.
const VERSION_LINE = /(<text\b[^>]*text-anchor="end"[^>]*>)Map version [^<]*(<\/text>)/;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-08-19 14:02:11' or an ISO string -> '19 Aug 2026 14:02'. */
function when(created) {
  const d = parseDbDate(created);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * The words for a version that is not published. `pending` means an editor has
 * asked for it to be reviewed and an approver has not decided yet, so it says so —
 * that is the copy Peter is most likely to be marking up.
 *
 * Kept SHORT on purpose. The line is end-anchored at the right of the footer band
 * and grows leftward towards the attribution notes; "Draft 5.0 · 19 Aug 2026 14:02"
 * is about 38mm at 2.8mm type against roughly 48mm of clear band on a town sheet.
 */
export function draftLabel(state, versionNumber, createdAt) {
  const word = state === 'pending' ? 'In review'
    : state === 'superseded' ? 'Superseded'
    : state === 'rejected' ? 'Not published'
    : 'Draft';
  const stamp = when(createdAt);
  return `${word} ${versionNumber}${stamp ? ` · ${stamp}` : ''}`;
}

/** Where the cached draft-marked variant of a source file lives. */
export function draftPathFor(sourcePath) {
  const dir = path.dirname(sourcePath);
  const ext = path.extname(sourcePath);
  return path.join(dir, `${path.basename(sourcePath, ext)}-draft${ext}`);
}

/**
 * Return a path to a draft-marked copy of `sourcePath` (.svg or .jpg), generating
 * it if needed. Returns null when there is nothing to do — no source, an
 * unsupported type, or a sheet whose footer carries no version line at all (every
 * render made before this landed, which must keep downloading fine).
 *
 * Never throws for odd input; the caller falls back to the original file.
 */
export async function ensureDraftMarked(sourcePath, label) {
  if (!sourcePath || !existsSync(sourcePath) || !label) return null;
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext !== '.svg' && ext !== '.jpg') return null;

  const svgSource = ext === '.svg' ? sourcePath : sourcePath.replace(/\.jpg$/i, '.svg');
  if (!existsSync(svgSource)) return null;
  const svg = readFileSync(svgSource, 'utf8');
  if (!VERSION_LINE.test(svg)) return null;      // pre-stamp render: serve it as it is

  const outPath = draftPathFor(sourcePath);
  const markedSvgPath = draftPathFor(svgSource);
  const marked = svg.replace(VERSION_LINE, (_m, open, close) => `${open}${esc(label)}${close}`);

  /* THE CACHE IS KEYED ON THE LABEL, not just on the source's age.
   *
   * Keying it on mtime alone — which is all watermark.js needs, because its
   * overlay never changes — was wrong here and wrong in the way that survives a
   * happy-path test: a version's review_state MOVES (draft -> pending on submit,
   * published -> superseded when the next one lands) while the source render sits
   * untouched, so every state after the first served the first one's file. Caught
   * by asking for three states in a row and getting "Draft" three times.
   *
   * Comparing the marked SVG we are about to write against the one on disk keys it
   * on the exact bytes wanted, needs no new sidecar, and covers the JPG too, since
   * the JPG is rasterised from precisely this SVG.
   */
  const fresh = existsSync(markedSvgPath)
    && readFileSync(markedSvgPath, 'utf8') === marked
    && statSync(markedSvgPath).mtimeMs >= statSync(svgSource).mtimeMs;

  if (ext === '.svg') {
    if (!fresh) writeFileSync(outPath, marked);
    return outPath;
  }
  // The JPG is re-rasterised from the marked SVG with the same rasterise() the
  // renderer uses, so a marked download is what the renderer would have produced
  // had the line said this in the first place. Cached, so this cost is paid once
  // per version per state per output, not once per request.
  if (fresh && existsSync(outPath) && statSync(outPath).mtimeMs >= statSync(markedSvgPath).mtimeMs) {
    return outPath;
  }
  writeFileSync(markedSvgPath, marked);
  await rasterise(markedSvgPath, outPath);
  return outPath;
}
