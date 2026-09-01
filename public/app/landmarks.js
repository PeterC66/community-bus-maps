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

  // Road geometry never changes, so it is built once as a static string and the
  // pan/zoom only moves the viewBox. On High Wycombe that is a few thousand
  // polylines; rebuilding them per frame would be visibly slow.
  const minor = []; const major = [];
  for (const w of ways) {
    const d = 'M' + w.g.map((c) => { const p = project(c); return p[0].toFixed(5) + ' ' + p[1].toFixed(5); }).join('L');
    (w.m ? major : minor).push(d);
  }
  stage.innerHTML = `<svg id="lmSvg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"
      tabindex="0" role="img" aria-label="Your town's streets with each of these places marked. Drag to move it; press plus or minus to zoom; press 0 to fit the whole town.">
      <g id="lmRoads">
        <path class="lm-road minor" d="${minor.join('')}"/>
        <path class="lm-road major" d="${major.join('')}"/>
      </g>
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
}

function drawPoints() {
  const g = $('lmPts'); if (!g || !PROJ) return;
  const parts = [];
  for (const p of LANDMARKS) {
    const st = STATE.get(p.key) || { tier: 'may' };
    const [x, y] = project(p.ll);
    const cls = 'lm-pt ' + st.tier + (SELECTED === p.key ? ' sel' : '');
    parts.push(`<circle class="${cls}" data-key="${esc(p.key)}" cx="${x.toFixed(5)}" cy="${y.toFixed(5)}" r="1"><title>${esc(st.as || p.name)} — ${esc(TIER_LABEL[st.tier])}</title></circle>`);
  }
  g.innerHTML = parts.join('');
}

/**
 * Zoom by `f` about a point given as a fraction of the stage, 0..1 (OA-215).
 *
 * FOUR THINGS DRIVE THIS AND UNTIL TODAY ONLY ONE DID. The wheel was the whole
 * zoom, and the reader this screen is written for works on a trackpad, where a
 * wheel gesture is not something anyone finds by accident: he reported that the
 * map panned and could not be zoomed. So the wheel, the + / - buttons, a
 * double-click and the keyboard all come through here.
 *
 * Clamped at BOTH ends. Out to the whole town, which the wheel already did, and
 * in to MAX_ZOOM, which it did not — an unbounded zoom leaves somebody looking
 * at blank paper with no way back but Fit.
 */
function zoomAt(f, fx = 0.5, fy = 0.5) {
  if (!VIEW || !FULL) return;
  const nw = Math.max(FULL.w / MAX_ZOOM, Math.min(FULL.w, VIEW.w * f));
  const nh = Math.max(FULL.h / MAX_ZOOM, Math.min(FULL.h, VIEW.h * f));
  VIEW = { x: VIEW.x + (VIEW.w - nw) * fx, y: VIEW.y + (VIEW.h - nh) * fy, w: nw, h: nh };
  applyView();
}

/** Where a pointer event sits inside the stage, as a fraction of it. */
function pointerFraction(svg, e) {
  const r = svg.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}

function wireMapGestures() {
  const svg = $('lmSvg');
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [fx, fy] = pointerFraction(svg, e);
    zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, fx, fy);
  }, { passive: false });

  // A double-click zooms IN about the point clicked; with Shift or Alt, out.
  svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const [fx, fy] = pointerFraction(svg, e);
    zoomAt(e.shiftKey || e.altKey ? ZOOM_STEP : 1 / ZOOM_STEP, fx, fy);
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

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: VIEW.x, vy: VIEW.y };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    VIEW.x = drag.vx - (e.clientX - drag.x) * (VIEW.w / r.width);
    VIEW.y = drag.vy - (e.clientY - drag.y) * (VIEW.h / r.height);
    applyView();
  });
  const stop = () => { drag = null; };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);

  // Click a dot on the map to find its row — the other half of "show me where".
  svg.addEventListener('click', (e) => {
    const c = e.target.closest('[data-key]'); if (!c) return;
    selectKey(c.getAttribute('data-key'), true);
  });
}

$('zoomFit').addEventListener('click', () => { if (FULL) { VIEW = { ...FULL }; applyView(); } });
$('zoomIn').addEventListener('click', () => zoomAt(1 / ZOOM_STEP));
$('zoomOut').addEventListener('click', () => zoomAt(ZOOM_STEP));

// ---------------------------------------------------------------------------
// the list
// ---------------------------------------------------------------------------

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
  if (q && !(p.name + ' ' + p.cat + ' ' + ((st && st.as) || '')).toLowerCase().includes(q)) return false;
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
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b));
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
        <b>${esc(cat)}</b> <span class="count">${rows.length}</span>
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

/** Open one row — or pass null to close the one that is open (OA-215). */
function selectKey(key, scroll) {
  SELECTED = key;
  drawPoints();
  document.querySelectorAll('.lm-row').forEach((r) => r.classList.toggle('sel', key != null && r.dataset.key === key));
  if (scroll && key != null) {
    const row = document.querySelector(`.lm-row[data-key="${CSS.escape(key)}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// One delegated listener for the whole list — the rows are rebuilt on every
// filter change, so per-row listeners would have to be rewired each time.
$('list').addEventListener('change', (e) => {
  const row = e.target.closest('.lm-row');
  if (row && e.target.type === 'radio') {
    setTier(row.dataset.key, e.target.value);
    const stx = STATE.get(row.dataset.key) || {};
    row.className = 'lm-row ' + e.target.value + (stx.set ? ' set' : '') + (stx.as ? ' renamed' : '')
      + (SELECTED === row.dataset.key ? ' sel' : '');
    row.querySelectorAll('.lm-opt').forEach((o) => o.classList.toggle('on', o.querySelector('input').checked));
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
  // Clicking the OPEN row again closes it. It used to re-select it, so the only
  // way out of an expanded row was to open a different one (OA-215).
  if (row && !e.target.closest('.lm-choices') && !e.target.closest('.lm-rename')) {
    selectKey(row.dataset.key === SELECTED ? null : row.dataset.key, false);
  }
});

// Esc closes the open row as well — but not while the sheet dialog is up, which
// owns Esc for itself and would otherwise close both at one press.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('sheetDialog').open || !SELECTED) return;
  selectKey(null, false);
  e.preventDefault();
});

