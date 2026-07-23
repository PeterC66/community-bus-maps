// Safe-subset map editor (client).
//
// Two edits only — recolour a route, show/hide a POI — mirrored into a staged
// overrides object. Every change previews through the server (which re-runs the
// real generator, so the preview is the shipped output), and Save renders a new
// numbered version with print-ready files. The server independently enforces the
// safe subset; this UI simply never offers anything outside it.

const MAP_ID = Number(location.pathname.split('/').pop());
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let detail = null;            // /api/maps/:id map object
let staged = { colors: {}, hide: new Set() };  // current unsaved edits
let savedSig = '';           // signature of the last saved overrides
let activeMap = 'internal';
const savedSvg = {};         // SVGs of the current saved version
let previewSvg = null;       // { internal, external } from the last preview (null → show saved)
let hasExternal = false;

// ---- overrides <-> staged ----------------------------------------------------
function stagedFromOverrides(ov) {
  const colors = { ...(ov.routeColors || {}) };
  const hide = new Set(Object.keys((ov.internal && ov.internal.pois) || {})
    .filter((k) => ov.internal.pois[k] && ov.internal.pois[k].hide));
  return { colors, hide };
}
function overridesFromStaged(s) {
  const ov = {};
  if (Object.keys(s.colors).length) ov.routeColors = { ...s.colors };
  if (s.hide.size) ov.internal = { pois: Object.fromEntries([...s.hide].map((k) => [k, { hide: true }])) };
  return ov;
}
// stable signature so we can tell clean from dirty even after a revert
function sig(s) {
  const c = Object.keys(s.colors).sort().map((k) => `${k}=${(s.colors[k] || '').toLowerCase()}`).join(',');
  const h = [...s.hide].sort().join(',');
  return `C:${c}|H:${h}`;
}
const isDirty = () => sig(staged) !== savedSig;

// ---- state chips -------------------------------------------------------------
function refreshState() {
  const dirty = isDirty();
  $('stateDot').className = 'dot ' + (dirty ? 'dirty' : 'clean');
  $('stateText').textContent = dirty ? 'Unsaved changes' : 'Saved';
  $('saveBtn').disabled = !dirty;
  $('resetBtn').disabled = staged.hide.size === 0 && Object.keys(staged.colors).length === 0;
}
function setPvState(kind, text) {
  $('pvDot').className = 'dot ' + kind;
  $('pvText').textContent = text;
}

// ---- build controls ----------------------------------------------------------
function buildRoutes() {
  const box = $('routes');
  box.innerHTML = detail.routes.map((r) => {
    const sub = r.desc ? esc(Array.isArray(r.desc) ? r.desc.join(' · ') : r.desc) : '';
    return `<div class="route-row" data-route="${esc(r.id)}">
      <input class="route-swatch" type="color" value="${esc((staged.colors[r.id] || r.defaultColor).toLowerCase())}"
             data-route="${esc(r.id)}" aria-label="Colour for route ${esc(r.id)}">
      <span class="route-badge" style="background:${esc(staged.colors[r.id] || r.defaultColor)};color:${esc(r.textOn)}">${esc(r.id)}</span>
      <span class="route-desc"><span class="r-title">${sub || ('Route ' + esc(r.id))}</span></span>
      <button class="link-btn r-reset" data-route="${esc(r.id)}" ${staged.colors[r.id] ? '' : 'disabled'}>reset</button>
    </div>`;
  }).join('');
  $('routeCount').textContent = detail.routes.length + ' routes';

  box.querySelectorAll('input.route-swatch').forEach((inp) => {
    inp.addEventListener('input', () => {
      const r = inp.dataset.route;
      const def = detail.routes.find((x) => x.id === r).defaultColor.toLowerCase();
      if (inp.value.toLowerCase() === def) delete staged.colors[r];
      else staged.colors[r] = inp.value;
      syncRouteRow(r);
      onEdit();
    });
  });
  box.querySelectorAll('button.r-reset').forEach((b) => {
    b.addEventListener('click', () => {
      const r = b.dataset.route;
      delete staged.colors[r];
      const row = box.querySelector(`.route-row[data-route="${CSS.escape(r)}"]`);
      const def = detail.routes.find((x) => x.id === r).defaultColor;
      row.querySelector('input.route-swatch').value = def.toLowerCase();
      syncRouteRow(r);
      onEdit();
    });
  });
}
function syncRouteRow(r) {
  const row = $('routes').querySelector(`.route-row[data-route="${CSS.escape(r)}"]`);
  if (!row) return;
  const def = detail.routes.find((x) => x.id === r);
  const col = staged.colors[r] || def.defaultColor;
  row.querySelector('.route-badge').style.background = col;
  row.querySelector('.r-reset').disabled = !staged.colors[r];
}

