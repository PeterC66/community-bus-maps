// The landmark chooser (OA-212).
//
// Replaces a 171-row markdown worksheet that was tried on its first reader and
// failed: too long to face, ambiguous about how to answer it (a write-in column
// AND a JSON block, neither marked as the primary one), and framed in our terms
// — page area — rather than the reader's, which is whether somewhere is a place
// people navigate by.
//
// So: three choices per place, a rename, per-category bulk answers, and the
// town's own streets underneath so the judgement is made looking at where each
// place actually is. The three choices are the engine's must / may / miss and
// the reader never sees those words.
//
// WHAT IT WRITES. `overrides.internal.poiTiers`, through the same save endpoint
// and the same safe-subset gate as every other customer edit — NOT the editor's
// older `internal.pois[k].hide`. The two are not interchangeable: `hide` is a
// render-time override that leaves the symbol reserving its 4.2 mm box, so a
// reader told they were making room would have been told something false. A
// tier is applied at selection, before anything reserves anything.
//
// It carries the map's OTHER overrides with it on save. Route colours live in
// the same object and sanitizeOverrides() rebuilds that object from scratch, so
// posting only this page's own key would discard them.
//
// SECOND ROUND (OA-215). The screen went back to the reader it was built for and
// came back with nine things. Two were faults rather than preferences, and both
// are fixed here. An *Answered* filter that could not see the middle answer: a
// `may` carrying no rename was dropped on the way to disk, so nothing — not the
// file, not the count, not the filters — could tell "I have looked at this and
// it is right as it is" from "I have not reached this row yet", which is the
// difference that matters when 145 rows are worked through over several
// sittings. And a chip reading *Losing its name now* that consulted no render of
// anything and was in fact the exact complement of *Symbol only*.
//
// ROUND THREE (OA-220). The same reader, the same screen, six more things, and
// three of them are faults.
//
// THE MAP-CLICK HANDLER HAD NEVER FIRED. It was written on this page's first
// day, it read the click event's target, and `setPointerCapture` in the pan
// handler eleven lines above it retargets that click to the <svg> — so
// `closest('[data-key]')` was null every single time, from the day it was
// committed. Nothing here could have caught it: the handler is not wrong, no
// test asserts that a handler fires, and the map panned perfectly throughout.
// It surfaced only because the reader asked for a feature that already existed.
// Selection now comes off a pointerdown/pointerup tap test, which reads the
// target BEFORE capture is taken, and which also stops a drag that happens to
// finish over a dot from selecting it. Falsified in a browser — two identical
// SVGs, one capturing and one not — rather than reasoned about, because pointer
// capture is exactly the kind of thing to be confidently wrong about.
//
// The other two faults. The tally's third figure was `total - must - miss`
// under the words "left as they are": an answered `may` and a row nobody has
// reached, added together and given a name that describes the history of
// neither, on a page that cannot know what a place started as. And an option
// that is ALREADY chosen fires no `change`, so the default answer — the one
// OA-215 went to some trouble to make recordable — was still the one answer
// that could not be given in a single click.
//
// The three the reader asked for: the map travels to a place picked in the
// list, the sheet's own twelve pictograms replace the coloured dots, and the
// road names the basemap has always sent and this file threw away get a
// decluttered layer. That last was measured before it was designed — labelling
// only the MAJOR roads, the obvious cut, yields two labels on the map he is
// actually looking at.
//
// The other seven are reach rather than truth: the map zooms from four gestures
// instead of only the wheel (the reader works on a trackpad, where a wheel
// gesture is not something anyone finds by accident), a chosen row closes again,
// the list holds its place across a filter change, the order is alphabetical and
// SAID OUT LOUD rather than by group size and unstated, and the export block —
// which copies a poi.tiers block for another repository — is admin-only, because
// it is our chore and not something to reason about beside a button saying Save.

const MAP_ID = Number((location.pathname.match(/\/app\/maps\/(\d+)/) || [])[1]);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The reader's words for the engine's three. The engine keys never show. */
const TIER_LABEL = { must: 'Must show', may: 'Show if there is room', miss: 'Do not show' };
const TIERS = ['must', 'may', 'miss'];

/** Above this many "Must show", the page says something. Not a limit — a nudge. */
const MUST_SOFT_CAP = 12;

/** How far in the map will go, as a multiple of the whole-town view. */
const MAX_ZOOM = 40;
/** One press of +, - or one double-click. The wheel uses a finer step. */
const ZOOM_STEP = 1.6;
/**
 * How close the map goes when you pick a place from the list.
 *
 * WRITTEN AS PRESSES OF THE + BUTTON, because that is the only unit anybody has
 * for this. Peter, on the live screen: "click on list item >> map goes to the
 * equivalent of 5 clicks on +. I would prefer the equivalent of 3 clicks."
 *
 * The old value was a bare 9, and a bare 9 invites the reading it got from its
 * own author when reporting it — "a ninth of the town", which sounds like area
 * and is not. It divides the view's WIDTH, so a ninth of the width is a
 * EIGHTY-FIRST of the area, and 9 was 4.7 presses rather than the round number
 * it looked like. Derived from ZOOM_STEP it cannot drift from the buttons and
 * it cannot be misread: three presses is three presses.
 *
 * It only ever zooms IN. Somebody already closer than this chose to be, and
 * hauling them back out is this same complaint pointing the other way.
 */
const FOCUS_ZOOM = ZOOM_STEP ** 3;
/** How long the map takes to travel there. Instant under reduced motion. */
const FOCUS_MS = 280;
/** How far a pointer may travel between down and up and still be a tap, px. */
const TAP_SLOP = 4;
/** Show the sheet's pictograms once the view is this fraction of the whole town
 *  or tighter. A glyph needs about 19 px where a dot needs 3, so at the fitted
 *  view a town's worth of them overlap into porridge. */
const GLYPH_AT = 0.55;
/** A pictogram's size on screen, px, held constant at every zoom. */
const GLYPH_PX = 19;
/**
 * The plain disc's diameter on screen, px.
 *
 * Small on purpose. It was 26 — inherited from the CSS radius this replaced,
 * and kept only because it was what the page had always drawn — and on a town
 * with 171 of them that is a field of overlapping circles with the streets
 * underneath it. Peter, on the live screen: "I am surprised the POI markers are
 * such large circles when not pictograms." A dot at this zoom is a MARK saying
 * *something is here*; it does not have to be big enough to hit.
 */
const DOT_PX = 12;
/**
 * The invisible circle that actually catches a click, diameter px.
 *
 * Shrinking the visible dot must not shrink the target — clicking a place on
 * the map is the whole of this round's first fault, and a 12 px target would
 * have given it back with a different cause. So the mark you SEE and the target
 * you HIT are separate elements and separate sizes.
 */
const HIT_PX = 24;
/** The ring's diameter once the disc is holding a pictogram, px. */
const RING_PX = 29;
/** At most this many road names at once, however many would fit. */
const ROAD_LABEL_MAX = 14;
/** A road name's size on screen, px. */
const ROAD_LABEL_PX = 11;