$('search').addEventListener('input', buildList);
$('filters').addEventListener('click', (e) => {
  const c = e.target.closest('[data-filter]'); if (!c) return;
  FILTER = c.dataset.filter;
  document.querySelectorAll('#filters .lm-chip').forEach((b) => b.classList.toggle('active', b === c));
  buildList();
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

function onEdit() {
  drawPoints();
  const d = dirty();
  $('saveBtn').disabled = !d;
  $('stateDot').className = 'dot ' + (d ? 'dirty' : 'clean');
  $('stateText').textContent = d ? 'Not saved yet' : 'No changes';

  const musts = [...STATE.values()].filter((s) => s.tier === 'must').length;
  const misses = [...STATE.values()].filter((s) => s.tier === 'miss').length;
  const answered = [...STATE.values()].filter((s) => s.set || s.as).length;
  $('tally').innerHTML = `<span class="lm-key must">Must show</span> ${musts}
     · <span class="lm-key miss">Do not show</span> ${misses}
     · <span class="lm-key may">left as they are</span> ${LANDMARKS.length - musts - misses}
     <br><b>${answered}</b> of ${LANDMARKS.length} answered · ${LANDMARKS.length - answered} not looked at yet`;

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
    note(`Saved as version ${b.version || ''}. The map has been redrawn with your choices.`, 'ok');
    await load();
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

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

async function load() {
  const [d, l] = await Promise.all([
    fetch(`/api/maps/${MAP_ID}`).then((r) => r.json()),
    fetch(`/api/maps/${MAP_ID}/landmarks`).then((r) => r.json()),
  ]);
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