function buildPois() {
  const box = $('pois');
  const byCat = new Map();
  for (const p of detail.pois) {
    if (!byCat.has(p.cat)) byCat.set(p.cat, []);
    byCat.get(p.cat).push(p);
  }
  let html = '';
  for (const [cat, items] of byCat) {
    html += `<div class="poi-cat">${esc(cat || 'Other')}</div>`;
    for (const p of items) {
      const shown = !staged.hide.has(p.key);
      html += `<div class="poi-item ${shown ? '' : 'off'}" data-key="${esc(p.key)}" data-search="${esc((p.name + ' ' + p.cat).toLowerCase())}">
        <input type="checkbox" id="poi_${esc(p.key)}" ${shown ? 'checked' : ''}>
        <label for="poi_${esc(p.key)}">${esc(p.name || p.key)}</label></div>`;
    }
  }
  box.innerHTML = html || '<p class="hint-line">No toggleable landmarks on this map.</p>';
  $('poiCount').textContent = detail.pois.length + ' landmarks';

  box.querySelectorAll('.poi-item input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const item = inp.closest('.poi-item');
      const key = item.dataset.key;
      if (inp.checked) staged.hide.delete(key); else staged.hide.add(key);
      item.classList.toggle('off', !inp.checked);
      onEdit();
    });
  });
  $('poiSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    box.querySelectorAll('.poi-item').forEach((it) => { it.style.display = !q || it.dataset.search.includes(q) ? '' : 'none'; });
    box.querySelectorAll('.poi-cat').forEach((c) => {
      let n = c.nextElementSibling; let any = false;
      while (n && n.classList.contains('poi-item')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      c.style.display = any ? '' : 'none';
    });
  });
}

// ---- preview (single-flight, debounced) --------------------------------------
let debounce = null;
let inFlight = false;
let queued = false;
function onEdit() {
  refreshState();
  clearTimeout(debounce);
  debounce = setTimeout(runPreview, 350);
}
async function runPreview() {
  if (inFlight) { queued = true; return; }
  inFlight = true; queued = false;
  $('stage').classList.add('busy');
  setPvState('busy', 'Rendering…');
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: overridesFromStaged(staged) }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      previewSvg = body.svg || {};
      showStage();
      reportRejected(body.rejected);
      setPvState(isDirty() ? 'dirty' : 'clean', isDirty() ? 'Preview (unsaved)' : 'Showing saved version');
    } else {
      notice('err', (body && body.error) || 'Preview failed.');
      setPvState('dirty', 'Preview failed');
    }
  } catch {
    notice('err', 'Network error while rendering the preview.');
    setPvState('dirty', 'Preview failed');
  } finally {
    inFlight = false;
    $('stage').classList.remove('busy');
    if (queued) runPreview();
  }
}

// ---- stage -------------------------------------------------------------------
function currentSvg() {
  if (previewSvg && previewSvg[activeMap]) return previewSvg[activeMap];
  return savedSvg[activeMap] || null;
}
function showStage() {
  const svg = currentSvg();
  const stage = $('stage');
  const overlay = stage.querySelector('.overlay');
  stage.innerHTML = '';
  if (svg) {
    stage.insertAdjacentHTML('afterbegin', svg);
  } else {
    stage.insertAdjacentHTML('afterbegin', `<div class="placeholder">This map has no “${activeMap === 'external' ? 'to nearby towns' : 'within the area'}” output.</div>`);
  }
  stage.appendChild(overlay);
}