/**
 * The reader's words for the twelve categories, exactly as TIER_LABEL is the
 * reader's words for the three tiers (OA-220).
 *
 * The engine's own keys were printed raw as the group headings — a reader saw
 * "gp" and "townhall" — and it took a pictogram appearing beside them to make
 * that obvious. The set is CLOSED: classify() in poi_select.js returns exactly
 * these twelve or null, which is also why the glyph sprite can be complete
 * rather than defensive.
 */
const CAT_LABEL = {
  shop: 'Supermarkets', gp: 'GP surgeries', pharmacy: 'Pharmacies',
  library: 'Libraries', museum: 'Museums', leisure: 'Leisure centres',
  school: 'Schools', park: 'Parks and recreation grounds',
  industrial: 'Industrial estates', community: 'Community centres',
  townhall: 'Town halls', allotments: 'Allotments',
};
const catLabel = (c) => CAT_LABEL[c] || c;

/** Does this browser want to be animated at all? */
const motionOK = () => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

let DETAIL = null;      // /api/maps/:id  (needed for the OTHER overrides we must not lose)
let LANDMARKS = [];     // /api/maps/:id/landmarks
let BASE = null;        // saved tier per key, as loaded
// key -> { tier, as, set }. `set` is the OA-215 addition and it is a different
// question from "is this tier something other than may": it records whether the
// READER has answered this row at all. Without it the page cannot show progress
// through 145 rows and cannot offer "the ones I have not looked at yet".
let STATE = new Map();
let FILTER = 'all';
let SELECTED = null;
let IS_ADMIN = false;
let GLYPHS = null;      // cat -> the sheet's own pictogram, from /api/poi-glyphs
let NAMED = [];         // named ways, longest first, for the road-name layer
let SHOW_NAMES = true;
let ANIM = null;        // the in-flight travel-to-a-place animation, if any
let LAND = null;        // the timer that lands it whatever the frames do
let GLYPH_K = null;     // the pictogram scale the marks currently carry

// ---------------------------------------------------------------------------
// the map
// ---------------------------------------------------------------------------

// Equirectangular, with the usual cos(lat) correction so the town is not
// stretched sideways. This is NOT the sheet's projection and is not trying to
// be — see the note under the map. It only has to put each place where the
// reader would look for it.
let VIEW = null;        // { x, y, w, h } in projected units — the pan/zoom window
let FULL = null;        // the whole-town window, for Fit
let PROJ = null;        // { k, lat0 }

function project(ll) { return [ll[1] * PROJ.k, -ll[0]]; }

function buildMap(ways, points) {
  const stage = $('mapStage');
  if (!ways) {
    stage.innerHTML = '<div class="placeholder">This map has no street data stored, so the list below is on its own. Everything else on this page works.</div>';
    return;
  }
  const lats = [];
  for (const p of points) lats.push(p.ll[0]);
  for (const w of ways) for (const c of w.g) lats.push(c[0]);
  const lat0 = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 52;
  PROJ = { k: Math.cos(lat0 * Math.PI / 180), lat0 };

  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const seen = (xy) => {
    if (xy[0] < x0) x0 = xy[0]; if (xy[0] > x1) x1 = xy[0];
    if (xy[1] < y0) y0 = xy[1]; if (xy[1] > y1) y1 = xy[1];
  };
  for (const w of ways) for (const c of w.g) seen(project(c));
  for (const p of points) seen(project(p.ll));
  const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
  FULL = { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 };
  VIEW = { ...FULL };

  // The road-name layer's candidates (OA-220). The basemap endpoint has always
  // sent `n` — the way's name or its ref — and this file threw it away.
  //
  // LONGEST FIRST IS THE WHOLE RANKING, and it is not a guess dressed up. The
  // obvious rule — label the MAJOR roads — was measured across all five portal
  // maps before this was written, and yields TWO labels on map 3 (A40 and
  // London Road) against 178 names across its ways. Length is what correlates
  // with a road somebody orients by. It has a second property that fell out
  // rather than being designed: the fitted view names the through-roads, and
  // zooming in reveals side streets as the long ones leave the view.
  NAMED = [];
  for (const w of ways) {
    if (!w.n) continue;
    const pts = w.g.map(project);
    const cum = [0];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(len);
    }
    if (!len) continue;
    // Label at the way's half-way point by LENGTH, not at its middle vertex: a
    // way with one long leg and a scatter of short ones has its middle vertex
    // nowhere near the middle of the road.
    let i = 1;
    while (i < cum.length - 1 && cum[i] < len / 2) i++;
    const a = pts[i - 1]; const b = pts[i];
    NAMED.push({
      n: w.n,
      len,
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      ang: Math.atan2(b[1] - a[1], b[0] - a[0]),
    });
  }
  NAMED.sort((p, q) => q.len - p.len);

  // Road geometry never changes, so it is built once as a static string and the
  // pan/zoom only moves the viewBox. On High Wycombe that is a few thousand
  // polylines; rebuilding them per frame would be visibly slow.
  const minor = []; const major = [];
  for (const w of ways) {
    const d = 'M' + w.g.map((c) => { const p = project(c); return p[0].toFixed(5) + ' ' + p[1].toFixed(5); }).join('L');
    (w.m ? major : minor).push(d);
  }
  stage.innerHTML = `<svg id="lmSvg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"
      tabindex="0" role="img" aria-label="Your town's streets with each of these places marked. Drag to move it; click a place to open it in the list; press plus or minus to zoom; press 0 to fit the whole town.">
      <g id="lmRoads">
        <path class="lm-road minor" d="${minor.join('')}"/>
        <path class="lm-road major" d="${major.join('')}"/>
      </g>
      <g id="lmNames"></g>
      <g id="lmPts"></g>
    </svg>`;
  applyView();
  wireMapGestures();
}

function applyView() {
  const svg = $('lmSvg'); if (!svg || !VIEW) return;
  svg.setAttribute('viewBox', `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`);
  // Keep strokes and dots a constant size on screen however far in we are.
  const s = VIEW.w / FULL.w;
  svg.style.setProperty('--lm-s', s);
  // Past the threshold the marks become the sheet's own pictograms. CSS does
  // the swap; this only says which side of the line the view is on.
  // Crossing the threshold changes the disc's size as well as revealing the
  // glyph, so the cached scale has to be dropped or scaleMarks() returns early.
  const on = !!GLYPHS && s <= GLYPH_AT;
  if (on !== svg.classList.contains('glyphs')) { svg.classList.toggle('glyphs', on); GLYPH_K = null; }
  scaleMarks();
  drawRoadNames();
}

/**
 * Hold every pictogram at the same size on screen however far in the map is.
 *
 * The circles manage this from CSS alone — `r: calc(var(--lm-s) * k)` works because
 * r is a real CSS property of an SVG circle. A <use> has no such property, and
 * the CSS `transform` route depends on transform-box / transform-origin
 * behaviour that is not the same everywhere, so the scale is written as an
 * attribute here instead. It returns early when the scale has not moved, which
 * is what makes a PAN free: only a zoom changes it.
 */
/**
 * Size both halves of every mark, in pixels, from one number (OA-220).
 *
 * The disc used to size itself from CSS — `r: calc(var(--lm-s) * 0.0012)` — which
 * holds it steady while you zoom but NOT between one map and the next, because
 * the constant is in map units and a town's bounding box is whatever size it is.
 * That was invisible while the disc was the whole mark and there was nothing to
 * compare it against. Put a fixed 19 px pictogram inside it and it stopped being
 * invisible immediately: on the first map tried, the ring came out four times
 * the width of the glyph it was meant to be hugging.
 *
 * So both are written here, in px, off the same scale. It skips when the scale
 * has not moved, which is what makes a PAN free: only a zoom changes it.
 */
function scaleMarks() {
  const svg = $('lmSvg'); const m = stageMetrics(); if (!svg || !m) return;
  const k = GLYPH_PX / (20 * m.scale);          // the glyph's live area is 20 units
  if (GLYPH_K != null && Math.abs(k - GLYPH_K) < k * 1e-9) return;
  GLYPH_K = k;
  const glyphsOn = svg.classList.contains('glyphs');
  const mark = glyphsOn ? RING_PX : DOT_PX;
  const t = `scale(${k.toPrecision(9)})`;
  const r = (mark / 2 / m.scale).toPrecision(9);
  // Never smaller than the mark: the ring in glyph mode is already bigger than
  // the default target, and a hit area inside the thing it is the target for
  // would be a hole in the middle of the symbol.
  const rh = (Math.max(HIT_PX, mark) / 2 / m.scale).toPrecision(9);
  for (const u of svg.querySelectorAll('.lm-glyph')) u.setAttribute('transform', t);
  for (const c of svg.querySelectorAll('.lm-pt')) c.setAttribute('r', r);
  for (const c of svg.querySelectorAll('.lm-hit')) c.setAttribute('r', rh);
}

/**
 * Choose which road names to draw, in SCREEN space (OA-220).
 *
 * Pure, and lifted out of this file by scripts/test-landmark-tiers.mjs, because
 * a declutter is the one thing on this page that can be wrong in a way no
 * screenshot shows: a label that was dropped looks exactly like a road that has
 * no name. Longest first, drop anything off screen, drop a name already placed
 * elsewhere in this view, drop a box overlapping one already taken, stop at max.
 *
 * It is handed candidates ALREADY IN STAGE PIXELS. Projecting was its job in the
 * first draft and it got the projection wrong — the view box is letterboxed, so
 * the arithmetic it was doing was not the arithmetic the browser does. The
 * browser's own answer is available; the declutter is the part worth testing.
 *
 * The overlap test uses each label's UNROTATED box, which over-reserves for one
 * drawn along a diagonal. That errs towards dropping a label that would have
 * fitted and never towards printing two on top of each other, which is the
 * right way round for something nobody can see fail.
 */
function pickRoadLabels(cands, w, h, max, px) {
  const out = []; const taken = []; const seen = new Set();
  for (const c of cands) {
    if (out.length >= max) break;
    if (seen.has(c.n)) continue;
    if (c.x < 0 || c.y < 0 || c.x > w || c.y > h) continue;
    const bw = c.n.length * px * 0.55; const bh = px * 1.3;
    const box = [c.x - bw / 2, c.y - bh / 2, c.x + bw / 2, c.y + bh / 2];
    if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
    taken.push(box); seen.add(c.n); out.push(c);
  }
  return out;
}

function drawRoadNames() {
  const g = $('lmNames'); if (!g) return;
  if (!SHOW_NAMES) { g.innerHTML = ''; return; }
  const m = stageMetrics(); if (!m) return;
  const cands = NAMED.map((r) => {
    const [x, y] = toStage(m, r.at[0], r.at[1]);
    return { n: r.n, ang: r.ang, at: r.at, x, y };
  });
  const u = 1 / m.scale;                            // user units per screen pixel
  const parts = [];
  for (const p of pickRoadLabels(cands, m.r.width, m.r.height, ROAD_LABEL_MAX, ROAD_LABEL_PX)) {
    // Never upside down: past a quarter turn it is the same line read the other
    // way round, and a road name is not a compass bearing.
    let a = p.ang * 180 / Math.PI;
    if (a > 90) a -= 180; else if (a < -90) a += 180;
    const x = p.at[0].toFixed(5); const y = p.at[1].toFixed(5);
    parts.push(`<text class="lm-roadname" x="${x}" y="${y}" font-size="${(ROAD_LABEL_PX * u).toPrecision(6)}"`
      + ` transform="rotate(${a.toFixed(2)} ${x} ${y})">${esc(p.n)}</text>`);
  }
  g.innerHTML = parts.join('');
}

/**
 * Ease the view from where it is to `to`.
 *
 * ARRIVAL IS GUARANTEED BY A TIMER AND NOT BY THE FRAMES, and that is the whole
 * design. `requestAnimationFrame` does not run when a page is not being
 * painted, so an animation started then never completes and leaves the view
 * wherever it happened to be — the map does not move and nothing says why.
 *
 * The first attempt at this guarded on `document.hidden`, which is a PROXY for
 * "will frames arrive" and is wrong in the direction that costs you: MEASURED
 * in a pane reporting `document.hidden === false` and `visibilityState ===
 * "visible"` where no frame arrived in 900 ms, so the guard passed and the
 * animation silently never ran. A proxy fails both ways and the silent way is
 * the expensive one. So this asks nothing about visibility: it schedules the
 * landing on a plain timer, and the frames — if they come — are only the nice
 * way of getting there. Anything that stops the animation stops the timer too,
 * so a hand on the map is never overruled a moment later.
 */
function animateView(to) {
  stopAnim();
  if (!motionOK()) { VIEW = to; applyView(); return; }
  const from = { ...VIEW }; const t0 = performance.now();
  const land = () => { stopAnim(); VIEW = to; applyView(); };
  LAND = setTimeout(land, FOCUS_MS + 120);
  const step = (t) => {
    const u = Math.min(1, (t - t0) / FOCUS_MS);
    if (u >= 1) { land(); return; }
    const e = u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
    VIEW = {
      x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e,
      w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e,
    };
    applyView();
    ANIM = requestAnimationFrame(step);
  };
  ANIM = requestAnimationFrame(step);
}

function stopAnim() {
  if (ANIM) { cancelAnimationFrame(ANIM); ANIM = null; }
  if (LAND) { clearTimeout(LAND); LAND = null; }
}