// ---- notices -----------------------------------------------------------------
let noticeTimer = null;
function notice(kind, text, sticky) {
  const el = $('notice');
  el.className = 'notice show ' + kind;
  el.textContent = text;
  clearTimeout(noticeTimer);
  if (!sticky) noticeTimer = setTimeout(() => { el.className = 'notice'; }, 6000);
}
function reportRejected(rej) {
  if (rej && rej.length) notice('warn', 'Some edits were outside what you can change here and were ignored: ' + rej.join('; '));
}

// ---- downloads ---------------------------------------------------------------
function buildDownloads() {
  const box = $('downloads');
  if (!detail.currentVersion || !detail.downloads.length) { box.innerHTML = ''; return; }
  const label = { 'internal.svg': 'Within · SVG', 'internal.jpg': 'Within · JPG (print)', 'external.svg': 'To towns · SVG', 'external.jpg': 'To towns · JPG (print)' };
  box.innerHTML = `<h3>Downloads — saved version ${esc(detail.currentVersion)}</h3>
    <div class="dl-row">${detail.downloads.map((d) => `<a class="dl" href="${d.url}?download" download>⬇ ${label[d.file] || d.file}</a>`).join('')}</div>`;
}

// ---- load saved-version SVGs -------------------------------------------------
async function loadSavedSvg() {
  if (!detail.currentVersion) return;
  for (const name of ['internal', 'external']) {
    try {
      const r = await fetch(`/api/maps/${MAP_ID}/versions/${detail.currentVersion}/${name}.svg`);
      if (r.ok) { savedSvg[name] = await r.text(); if (name === 'external') hasExternal = true; }
    } catch { /* leave missing */ }
  }
}

// ---- save --------------------------------------------------------------------
$('saveBtn').addEventListener('click', async () => {
  const btn = $('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: overridesFromStaged(staged), note: $('saveNote').value }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      detail.currentVersion = body.version;
      detail.downloads = body.downloads || [];
      detail.overrides = overridesFromStaged(staged);
      savedSig = sig(staged);
      $('mapCrumb').textContent = [detail.subject, 'current ' + body.version].filter(Boolean).join(' · ');
      // the just-saved render IS the current preview → promote it to "saved"
      if (previewSvg) { for (const k of Object.keys(previewSvg)) savedSvg[k] = previewSvg[k]; }
      previewSvg = null;
      $('saveNote').value = '';
      buildDownloads();
      showStage();
      refreshState();
      setPvState('clean', 'Showing saved version');
      notice('ok', `Saved version ${body.version}. Print-ready files are ready to download below.`);
    } else {
      notice('err', (body && body.error) || 'Save failed.', true);
    }
  } catch {
    notice('err', 'Network error while saving.', true);
  } finally {
    btn.textContent = 'Save new version'; btn.disabled = !isDirty();
  }
});

// ---- reset & manual preview & tabs -------------------------------------------
$('resetBtn').addEventListener('click', () => {
  staged = { colors: {}, hide: new Set() };
  buildRoutes(); buildPois();
  onEdit();
});
$('previewBtn').addEventListener('click', () => { clearTimeout(debounce); runPreview(); });
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  activeMap = t.dataset.map;
  showStage();
}));
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---- init --------------------------------------------------------------------
(async () => {
  try {
    const res = await fetch(`/api/maps/${MAP_ID}`);
    const body = await res.json();
    if (!res.ok || !body.ok) { $('stagePlaceholder').textContent = (body && body.error) || 'Could not load this map.'; return; }
    detail = body.map;
    document.title = `Edit ${detail.name} — Community Bus Maps`;
    $('mapName').textContent = detail.name;
    $('mapTag').innerHTML = `<span class="tag ${detail.kind === 'place' ? 'place' : 'area'}">${detail.kind === 'place' ? 'Place' : 'Area'}</span>`;
    $('mapCrumb').textContent = [detail.subject, detail.currentVersion ? 'current ' + detail.currentVersion : ''].filter(Boolean).join(' · ');

    staged = stagedFromOverrides(detail.overrides || {});
    savedSig = sig(staged);
    buildRoutes();
    buildPois();
    buildDownloads();
    refreshState();

    await loadSavedSvg();
    if (!savedSvg.external) $('tabExternal').style.display = 'none';
    showStage();
    setPvState('clean', 'Showing saved version');
  } catch (e) {
    $('stagePlaceholder').textContent = 'Could not load this map. Is the server running?';
  }
})();