/**
 * Bring the map to a place chosen in the list (OA-220).
 *
 * The reverse direction already worked — a chosen row highlighted its dot — but
 * the reader reported it took a while to see, and not at all once the map had
 * been panned so the place was off screen. A highlight nobody can find is the
 * same as no highlight.
 *
 * It zooms IN to a street-level view, and only if the map is currently further
 * out than that. Somebody who has zoomed closer than FOCUS_ZOOM chose to be
 * there, and pulling them back to a standard distance would be the same fault
 * pointing the other way.
 */
function centreOn(ll) {
  if (!VIEW || !FULL || !PROJ) return;
  const [x, y] = project(ll);
  let { w, h } = VIEW;
  if (FULL.w / FOCUS_ZOOM < w) { w = FULL.w / FOCUS_ZOOM; h = FULL.h / FOCUS_ZOOM; }
  animateView({ x: x - w / 2, y: y - h / 2, w, h });
}

/**
 * The marks on the map: one group per place, holding the tier's disc and — past
 * the zoom threshold — the sheet's own pictogram on top of it (OA-220).
 *
 * The disc does not go away when the glyph arrives; CSS turns it into the RING
 * around the glyph. That is what keeps the ANSWER readable once the mark has
 * stopped being a colour and become a picture.
 */
function drawPoints() {
  const g = $('lmPts'); if (!g || !PROJ) return;
  const parts = [];
  for (const p of LANDMARKS) {
    const st = STATE.get(p.key) || { tier: 'may' };
    const [x, y] = project(p.ll);
    const cls = 'lm-mark ' + st.tier + (SELECTED === p.key ? ' sel' : '');
    parts.push(`<g class="${cls}" data-key="${esc(p.key)}" transform="translate(${x.toFixed(5)} ${y.toFixed(5)})">`
      + '<circle class="lm-hit" cx="0" cy="0"/>'
      + '<circle class="lm-pt" cx="0" cy="0"/>'
      + (GLYPHS && GLYPHS[p.cat] ? `<use class="lm-glyph" href="#lmg-${esc(p.cat)}" x="-10" y="-10" width="20" height="20"/>` : '')
      + `<title>${esc(st.as || p.name)} — ${esc(catLabel(p.cat))} — ${esc(TIER_LABEL[st.tier])}</title></g>`);
  }
  g.innerHTML = parts.join('');
  // These are new elements, so whatever scale the old ones carried is gone.
  GLYPH_K = null;
  scaleMarks();
}

/**
 * WHERE THE DRAWING ACTUALLY SITS ON THE STAGE, in pixels (OA-220).
 *
 * The SVG is `xMidYMid meet`: the view box is scaled by the SMALLER of the two
 * ratios and centred, with letterboxing on the other axis. A town's bounding
 * box is roughly square and this stage is wide and short, so on High Wycombe
 * the letterbox is most of the width — MEASURED on the live page, not reasoned
 * about: a 0.0303 x 0.0349 view box on a 422 x 163 stage scales by 4,672 px per
 * user unit, where `VIEW.w / stage.width` claims 13,922.
 *
 * That wrong ratio was driving the pan and the zoom anchor from this page's
 * first day, which is why a drag moved the map about three times too fast
 * sideways and a wheel zoom drifted off the thing under the pointer. Nobody had
 * reported it, and it only surfaced because the road labels are the first thing
 * here that has to land on an exact pixel. Everything that crosses between the
 * two spaces now comes through this one function.
 */
function stageMetrics() {
  const svg = $('lmSvg'); if (!svg || !VIEW) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const scale = Math.min(r.width / VIEW.w, r.height / VIEW.h);   // px per user unit
  return {
    r,
    scale,
    ox: r.width / 2 - (VIEW.x + VIEW.w / 2) * scale,
    oy: r.height / 2 - (VIEW.y + VIEW.h / 2) * scale,
  };
}

/** A user-space point as pixels within the stage. */
const toStage = (m, x, y) => [x * m.scale + m.ox, y * m.scale + m.oy];

/** A pointer event as a user-space point. */
function pointerUser(m, e) {
  return [(e.clientX - m.r.left - m.ox) / m.scale, (e.clientY - m.r.top - m.oy) / m.scale];
}

/**
 * Zoom by `f`, holding the user-space point (ax, ay) still (OA-215, OA-220).
 *
 * FOUR THINGS DRIVE THIS AND UNTIL OA-215 ONLY ONE DID. The wheel was the whole
 * zoom, and the reader this screen is written for works on a trackpad, where a
 * wheel gesture is not something anyone finds by accident: he reported that the
 * map panned and could not be zoomed. So the wheel, the + / - buttons, a
 * double-click and the keyboard all come through here.
 *
 * Clamped at BOTH ends. Out to the whole town, which the wheel already did, and
 * in to MAX_ZOOM, which it did not — an unbounded zoom leaves somebody looking
 * at blank paper with no way back but Fit.
 *
 * The anchor is a USER-SPACE point rather than a fraction of the stage (OA-220).
 * A fraction of the stage is not a fraction of the view box while the drawing is
 * letterboxed, so the point under the pointer drifted as you zoomed. Omit it and
 * the view centre holds still, which is what the buttons and the keys want.
 */
function zoomAt(f, ax, ay) {
  if (!VIEW || !FULL) return;
  const nw = Math.max(FULL.w / MAX_ZOOM, Math.min(FULL.w, VIEW.w * f));
  const nh = Math.max(FULL.h / MAX_ZOOM, Math.min(FULL.h, VIEW.h * f));
  const cx = ax == null ? VIEW.x + VIEW.w / 2 : ax;
  const cy = ay == null ? VIEW.y + VIEW.h / 2 : ay;
  // Hold the anchor at the same fraction of the view it occupies now.
  const fx = (cx - VIEW.x) / VIEW.w;
  const fy = (cy - VIEW.y) / VIEW.h;
  VIEW = { x: cx - nw * fx, y: cy - nh * fy, w: nw, h: nh };
  applyView();
}

function wireMapGestures() {
  const svg = $('lmSvg');
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = stageMetrics(); if (!m) return;
    const [ax, ay] = pointerUser(m, e);
    zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, ax, ay);
  }, { passive: false });

  // A double-click zooms IN about the point clicked; with Shift or Alt, out.
  svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const m = stageMetrics(); if (!m) return;
    const [ax, ay] = pointerUser(m, e);
    zoomAt(e.shiftKey || e.altKey ? ZOOM_STEP : 1 / ZOOM_STEP, ax, ay);
  });

  // The keyboard, which is also the only one of the four available to somebody
  // who cannot use a pointer at all. The stage carries tabindex="0" for it.
  svg.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(1 / ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') zoomAt(ZOOM_STEP);
    else if (e.key === '0') { VIEW = { ...FULL }; applyView(); }
    else return;
    e.preventDefault();
  });

  // PANNING, AND THE TAP THAT LIVES INSIDE IT (OA-220).
  //
  // The mark under the pointer is read HERE, at pointerdown, and that is the
  // whole of this page's oldest fault. The line below takes pointer capture so
  // a drag that leaves the stage keeps panning — and pointer capture retargets
  // the CLICK event that follows to the <svg> itself. The handler that used to
  // sit at the bottom of this function asked the click event which mark it hit
  // and was told "none", every time, for as long as this page has existed.
  // Measured in a browser with two identical SVGs, one taking capture and one
  // not, rather than reasoned about.
  //
  // Reading it at pointerdown also buys the thing the click handler never had:
  // a drag that happens to finish over a mark no longer selects it.
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    stopAnim();                       // a hand on the map outranks an animation
    const m = stageMetrics(); if (!m) return;
    const hit = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
    drag = {
      x: e.clientX, y: e.clientY, vx: VIEW.x, vy: VIEW.y, scale: m.scale,
      key: hit ? hit.getAttribute('data-key') : null, moved: false,
    };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!isTap(drag.x, drag.y, e.clientX, e.clientY, TAP_SLOP)) drag.moved = true;
    // The scale cannot change during a pan, so it is taken once at pointerdown.
    VIEW.x = drag.vx - (e.clientX - drag.x) / drag.scale;
    VIEW.y = drag.vy - (e.clientY - drag.y) / drag.scale;
    applyView();
  });
  svg.addEventListener('pointerup', (e) => {
    if (drag && drag.key && !drag.moved && isTap(drag.x, drag.y, e.clientX, e.clientY, TAP_SLOP)) {
      // Tapping the open one closes it, the same as clicking its row does.
      selectKey(drag.key === SELECTED ? null : drag.key, { scrollList: true });
    }
    drag = null;
  });
  svg.addEventListener('pointercancel', () => { drag = null; });
}

/** Did the pointer stay still enough between down and up to mean a tap? */
function isTap(x0, y0, x1, y1, slop) {
  return Math.abs(x1 - x0) <= slop && Math.abs(y1 - y0) <= slop;
}

$('zoomFit').addEventListener('click', () => { if (FULL) { VIEW = { ...FULL }; applyView(); } });
$('zoomIn').addEventListener('click', () => zoomAt(1 / ZOOM_STEP));
$('zoomOut').addEventListener('click', () => zoomAt(ZOOM_STEP));
// On by default. A reader who finds the names in the way needs a switch, not a
// bug report — and a switch is what makes it safe to have them on by default.
$('namesBtn').addEventListener('click', () => {
  SHOW_NAMES = !SHOW_NAMES;
  $('namesBtn').setAttribute('aria-pressed', String(SHOW_NAMES));
  drawRoadNames();
});
// The pictogram scale and the label declutter are both computed against the
// stage's PIXEL width, so a resized window has to redo both.
window.addEventListener('resize', () => { GLYPH_K = null; applyView(); });

// ---------------------------------------------------------------------------
// the list
// ---------------------------------------------------------------------------

/**
 * A category's pictogram for the list (OA-220).
 *
 * ALWAYS emitted, even when the glyph set could not be fetched, so the row's
 * grid keeps the three columns its stylesheet declares. The symbol is decorative
 * beside a name the reader can already read, hence aria-hidden.
 */
function glyphSpan(cat) {
  return GLYPHS && GLYPHS[cat]
    ? `<span class="lm-icon" aria-hidden="true"><svg viewBox="-10 -10 20 20"><use href="#lmg-${esc(cat)}"/></svg></span>`
    : '<span class="lm-icon" aria-hidden="true"></span>';
}

/** Put the glyph set into the page once, as <symbol>s the list and the map both
 *  <use>. The fragments come from our own engine/icons.js through our own
 *  endpoint — they are artwork we wrote, not anything a customer can supply. */
function installGlyphSprite(glyphs) {
  const host = $('glyphSprite'); if (!host) return;
  host.innerHTML = !glyphs ? '' : Object.keys(glyphs)
    .map((cat) => `<symbol id="lmg-${esc(cat)}" viewBox="-10 -10 20 20">${glyphs[cat]}</symbol>`).join('');
}

function statusWords(p) {
  const bits = [];
  if (!p.printsName) bits.push('symbol only — its name is never printed');
  return bits.join(' · ');
}

function matches(p) {
  const st = STATE.get(p.key);
  const q = ($('search').value || '').trim().toLowerCase();
  // The rename is searched as well as the original: once somebody has called a
  // place what the town calls it, that is the word they will type to find it.
  // The category is searched under BOTH names — the engine's key and the words
  // on screen — so typing "surgery" finds the GPs the heading now calls that.
  if (q && !(p.name + ' ' + p.cat + ' ' + catLabel(p.cat) + ' ' + ((st && st.as) || '')).toLowerCase().includes(q)) return false;
  if (FILTER === 'symbol') return !p.printsName;
  // Was "Losing its name now", which named nothing of the kind: it consulted no
  // render of anything, and matched every POI whose name the map is ALLOWED to
  // print — the exact complement of the chip beside it. Renamed to what it does.
  if (FILTER === 'named') return p.printsName;
  // Answered means the reader has said something about this row, INCLUDING
  // leaving it as it is. That is the whole of the middle-answer fix (OA-215).
  if (FILTER === 'answered') return !!(st && st.set);
  if (FILTER === 'todo') return !(st && st.set);
  return true;
}

/**
 * Where the list is looking, so that a rebuild can put it back (OA-215).
 *
 * Every filter click, every search keystroke and every finished rename rewrites
 * the list's innerHTML, and until today each one threw the reader back to the
 * top of 145 rows. The anchor is the topmost row still visible plus its offset
 * inside the box, so the row under your eye stays under your eye. When the new
 * filter has dropped that row there is nothing to restore to, and doing nothing
 * is the honest answer rather than a failure.
 */
function listAnchor() {
  const box = $('list');
  const top = box.getBoundingClientRect().top;
  for (const r of box.querySelectorAll('.lm-row')) {
    const b = r.getBoundingClientRect();
    if (b.bottom > top + 1) return { key: r.dataset.key, dy: b.top - top };
  }
  return null;
}

function restoreAnchor(a) {
  if (!a) return;
  const box = $('list');
  const r = box.querySelector(`.lm-row[data-key="${CSS.escape(a.key)}"]`);
  if (!r) return;
  box.scrollTop += (r.getBoundingClientRect().top - box.getBoundingClientRect().top) - a.dy;
}

function buildList() {
  const box = $('list');
  const anchor = listAnchor();
  const byCat = new Map();
  let shown = 0;
  for (const p of LANDMARKS) {
    if (!matches(p)) continue;
    shown++;
    if (!byCat.has(p.cat)) byCat.set(p.cat, []);
    byCat.get(p.cat).push(p);
  }
  // A-Z at both levels, and SAID under the search box. It was biggest group
  // first with the rows inside in whatever order OpenStreetMap happened to
  // return them: an order nothing stated, nobody could predict, and that
  // differed from town to town. Sorting on the ORIGINAL name rather than on a
  // rename is deliberate — a row must not jump out from under the cursor at the
  // moment somebody finishes renaming it.
  // Sorted on the words the reader SEES, now that the headings carry them.
  const cats = [...byCat.keys()].sort((a, b) => catLabel(a).localeCompare(catLabel(b)));
  for (const c of cats) byCat.get(c).sort((x, y) => x.name.localeCompare(y.name));
  $('showing').textContent = shown === LANDMARKS.length
    ? `All ${LANDMARKS.length} places, in alphabetical order within each group.`
    : `Showing ${shown} of ${LANDMARKS.length} places, in alphabetical order within each group.`;
  if (!cats.length) { box.innerHTML = '<div class="empty">Nothing matches that.</div>'; return; }

  let html = '';
  for (const cat of cats) {
    const rows = byCat.get(cat);
    const named = rows.some((p) => p.printsName);
    html += `<div class="lm-cat">
      <div class="lm-cathead">
        ${glyphSpan(cat)}<b>${esc(catLabel(cat))}</b> <span class="count">${rows.length}</span>
        ${named ? '' : '<span class="lm-tagline">the map never prints these names</span>'}
        <span class="spacer"></span>
        <span class="lm-bulk">All ${rows.length}:
          ${TIERS.map((t) => `<button class="lm-chip sm" data-bulk="${t}" data-cat="${esc(cat)}" type="button"
              title="Answer all ${rows.length} showing here: ${esc(TIER_LABEL[t])}">${esc(TIER_LABEL[t])}</button>`).join('')}
        </span>
      </div>`;
    for (const p of rows) {
      const st = STATE.get(p.key) || { tier: 'may', as: null, set: false };
      const sw = statusWords(p);
      html += `<div class="lm-row ${st.tier} ${st.set ? 'set' : ''} ${st.as ? 'renamed' : ''} ${SELECTED === p.key ? 'sel' : ''}" data-key="${esc(p.key)}">
        ${glyphSpan(p.cat)}
        <div class="lm-name">
          <span class="lm-title">${esc(st.as || p.name)}</span>
          ${st.as ? `<span class="lm-was">was ${esc(p.name)}</span>` : ''}
          ${sw ? `<span class="lm-sub">${esc(sw)}</span>` : ''}
        </div>
        <div class="lm-choices" role="radiogroup" aria-label="${esc(p.name)}">
          ${TIERS.map((t) => `<label class="lm-opt ${t} ${st.tier === t ? 'on' : ''}">
              <input type="radio" name="t_${esc(p.key)}" value="${t}" ${st.tier === t ? 'checked' : ''}>
              <span>${esc(TIER_LABEL[t])}</span></label>`).join('')}
        </div>
        <input class="field lm-rename" type="text" maxlength="60" value="${esc(st.as || '')}"
               placeholder="${p.printsName ? 'Called something else locally?' : 'Rename (not printed on the map)'}"
               aria-label="A better name for ${esc(p.name)}">
        <div class="lm-hint">If this is not what people round here call it, put the right name in. A shorter one is worth more to the map than a longer one.</div>
      </div>`;
    }
    html += '</div>';
  }
  box.innerHTML = html;
  $('poiCount').textContent = `${LANDMARKS.length} in all`;
  restoreAnchor(anchor);
}

/**
 * Open one row — or pass null to close the one that is open (OA-215).
 *
 * `scrollList` brings the row to the reader (a tap on the map); `centreMap`
 * brings the map to the row (a click in the list). They are deliberately not
 * the same call: doing both would drag the map out from under the finger that
 * just tapped it.
 */
function selectKey(key, opts) {
  const o = opts || {};
  SELECTED = key;
  drawPoints();
  document.querySelectorAll('.lm-row').forEach((r) => r.classList.toggle('sel', key != null && r.dataset.key === key));
  if (key == null) return;

  if (o.scrollList) {
    const find = () => document.querySelector(`.lm-row[data-key="${CSS.escape(key)}"]`);
    let row = find();
    // They tapped a place the current filter is hiding. Showing them nothing and
    // calling it a selection is the same class of fault as the dead handler this
    // replaced, so the filter gives way — visibly, because the chip moves.
    if (!row && FILTER !== 'all') { setFilter('all'); row = find(); }
    if (row) scrollListTo(row);
  }
  if (o.centreMap) {
    const p = LANDMARKS.find((l) => l.key === key);
    if (p) centreOn(p.ll);
  }
}

/**
 * Bring one row to the middle of the LIST, and move nothing else (OA-220).
 *
 * `scrollIntoView` was doing this and it scrolls every scrollable ancestor,
 * the document included — so a tap on the map could carry the page away from
 * the map that was tapped. On a 20-row list it never did; on the reader's
 * 171-row one there is nothing to stop it. This touches one element's
 * scrollTop, and it is the same arithmetic restoreAnchor() already uses.
 */
function scrollListTo(row) {
  const box = $('list');
  const b = row.getBoundingClientRect(); const c = box.getBoundingClientRect();
  const top = box.scrollTop + (b.top - c.top) - (c.height - b.height) / 2;
  const to = Math.max(0, Math.min(top, box.scrollHeight - c.height));
  if (box.scrollTo) box.scrollTo({ top: to, behavior: motionOK() ? 'smooth' : 'auto' });
  else box.scrollTop = to;
}

/** Move to a filter and rebuild, chips included, from wherever it is asked for. */
function setFilter(f) {
  FILTER = f;
  document.querySelectorAll('#filters .lm-chip').forEach((b) => b.classList.toggle('active', b.dataset.filter === f));
  buildList();
}

/** Repaint one row's classes after its answer changed, without a full rebuild. */
function paintRow(row, tier) {
  const st = STATE.get(row.dataset.key) || {};
  row.className = 'lm-row ' + tier + (st.set ? ' set' : '') + (st.as ? ' renamed' : '')
    + (SELECTED === row.dataset.key ? ' sel' : '');
  row.querySelectorAll('.lm-opt').forEach((o) => o.classList.toggle('on', o.querySelector('input').checked));
}

// One delegated listener for the whole list — the rows are rebuilt on every
// filter change, so per-row listeners would have to be rewired each time.
$('list').addEventListener('change', (e) => {
  const row = e.target.closest('.lm-row');
  // Still needed alongside the click handler below: arrow keys move within a
  // radiogroup and fire change without ever producing a click.
  if (row && e.target.type === 'radio') {
    setTier(row.dataset.key, e.target.value);
    paintRow(row, e.target.value);
    return;
  }
  if (row && e.target.classList.contains('lm-rename')) {
    setName(row.dataset.key, e.target.value);
    buildList();
  }
});

$('list').addEventListener('click', (e) => {
  const bulk = e.target.closest('[data-bulk]');
  if (bulk) {
    const cat = bulk.dataset.cat; const tier = bulk.dataset.bulk;
    // Only the rows the reader can currently SEE. Answering "all industrial" while
    // a search box is narrowing the list to three of them should change three.
    for (const p of LANDMARKS) if (p.cat === cat && matches(p)) setTier(p.key, tier);
    buildList();
    return;
  }
  const row = e.target.closest('.lm-row');

  // AN ANSWER IS RECORDED WHETHER OR NOT IT MOVED (OA-220). A radio that is
  // already checked fires no `change`, so until this handler existed the only
  // way to record the DEFAULT answer was to click a different one and click
  // back — and the default answer is precisely the one OA-215 went to some
  // trouble to make recordable. setTier is idempotent, which is what lets this
  // sit alongside the change handler above without either needing to know about
  // the other: a label click delivers both, and both say the same thing.
  const opt = row && e.target.closest('.lm-opt');
  if (opt) {
    const input = opt.querySelector('input');
    if (input) {
      input.checked = true;
      setTier(row.dataset.key, input.value);
      paintRow(row, input.value);
    }
    return;
  }

  // Clicking the OPEN row again closes it. It used to re-select it, so the only
  // way out of an expanded row was to open a different one (OA-215). Opening one
  // now also brings the map to it (OA-220).
  if (row && !e.target.closest('.lm-choices') && !e.target.closest('.lm-rename')) {
    const open = row.dataset.key === SELECTED;
    selectKey(open ? null : row.dataset.key, { centreMap: true });
  }
});

// Esc closes the open row as well — but not while the sheet dialog is up, which
// owns Esc for itself and would otherwise close both at one press.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('sheetDialog').open || !SELECTED) return;
  selectKey(null);
  e.preventDefault();
});

$('search').addEventListener('input', buildList);
$('filters').addEventListener('click', (e) => {
  const c = e.target.closest('[data-filter]'); if (!c) return;
  setFilter(c.dataset.filter);
});

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

// Touching either control ANSWERS the row, and that is the middle-answer fix in
// two lines: choosing "Show if there is room" is a decision somebody made, and
// until OA-215 it left no trace at all.
function setTier(key, tier) {
  const st = STATE.get(key) || { tier: 'may', as: null };
  STATE.set(key, { tier, as: st.as || null, set: true });
  onEdit();
}

function setName(key, raw) {
  const st = STATE.get(key) || { tier: 'may', as: null };
  const t = (raw || '').trim();
  STATE.set(key, { tier: st.tier, as: t || null, set: !!st.set || !!t });
  onEdit();
}

/**
 * What we would send: every row the reader has ANSWERED, and nothing else.
 *
 * It used to be "every row whose tier is not may", which is a different set and
 * the wrong one — an explicit *Show if there is room* was dropped on the way to
 * disk, so nothing could tell it from a row nobody had reached. A map nobody has
 * touched still serialises to {}, which is the property the byte gate cares
 * about; a map somebody has worked through now carries their answer, which is
 * what lets them stop half way and come back to it.
 */
function tiersPayload() {
  const out = {};
  for (const [k, st] of STATE) {
    if (!st.set && !st.as) continue;
    out[k] = st.as ? { tier: st.tier, as: st.as } : { tier: st.tier };
  }
  return out;
}

function dirty() {
  return JSON.stringify(tiersPayload()) !== JSON.stringify(BASE);
}

/**
 * The two lines under the map, and the WORDS are the point (OA-220).
 *
 * The third figure used to read "left as they are". It is `total − must − miss`
 * — every row the map will show if there is room — which is an answered `may`
 * and a row nobody has reached, added together under a name that describes the
 * history of neither. Worse, it is a claim about the PAST, and this page has no
 * way to check one: a place that arrived as *Do not show* and that the reader
 * moved to `may` has not been left as anything. The legend's own words are true
 * whatever happened before it, and the second line already answers "how far have
 * I got" correctly on its own. One line says what the map will do; the other
 * says how far through it the reader is. They were tangled into one.
 */
function tallyText(total, musts, misses, answered) {
  return `<span class="lm-key must">${TIER_LABEL.must}</span> ${musts}
     · <span class="lm-key may">${TIER_LABEL.may}</span> ${total - musts - misses}
     · <span class="lm-key miss">${TIER_LABEL.miss}</span> ${misses}
     <br><b>${answered}</b> of ${total} answered · ${total - answered} not looked at yet`;
}

function onEdit() {
  drawPoints();
  const d = dirty();
  $('saveBtn').disabled = !d;
  $('stateDot').className = 'dot ' + (d ? 'dirty' : 'clean');
  $('stateText').textContent = d ? 'Not saved yet' : 'No changes';

  const musts = [...STATE.values()].filter((s) => s.tier === 'must').length;
  const misses = [...STATE.values()].filter((s) => s.tier === 'miss').length;
  const answered = [...STATE.values()].filter((s) => s.set || s.as).length;
  $('tally').innerHTML = tallyText(LANDMARKS.length, musts, misses, answered);

  // A "Must show" is free to click and expensive on the paper. The covering note
  // could only ASK people to be sparing; a counter can show them.
  const warn = $('mustWarn');
  if (musts > MUST_SOFT_CAP) {
    warn.hidden = false;
    warn.textContent = `${musts} places are marked “Must show”. Each one is printed whatever it costs, so they take room from each other — past a dozen or so the map starts dropping other things to fit them. That is allowed, and it is worth a second look.`;
  } else warn.hidden = true;
}

// ---------------------------------------------------------------------------
// save, preview, export
// ---------------------------------------------------------------------------

/**
 * Save through the ordinary editor endpoint, carrying the map's OTHER overrides
 * with us. Route colours and operator choices live in the same object, and
 * sanitizeOverrides() rebuilds that object from scratch — so posting only our
 * own key would silently discard the customer's colours.
 *
 * We deliberately do NOT send `internal.pois`. That is where the editor's older
 * render-time hides live, and leaving them out is what converts them into the
 * tiers this page has been showing them as.
 */
function payload() {
  const ov = JSON.parse(JSON.stringify(DETAIL.overrides || {}));
  delete ov.internal;
  const tiers = tiersPayload();
  if (Object.keys(tiers).length) ov.internal = { poiTiers: tiers };
  return ov;
}

$('saveBtn').addEventListener('click', async () => {
  $('saveBtn').disabled = true;
  note('Saving and re-rendering…');
  try {
    const r = await fetch(`/api/maps/${MAP_ID}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: payload(), note: 'Landmark choices' }),
    });
    const b = await r.json();
    if (!r.ok || !b.ok) throw new Error(b.error || 'Save failed');
    await load();
    // load() repaints the page, so the notice is set AFTER it — and the saved
    // message no longer claims more than the drawing delivered.
    if (b.warnings && b.warnings.length) {
      showWarnings(b.warnings, `Saved as version ${b.version || ''}, and the map was redrawn — but not every choice could be applied:`);
    } else {
      note(`Saved as version ${b.version || ''}. The map has been redrawn with your choices.`, 'ok');
    }
  } catch (e) {
    note(e.message, 'warn');
    $('saveBtn').disabled = false;
  }
});

$('sheetBtn').addEventListener('click', async () => {
  const dlg = $('sheetDialog'); const stage = $('sheetStage');
  stage.textContent = 'Rendering the sheet with your choices…';
  dlg.showModal();
  try {
    const r = await fetch(`/api/maps/${MAP_ID}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: payload() }),
    });
    const b = await r.json();
    if (!r.ok || !b.ok) throw new Error(b.error || 'Preview failed');
    const svg = b.svg && (b.svg.internal || Object.values(b.svg)[0]);
    stage.innerHTML = svg || '<p>Nothing to show.</p>';
    if (b.rejected && b.rejected.length) note('Some entries were not accepted: ' + b.rejected.join('; '), 'warn');
    // The cheapest place to learn a *Must show* cannot be seated: nothing has
    // been saved, so the answer is still editable when the reader gets it.
    else if (b.warnings && b.warnings.length) showWarnings(b.warnings, 'This is what the sheet looks like — but not every choice could be applied:');
  } catch (e) {
    stage.textContent = e.message;
  }
});
$('sheetClose').addEventListener('click', () => $('sheetDialog').close());

// The other half of Peter's decision of 2026-09-01: the answer lives here AND
// is exportable, so a rebuild from the map's source data does not lose it.
$('exportBtn').addEventListener('click', async () => {
  const block = JSON.stringify({ tiers: tiersPayload() }, null, 2);
  try {
    await navigator.clipboard.writeText(block);
    note('Copied. It goes in the map’s routes.json, inside its "poi" block.', 'ok');
  } catch {
    note('Copy this into the map’s routes.json, inside its "poi" block:\n' + block);
  }
});

$('resetBtn').addEventListener('click', () => {
  STATE = new Map();
  for (const p of LANDMARKS) STATE.set(p.key, { tier: p.tier, as: p.as || null, set: !!p.answered });
  buildList(); onEdit();
});

function note(msg, kind) {
  const n = $('notice');
  n.textContent = msg || '';
  n.className = 'notice' + (kind ? ' ' + kind : '');
  n.style.display = msg ? '' : 'none';
}

/* WHAT THE DRAWING ACTUALLY DID WITH THE ANSWER (OA-216).
 *
 * `mustPlace` is not a veto. The generator relaxes the hard grid for a place
 * marked *Must show* and then does its best; when it cannot seat one it names it
 * on stderr and carries on, because the sheet is still worth having. Until
 * 2026-09-01 this page said "Saved as version 2.3. The map has been redrawn with
 * your choices" whether that was true of twenty places or of seventeen — and the
 * soft cap at twelve further up this file was a GUESS offered in place of the
 * real answer, which the generator had computed and the portal had discarded.
 *
 * Built from DOM nodes and textContent rather than innerHTML: every one of these
 * strings carries a landmark name out of the map's own data, and the notice
 * element is otherwise plain text. */
function showWarnings(list, headline) {
  const n = $('notice');
  n.textContent = '';
  n.className = 'notice warn';
  n.style.display = '';
  const h = document.createElement('p');
  h.style.margin = '0 0 .4em';
  h.textContent = headline;
  n.appendChild(h);
  const ul = document.createElement('ul');
  ul.style.margin = '0';
  ul.style.paddingLeft = '1.2em';
  for (const w of list) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = w.heading;
    li.appendChild(b);
    // The generator's own sentence, kept verbatim: it names the actual places
    // and the actual remedies, and a paraphrase would lose both.
    li.appendChild(document.createTextNode(' — ' + w.detail));
    ul.appendChild(li);
  }
  n.appendChild(ul);
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

async function load() {
  // The glyph set is fetched with the rest and not after it: the list is built
  // below and a row without its pictogram would have to be rebuilt to get one.
  // It is allowed to fail — the page falls back to plain dots and plain rows.
  const [d, l, g] = await Promise.all([
    fetch(`/api/maps/${MAP_ID}`).then((r) => r.json()),
    fetch(`/api/maps/${MAP_ID}/landmarks`).then((r) => r.json()),
    fetch('/api/poi-glyphs').then((r) => r.json()).catch(() => null),
  ]);
  GLYPHS = g && g.ok ? g.glyphs : null;
  installGlyphSprite(GLYPHS);
  if (!d.ok || !l.ok) throw new Error((d && d.error) || (l && l.error) || 'Could not load this map.');
  DETAIL = d.map;
  LANDMARKS = l.landmarks;
  document.title = `Landmarks — ${DETAIL.name} — BusMaps.uk`;
  $('mapName').textContent = DETAIL.name;
  $('backToEditor').href = `/app/maps/${MAP_ID}`;

  STATE = new Map();
  for (const p of LANDMARKS) STATE.set(p.key, { tier: p.tier, as: p.as || null, set: !!p.answered });
  BASE = tiersPayload();

  // Say out loud that an old-style hide is being read as "Do not show", and what
  // saving will do about it — the sheet really does reflow, because the space is
  // finally given back rather than merely left blank.
  const hn = $('hideNotice');
  if (l.counts.fromHide) {
    hn.hidden = false;
    hn.textContent = `${l.counts.fromHide} place${l.counts.fromHide === 1 ? ' was' : 's were'} already switched off with the older tick box, which only stopped ${l.counts.fromHide === 1 ? 'it' : 'them'} being drawn — the space stayed reserved. ${l.counts.fromHide === 1 ? 'It is' : 'They are'} shown here as “Do not show”, and saving will give that space back, so the map will re-arrange a little.`;
  } else hn.hidden = true;

  $('introLine').textContent = `${LANDMARKS.length} places are on your map because OpenStreetMap has them, not because anyone decided they belonged there. `
    + `${l.counts.symbolOnly} of them draw a symbol whose name is never printed, and they take up exactly as much room as the ones with names. `
    + 'You know the town; the map does not.';

  buildList();
  onEdit();

  const bm = await fetch(`/api/maps/${MAP_ID}/basemap`).then((r) => r.json()).catch(() => null);
  buildMap(bm && bm.ok ? bm.ways : null, LANDMARKS);
  drawPoints();
}

(async () => {
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) { location.href = '/app/login.html'; return; }
    const me = (await r.json()).user;
    IS_ADMIN = !me.customer;
    $('whoami').textContent = me.customer ? `${me.email} · ${me.customer.name}` : `${me.email} · admin`;
    // The export block is OURS, not theirs. It copies a poi.tiers block for the
    // map's source data in another repository, which is a BusMaps.uk chore and
    // not something a local editor should have to reason about beside a button
    // that says Save. Admins keep it for testing (Peter, 2026-09-01, OA-215).
    if (!IS_ADMIN) $('exportBtn').style.display = 'none';
    $('logoutBtn').style.display = '';
  } catch { note('Could not reach the server.', 'warn'); return; }

  try { await load(); } catch (e) { note(e.message, 'warn'); }
})();

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/app/login.html';
});
