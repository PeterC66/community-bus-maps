// Safe-subset map editor (client).
//
// Two content edits (recolour a route, show/hide a POI) staged into an overrides
// object and previewed through the real generator, plus a map-level control:
// which OUTPUTS the map produces (P2). Auth-gated: the page redirects to the
// login screen if there is no session. The server independently enforces the
// safe subset, tenant isolation, and the output whitelist.

const MAP_ID = Number(location.pathname.split('/').pop());
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let detail = null;
let ME = null;                   // the signed-in user (gates the expert-only links)
let staged = { colors: {}, hide: new Set(), hiddenOps: new Set() };
let savedSig = '';
let activeMap = null;             // artefact base name of the shown output
const savedSvg = {};             // saved-version SVGs by base
let previewSvg = null;           // last preview SVGs by base (null → show saved)

// ---- badge legibility --------------------------------------------------------
// Mirrors src/render/badgeContrast.js so the swatch list shows the same ink the
// printed sheet will use. A route's `textOn` comes from the imported data and
// does not follow a recolour, so a route recoloured dark keeps dark text and its
// number disappears — here and on the map. Keep the two rules in step.
function luminance(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }).reduce((s, c, i) => s + [0.2126, 0.7152, 0.0722][i] * c, 0);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function inkFor(bg, want) {
  const r = contrast(bg, want);
  if (r === null || r >= 2) return want;             // see MIN_RATIO in badgeContrast.js
  return (contrast(bg, '#ffffff') || 0) >= (contrast(bg, '#111111') || 0) ? '#ffffff' : '#111111';
}
const routeInk = (r) => inkFor(staged.colors[r.id] || r.defaultColor, r.textOn);

// ---- overrides <-> staged ----------------------------------------------------
function stagedFromOverrides(ov) {
  const colors = { ...(ov.routeColors || {}) };
  const hide = new Set(Object.keys((ov.internal && ov.internal.pois) || {})
    .filter((k) => ov.internal.pois[k] && ov.internal.pois[k].hide));
  const hiddenOps = new Set(Array.isArray(ov.hiddenOperators) ? ov.hiddenOperators : []);
  return { colors, hide, hiddenOps };
}
function overridesFromStaged(s) {
  const ov = {};
  if (Object.keys(s.colors).length) ov.routeColors = { ...s.colors };
  if (s.hide.size) ov.internal = { pois: Object.fromEntries([...s.hide].map((k) => [k, { hide: true }])) };
  if (s.hiddenOps.size) ov.hiddenOperators = [...s.hiddenOps];
  return ov;
}
function sig(s) {
  const c = Object.keys(s.colors).sort().map((k) => `${k}=${(s.colors[k] || '').toLowerCase()}`).join(',');
  return `C:${c}|H:${[...s.hide].sort().join(',')}|O:${[...s.hiddenOps].sort().join(',')}`;
}
const isDirty = () => sig(staged) !== savedSig;

const enabledOutputs = () => detail.outputs.filter((o) => o.available && o.enabled);
const labelForBase = (base) => (detail.outputs.find((o) => o.base === base) || {}).label || base;
// The one-sentence description of a sheet (src/maps/store.js OUTPUT_HINTS). It
// is the tab's tooltip AND the line under the tab row: an editor is asked to
// review every output, and a tooltip reaches neither a keyboard nor a phone.
const hintForBase = (base) => (detail.outputs.find((o) => o.base === base) || {}).hint || '';
const isLocked = () => detail && detail.editable === false; // frozen while awaiting review

// Download labels were a hard-coded table of abbreviations ("Within · SVG") that
// named area sheets on a place map and did not read as downloads (findings H5,
// D1). Derive them from the outputs the server described instead, so one sheet
// has one name on the tabs, in the downloads and on its public page.
function dlLabel(file) {
  if (file === 'disagreements.pdf') return 'Disagreements report (PDF)';
  const m = /^(.*)\.(svg|jpg)$/.exec(file);
  if (!m) return file;
  return `${labelForBase(m[1])} — ${m[2] === 'jpg' ? 'print-ready JPG' : 'SVG'}`;
}

// ---- state chips -------------------------------------------------------------
function refreshState() {
  const locked = isLocked();
  const dirty = isDirty();
  $('stateDot').className = 'dot ' + (locked ? '' : (dirty ? 'dirty' : 'clean'));
  // One state, one name: this chip said "Locked for review" while the panel
  // below it and the dashboard pill said "Awaiting review" (findings D2).
  $('stateText').textContent = locked ? 'Awaiting review' : (dirty ? 'Unsaved changes' : 'Saved');
  // A disabled control must say why: "Save new version" is off for two quite different
  // reasons, and a customer who has just accepted an update is told elsewhere to press it.
  const paused = 'Editing is paused while this map is with the approver.';
  const saveBtn = $('saveBtn');
  saveBtn.disabled = locked || !dirty;
  saveBtn.title = locked ? paused
    : (dirty ? '' : 'Nothing to save — this button is only for your own edits (colours, landmarks, operators).');
  const untouched = staged.hide.size === 0 && staged.hiddenOps.size === 0 && Object.keys(staged.colors).length === 0;
  const resetBtn = $('resetBtn');
  resetBtn.disabled = locked || untouched;
  resetBtn.title = locked ? paused : (untouched ? 'Nothing to undo — you have not changed anything yet.' : '');
}

// Disable the editing controls while a version awaits publication review.
// `data-fixed` marks a control that is disabled for its OWN reason (an output this
// map cannot produce, or the request-only diagram) — unlocking must not hand it back.
function applyLock() {
  const locked = isLocked();
  document.querySelectorAll('#routes input, #routes button, #operators input, #pois input, #outputs input, #resetBtn, #saveNote')
    .forEach((el) => { el.disabled = locked || el.dataset.fixed === '1'; });
  refreshState();
}
function setPvState(kind, text) { $('pvDot').className = 'dot ' + kind; $('pvText').textContent = text; }

// ---- controls: outputs -------------------------------------------------------
// One output — the tube-map diagram — is `requestOnly`: hand-finished, quoted
// separately, and re-pinned by us every time the network moves. The customer sees
// it locked with an "Ask us" button rather than hidden, so they know it exists.
// The lock is enforced in the server's PATCH handler; this is only the UX of it.
const isAdmin = () => !!(ME && ME.role === 'admin');
const lockedOutput = (o) => o.requestOnly && !isAdmin();

function outputHint(o) {
  if (!o.available) return ' <span class="soon">— not set up for this map</span>';
  if (lockedOutput(o)) return ' <span class="soon">— hand-finished, quoted separately</span>';
  return o.expert ? ' <span class="soon">— expert style</span>' : '';
}
function buildOutputs() {
  const box = $('outputs');
  box.innerHTML = detail.outputs.map((o) => `
    <div class="poi-item ${o.enabled ? '' : 'off'}" data-key="${esc(o.key)}">
      <input type="checkbox" id="out_${esc(o.key)}" ${o.enabled ? 'checked' : ''} ${o.available && !lockedOutput(o) ? '' : 'disabled data-fixed="1"'}>
      <label for="out_${esc(o.key)}">${esc(o.label)}${outputHint(o)}</label>
      ${lockedOutput(o) && o.available && !o.enabled ? '<button class="btn btn-ghost btn-xs" type="button" id="askDiagram">Ask us</button>' : ''}
    </div>`).join('');
  $('outputCount').textContent = enabledOutputs().length + ' on';
  box.querySelectorAll('input[type=checkbox]').forEach((inp) => inp.addEventListener('change', onOutputsChange));
  const ask = $('askDiagram');
  if (ask) ask.addEventListener('click', askForDiagram);
}
async function onOutputsChange() {
  const outputs = {};
  $('outputs').querySelectorAll('input[type=checkbox]').forEach((inp) => {
    if (!inp.disabled) outputs[inp.id.replace('out_', '')] = inp.checked;
  });
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/outputs`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outputs }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      detail.outputs = body.outputs;
      renderPending = true;
      buildOutputs();
      buildTabs();
      notice('warn', 'Outputs updated — showing a preview. Save to add the enabled sheets to the print-ready files.');
      runPreview();
    } else {
      notice('err', (body && body.error) || 'Could not update outputs.');
      buildOutputs(); // revert checkboxes to server truth
    }
  } catch { notice('err', 'Network error updating outputs.'); }
}

// Asking for the locked output raises a MESSAGE for the admin console — nothing
// is switched on here. Granting it is expert work with a price attached.
async function askForDiagram() {
  const btn = $('askDiagram');
  const note = prompt(
    'Ask us for the tube-map diagram of this map.\n\n'
    + 'Every line and interchange is positioned by hand, and re-positioned whenever the network '
    + 'moves, so it is quoted separately from the rest of the map.\n\n'
    + 'Anything we should know? (Where it would be displayed, when you need it — optional.)', '');
  if (note === null) return; // cancelled
  btn.disabled = true;
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/diagram-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      btn.textContent = 'Asked';
      notice('ok', 'Thank you — we have your request and will come back to you with what it would involve.', true);
    } else {
      btn.disabled = false;
      notice('err', (body && body.error) || 'Could not send that request.');
    }
  } catch { btn.disabled = false; notice('err', 'Network error sending that request.'); }
}

// ---- controls: routes --------------------------------------------------------
function buildRoutes() {
  const box = $('routes');
  box.innerHTML = detail.routes.map((r) => {
    const sub = r.desc ? esc(Array.isArray(r.desc) ? r.desc.join(' · ') : r.desc) : '';
    return `<div class="route-row" data-route="${esc(r.id)}">
      <input class="route-swatch" type="color" value="${esc((staged.colors[r.id] || r.defaultColor).toLowerCase())}" data-route="${esc(r.id)}" aria-label="Colour for route ${esc(r.id)}">
      <span class="route-badge" style="background:${esc(staged.colors[r.id] || r.defaultColor)};color:${esc(routeInk(r))}">${esc(r.id)}</span>
      <span class="route-desc"><span class="r-title" title="${sub || ('Route ' + esc(r.id))}">${sub || ('Route ' + esc(r.id))}</span></span>
      <button class="link-btn r-reset" data-route="${esc(r.id)}" ${staged.colors[r.id] ? '' : 'disabled'}>reset</button>
    </div>`;
  }).join('');
  $('routeCount').textContent = detail.routes.length + ' routes';
  box.querySelectorAll('input.route-swatch').forEach((inp) => inp.addEventListener('input', () => {
    const r = inp.dataset.route;
    const def = detail.routes.find((x) => x.id === r).defaultColor.toLowerCase();
    if (inp.value.toLowerCase() === def) delete staged.colors[r]; else staged.colors[r] = inp.value;
    syncRouteRow(r); onEdit();
  }));
  box.querySelectorAll('button.r-reset').forEach((b) => b.addEventListener('click', () => {
    const r = b.dataset.route;
    delete staged.colors[r];
    box.querySelector(`.route-row[data-route="${CSS.escape(r)}"] input.route-swatch`).value = detail.routes.find((x) => x.id === r).defaultColor.toLowerCase();
    syncRouteRow(r); onEdit();
  }));
}
function syncRouteRow(r) {
  const row = $('routes').querySelector(`.route-row[data-route="${CSS.escape(r)}"]`);
  if (!row) return;
  const def = detail.routes.find((x) => x.id === r);
  const badge = row.querySelector('.route-badge');
  badge.style.background = staged.colors[r] || def.defaultColor;
  badge.style.color = routeInk(def);
  row.querySelector('.r-reset').disabled = !staged.colors[r];
}

// ---- controls: operator filter (opt-in per customer) -------------------------
function buildOperators() {
  const panel = $('operatorsPanel');
  if (!detail.hideOperatorsEnabled || !detail.operators.length) { panel.hidden = true; return; }
  panel.hidden = false;
  // A map that draws a "Where to board" sheet cannot honour this edit at all
  // (OA-011): the stop each destination is boarded at was worked out across
  // every route serving it, so filtering routes would drop destinations you can
  // still get to. The generator refuses rather than half-apply it, which used to
  // surface as a render error at save time. Say so here instead, and switch the
  // boxes off — the sentence comes from the safe subset itself, so the control
  // and the rejection cannot drift apart.
  const blocked = detail.hideOperatorsBlocked || null;
  $('operatorsHint').hidden = !!blocked;
  const warn = $('operatorsBlocked');
  // `.notice` is display:none until `.show` — the panel's own convention.
  warn.classList.toggle('show', !!blocked);
  if (blocked) warn.textContent = 'Operators cannot be hidden on this map: ' + blocked + '.';

  const box = $('operators');
  box.innerHTML = detail.operators.map((op) => {
    const shown = !staged.hiddenOps.has(op.name);
    return `<label class="poi-row" data-op="${esc(op.name)}">
      <input type="checkbox" ${shown ? 'checked' : ''}${blocked ? ' disabled' : ''}>
      <span>${esc(op.name)}</span>
    </label>`;
  }).join('');
  $('operatorCount').textContent = detail.operators.length + ' operators';
  if (blocked) return; // the boxes are inert — nothing to wire up
  box.querySelectorAll('label[data-op] input').forEach((inp) => inp.addEventListener('change', () => {
    const name = inp.closest('label').dataset.op;
    if (inp.checked) staged.hiddenOps.delete(name); else staged.hiddenOps.add(name);
    onEdit();
  }));
}

// ---- controls: POIs ----------------------------------------------------------
function buildPois() {
  const box = $('pois');
  const byCat = new Map();
  for (const p of detail.pois) { if (!byCat.has(p.cat)) byCat.set(p.cat, []); byCat.get(p.cat).push(p); }
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
  box.querySelectorAll('.poi-item input').forEach((inp) => inp.addEventListener('change', () => {
    const item = inp.closest('.poi-item');
    if (inp.checked) staged.hide.delete(item.dataset.key); else staged.hide.add(item.dataset.key);
    item.classList.toggle('off', !inp.checked); onEdit();
  }));
  $('poiSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    box.querySelectorAll('.poi-item').forEach((it) => { it.style.display = !q || it.dataset.search.includes(q) ? '' : 'none'; });
    box.querySelectorAll('.poi-cat').forEach((c) => {
      let n = c.nextElementSibling, any = false;
      while (n && n.classList.contains('poi-item')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      c.style.display = any ? '' : 'none';
    });
  });
}

// ---- preview tabs ------------------------------------------------------------
function buildTabs() {
  const outs = enabledOutputs();
  if (!outs.some((o) => o.base === activeMap)) activeMap = outs.length ? outs[0].base : null;
  $('tabs').innerHTML = outs.map((o) => `<button class="tab ${o.base === activeMap ? 'active' : ''}" data-map="${esc(o.base)}" role="tab" aria-selected="${o.base === activeMap}" title="${esc(o.hint || o.label)}">${esc(o.label)}</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    $('tabs').querySelectorAll('.tab').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
    t.classList.add('active'); t.setAttribute('aria-selected', 'true');
    activeMap = t.dataset.map; setTabHint(); showStage();
  }));
  setTabHint();
  showStage();
}

function setTabHint() {
  const el = $('tabHint');
  if (!el) return;
  const h = hintForBase(activeMap);
  el.textContent = h;
  el.hidden = !h;
}

// ---- preview (single-flight, debounced) --------------------------------------
let debounce = null, inFlight = false, queued = false, renderPending = false;
const isRendering = () => inFlight || renderPending;
function onEdit() { refreshState(); clearTimeout(debounce); debounce = setTimeout(runPreview, 350); }
async function runPreview() {
  if (inFlight) { queued = true; return; }
  inFlight = true; queued = false; renderPending = false;
  $('stage').classList.add('busy'); setPvState('busy', 'Rendering…');
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides: overridesFromStaged(staged) }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      previewSvg = body.svg || {};
      showStage(); reportRejected(body.rejected);
      setPvState(isDirty() ? 'dirty' : 'clean', isDirty() ? 'Preview (unsaved)' : 'Showing saved version');
    } else { notice('err', (body && body.error) || 'Preview failed.'); setPvState('dirty', 'Preview failed'); }
  } catch { notice('err', 'Network error while rendering the preview.'); setPvState('dirty', 'Preview failed'); }
  finally { inFlight = false; $('stage').classList.remove('busy'); if (queued) runPreview(); }
}

// ---- stage -------------------------------------------------------------------
function currentSvg() {
  if (previewSvg && previewSvg[activeMap]) return previewSvg[activeMap];
  return savedSvg[activeMap] || null;
}
function showStage() {
  const svg = currentSvg(), stage = $('stage'), overlay = stage.querySelector('.overlay');
  stage.innerHTML = '';
  if (svg) stage.insertAdjacentHTML('afterbegin', svg);
  else {
    // No sheet yet: either one is on its way (a newly enabled output has no file
    // in the saved version, so we render it rather than asking for a save first)
    // or there is genuinely nothing to show.
    const msg = !activeMap ? 'No outputs enabled.'
      : (isRendering() ? 'Rendering “' + esc(labelForBase(activeMap)) + '”…'
        : 'Save to render “' + esc(labelForBase(activeMap)) + '”.');
    stage.insertAdjacentHTML('afterbegin', `<div class="placeholder">${msg}</div>`);
  }
  stage.appendChild(overlay);
}

// ---- notices -----------------------------------------------------------------
let noticeTimer = null;
function notice(kind, text, sticky) {
  const el = $('notice'); el.className = 'notice show ' + kind; el.textContent = text;
  clearTimeout(noticeTimer); if (!sticky) noticeTimer = setTimeout(() => { el.className = 'notice'; }, 6000);
}
function reportRejected(rej) { if (rej && rej.length) notice('warn', 'Some edits were outside what you can change here and were ignored: ' + rej.join('; ')); }

// ---- downloads ---------------------------------------------------------------
// Two download rows sit on this page and they can hold DIFFERENT versions: the
// one you are working on, and the one the public is being served. Neither used
// to say which it was (findings H5) — hence the headings below.
function dlRow(list) {
  return `<div class="dl-row">${list.map((d) => `<a class="dl" href="${d.url}?download" download>⬇ ${esc(dlLabel(d.file))}</a>`).join('')}</div>`;
}
function buildDownloads() {
  const box = $('downloads');
  if (!detail.currentVersion || !detail.downloads.length) { box.innerHTML = ''; return; }
  const published = detail.publishedVersion && detail.publishedVersion === detail.currentVersion;
  const tag = published ? ' <span class="status-pill pub">published</span>' : ' <span class="status-pill">draft</span>';
  const head = published
    ? `Your latest version (${esc(detail.currentVersion)}) — this is also what the public has`
    : `Your latest version (${esc(detail.currentVersion)}, not public yet)`;
  box.innerHTML = `<h3>${head}${tag}</h3>${dlRow(detail.downloads)}`;
}

// ---- version list (findings H8) ----------------------------------------------
// The Save panel promises "earlier versions stay available" — true on disk, but
// until now no screen in the customer's half of the app listed them, so it was a
// promise the interface did not keep. Everything here comes from `mapDetail`.
// "Copy these settings" stages an old version's colours/landmarks as unsaved
// edits: the way back to an earlier look is a NEW version through the ordinary
// save + review path, never a quiet swap of what is published.
const VER_STATE = {
  published: '<span class="status-pill pub">published</span>',
  pending: '<span class="status-pill req">awaiting review</span>',
  rejected: '<span class="status-pill rej">sent back</span>',
  superseded: '<span class="status-pill">earlier version</span>',
  draft: '<span class="status-pill">draft</span>',
};

function buildVersionList() {
  const box = $('versionList');
  if (!box) return;
  const list = detail.versions || [];
  if (list.length < 2) { box.innerHTML = ''; return; }  // nothing to "go back" to yet
  const rows = list.map((v) => {
    const key = v.storage_key;
    const isHead = key === detail.currentVersion;
    const isPub = key === detail.publishedVersion;
    const state = isPub ? VER_STATE.published : (VER_STATE[v.review_state] || VER_STATE.draft);
    const dls = (v.downloads || []).length ? dlRow(v.downloads) : '<p class="hint-line">Files for this version are no longer on disk.</p>';
    const copy = !isHead && v.overrides && !isLocked()
      ? `<button class="link-btn v-copy" data-ver="${esc(key)}" type="button">Copy these settings into a new draft</button>` : '';
    return `<details class="ver-row${isHead ? ' head' : ''}">
      <summary><strong>${esc(key)}</strong> ${state}
        <span class="muted">${esc(PC().fmtDay(v.created_at))}</span>
        ${isHead ? '<span class="muted">· the one you are editing</span>' : ''}
        ${v.note ? `<span class="ver-note">${esc(v.note)}</span>` : ''}</summary>
      <div class="ver-body">${dls}${copy}</div>
    </details>`;
  }).join('');
  box.innerHTML = `<h3>Every version of this map <span class="count">${list.length}</span></h3>
    <p class="hint-line">Nothing is ever deleted. Copying an earlier version's settings starts a new draft — it does not change what the public is being served, which only an approver can do.</p>
    ${rows}`;
  box.querySelectorAll('.v-copy').forEach((b) => b.addEventListener('click', () => copySettingsFrom(b.dataset.ver)));
}

function copySettingsFrom(key) {
  const v = (detail.versions || []).find((x) => x.storage_key === key);
  if (!v || !v.overrides) return;
  staged = stagedFromOverrides(v.overrides);
  buildRoutes(); buildOperators(); buildPois(); onEdit();
  // Two versions can hold identical settings (a data refresh changes the map
  // without touching them), and then there is nothing to save — say so rather
  // than sending the customer to a button that is off for a reason.
  if (isDirty()) {
    notice('warn', `Loaded ${key}'s colours and landmark choices as unsaved changes. Save to make them a new version — ${key} itself is untouched.`, true);
    scrollToPanel('saveBtn');
  } else {
    notice('ok', `${key}'s colours and landmark choices are the same as the ones you already have — nothing to change.`, true);
  }
}

// ---- publish gate (P4) -------------------------------------------------------
// Two questions, answered separately: what changed in the map DATA (an accepted
// refresh — nobody here edited anything), and what YOU changed (the safe subset).
// Only when both are empty is there genuinely nothing to publish.
function renderChangeSummary(sum, pubKey) {
  if (!sum) return '';
  const base = sum.base === 'published' ? `the published version (${esc(pubKey)})` : 'the original map';
  if (sum.unchanged) return `<p class="hint-line">No differences from ${base} yet — make an edit and save first.</p>`;
  const dataHtml = window.PortalChanges ? window.PortalChanges.dataChangeHtml(sum.dataChanges) : '';
  const parts = [];
  if (sum.routes.length) parts.push(`<li><strong>${sum.routes.length}</strong> route colour${sum.routes.length === 1 ? '' : 's'} changed <span class="muted">(${sum.routes.map((r) => esc(r.id)).join(', ')})</span></li>`);
  if (sum.poisHidden.length) parts.push(`<li><strong>${sum.poisHidden.length}</strong> landmark${sum.poisHidden.length === 1 ? '' : 's'} hidden</li>`);
  if (sum.poisShown.length) parts.push(`<li><strong>${sum.poisShown.length}</strong> landmark${sum.poisShown.length === 1 ? '' : 's'} shown</li>`);
  const yours = parts.length
    ? `<div class="change-box"><div class="change-title">${dataHtml ? 'What you changed' : `What publishing will change vs ${base}`}</div><ul class="change-list">${parts.join('')}</ul></div>`
    : (dataHtml ? '<p class="hint-line">You have made no changes of your own to this version — the difference is all in the data above.</p>' : '');
  const lead = dataHtml ? `<p class="hint-line">Publishing replaces ${base} with this one.</p>` : '';
  return lead + dataHtml + yours;
}

function buildPublishedDownloads() {
  const box = $('publishedDownloads');
  const pub = detail.publishedVersion;
  // Only shown when the published (official) version differs from the working head.
  if (!pub || pub === detail.currentVersion || !detail.publishedDownloads || !detail.publishedDownloads.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h3>What the public has (${esc(pub)}) <span class="status-pill pub">published</span></h3>${dlRow(detail.publishedDownloads)}`;
}

function buildPublish() {
  const panel = $('publishPanel');
  if (!detail.currentVersion) { panel.hidden = true; return; }
  panel.hidden = false;
  const head = detail.currentVersion, pub = detail.publishedVersion, pending = detail.pendingRequest;
  const stateEl = $('publishState'), body = $('publishBody');

  // H1 — nothing on the page said what a version covers, while the Outputs panel
  // above presents the sheets as independently switchable. It is always all of
  // them: there is no way to publish one sheet and hold another back.
  const sheets = sheetCount();
  $('publishUnit').textContent = sheets > 1
    ? `A version is the whole map: sending, reviewing and publishing cover all ${sheets} sheets of it together — there is no way to publish one sheet and hold another back.`
    : '';

  if (pending) stateEl.innerHTML = '<span class="status-pill req">Awaiting review</span>';
  else if (pub && pub === head) stateEl.innerHTML = `<span class="status-pill pub">Published ${esc(pub)}</span>`;
  else if (pub) stateEl.innerHTML = `<span class="status-pill pub">Published ${esc(pub)}</span> <span class="muted">· draft ${esc(head)}</span>`;
  else stateEl.innerHTML = '<span class="status-pill">Not yet published</span>';

  if (pending) {
    body.innerHTML = `<div class="publish-note-box">
        <p><strong>Version ${esc(pending.versionKey || head)}</strong> is with an approver at BusMaps.uk.${pending.note ? ' <span class="muted">Your note: “' + esc(pending.note) + '”.</span>' : ''}</p>
        <p class="hint-line">Editing is paused while we review it. Withdraw it if you need to make more changes.</p>
        <button class="btn btn-ghost btn-sm" id="withdrawBtn" type="button">Withdraw and edit</button>
      </div>`;
    $('withdrawBtn').addEventListener('click', withdrawPublish);
  } else if (pub === head) {
    body.innerHTML = '<p class="published-ok">✓ Your latest version is the published one. Make an edit and save to prepare a new version to send for review.</p>';
  } else {
    body.innerHTML = `${renderChangeSummary(detail.changeSummary, pub)}
      <label class="hint-line" for="publishNote" style="display:block;margin-top:10px">Note for the approver <span class="hint">— optional</span></label>
      <input class="field" id="publishNote" type="text" maxlength="200" placeholder="e.g. New route 9 colour for the summer timetable">
      <button class="btn btn-primary btn-sm" id="submitPublishBtn" type="button" style="margin-top:8px">Send ${esc(head)} for review</button>`;
    $('submitPublishBtn').addEventListener('click', submitPublish);
  }
  buildPublishedDownloads();
}

// ---- expert side (P7) --------------------------------------------------------
// Layout work is admin-only by design (it is the other half of the safe subset),
// and only offered for a map whose data actually carries a diagram configuration.
function buildExpertLinks() {
  const link = $('diagramLink');
  if (!link) return;
  const diagram = (detail.outputs || []).find((o) => o.key === 'internal_diagram');
  if (ME && ME.role === 'admin' && diagram && diagram.available) {
    link.href = `/app/maps/${MAP_ID}/diagram`;
    link.style.display = '';
  }
}

// ---- public page (P6) --------------------------------------------------------
// Whether the PUBLISHED version appears on the public site is the customer's own
// switch, separate from the publish gate: un-listing takes the page down without
// touching the reviewed version. `publicUrl` is only set by the server when the
// map is genuinely reachable by the public.
function buildPublic() {
  const panel = $('publicPanel');
  if (!detail.currentVersion) { panel.hidden = true; return; }
  panel.hidden = false;
  const listed = !!detail.publicListed;
  const live = !!detail.publicUrl;
  $('publicState').innerHTML = live
    ? '<span class="status-pill pub">Live</span>'
    : (detail.publishedVersion ? '<span class="status-pill">Hidden</span>' : '<span class="status-pill">Not published yet</span>');

  const link = live
    ? `<p><a href="${esc(detail.publicUrl)}" target="_blank" rel="noopener">${esc(location.origin + detail.publicUrl)}</a> — showing published version ${esc(detail.publishedVersion)}.</p>`
    : (detail.publishedVersion
      ? '<p class="hint-line">Your published version is not on the public site at the moment.</p>'
      : '<p class="hint-line">Nothing is public yet — a version has to be reviewed first.</p>');

  $('publicBody').innerHTML = `${link}
    <label class="poi-row" style="margin-top:6px">
      <input type="checkbox" id="listedBox" ${listed ? 'checked' : ''}>
      <span>List this map on the public site (and in our published-maps gallery)</span>
    </label>`;
  $('listedBox').addEventListener('change', async (e) => {
    const want = e.target.checked;
    e.target.disabled = true;
    try {
      const res = await fetch(`/api/maps/${MAP_ID}/public`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listed: want }),
      });
      const b = await res.json().catch(() => ({}));
      if (res.ok && b.ok) {
        detail.publicListed = b.publicListed; detail.publicUrl = b.publicUrl;
        notice('ok', want ? 'Listed — the public page is live.' : 'Hidden — the public page has been taken down.');
        buildPublic();
      } else { e.target.checked = listed; notice('err', (b && b.error) || 'Could not change the public listing.'); }
    } catch { e.target.checked = listed; notice('err', 'Network error while changing the public listing.'); }
    finally { e.target.disabled = false; }
  });
}

// ---- "changes coming" banner (P8) --------------------------------------------
function buildBanner() {
  const panel = $('bannerPanel');
  if (!detail.currentVersion) { panel.hidden = true; return; }
  panel.hidden = false;
  $('bannerSourceTag').textContent = detail.bannerNote
    ? (detail.bannerNoteSource === 'manual' ? 'edited' : 'auto-suggested')
    : '';
  $('bannerNoteText').value = detail.bannerNote || '';
}

async function saveBannerNote(note) {
  const saveBtn = $('bannerSaveBtn'), clearBtn = $('bannerClearBtn');
  saveBtn.disabled = true; clearBtn.disabled = true;
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/banner-note`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) {
      detail.bannerNote = b.bannerNote; detail.bannerNoteSource = 'manual';
      notice('ok', b.bannerNote ? 'Banner wording saved.' : 'Banner cleared.');
      buildBanner();
    } else { notice('err', (b && b.error) || 'Could not update the banner.'); }
  } catch { notice('err', 'Network error updating the banner.'); }
  finally { saveBtn.disabled = false; clearBtn.disabled = false; }
}

$('bannerSaveBtn').addEventListener('click', () => saveBannerNote(($('bannerNoteText').value || '').trim()));
$('bannerClearBtn').addEventListener('click', () => { $('bannerNoteText').value = ''; saveBannerNote(''); });

async function reloadPublish() {
  try {
    const res = await fetch(`/api/maps/${MAP_ID}`);
    const b = await res.json();
    if (!res.ok || !b.ok) return;
    const d = b.map;
    Object.assign(detail, {
      changeSummary: d.changeSummary, headState: d.headState, publishedVersion: d.publishedVersion,
      publishedDownloads: d.publishedDownloads, pendingRequest: d.pendingRequest, editable: d.editable,
      currentVersion: d.currentVersion, downloads: d.downloads, versions: d.versions, status: d.status,
      publicListed: d.publicListed, publicUrl: d.publicUrl,
      bannerNote: d.bannerNote, bannerNoteSource: d.bannerNoteSource,
    });
    applyLock(); buildPublish(); buildPublic(); buildBanner(); buildDownloads(); buildVersionList(); buildStatusStrip();
  } catch { /* leave as-is */ }
}

async function submitPublish(from) {
  const note = ($('publishNote') || {}).value || '';
  // May be driven from the status strip as well as the Publish panel (C1).
  const btn = from || $('submitPublishBtn'); btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/publish-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) { notice('ok', 'Sent to BusMaps.uk — an approver will review it and, if all is well, publish it.'); await reloadPublish(); }
    else { notice('err', (b && b.error) || 'Could not send it for review.'); btn.disabled = false; btn.textContent = `Send ${esc(detail.currentVersion)} for review`; }
  } catch { notice('err', 'Network error while sending it for review.'); btn.disabled = false; }
}

async function withdrawPublish() {
  if (!confirm('Withdraw this version from review? You will be able to edit the map again.')) return;
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/publish-request/withdraw`, { method: 'POST' });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) { notice('warn', 'Withdrawn from review — you can edit again.'); await reloadPublish(); }
    else notice('err', (b && b.error) || 'Could not withdraw it from review.');
  } catch { notice('err', 'Network error while withdrawing.'); }
}

// ---- monthly change acceptance (P5) ------------------------------------------
// A one-shot message that survives the reload we do after accept/decline.
function flash(kind, text) { try { sessionStorage.setItem('cbm_flash', JSON.stringify({ kind, text })); } catch { /* ignore */ } }

function renderDataSummary(sum) {
  if (!sum) return '';
  if (sum.unchanged) return '<p class="hint-line">No changes to the service facts — this refresh only updates the underlying map data.</p>';
  const li = [];
  const has = (a) => a && a.length;
  if (has(sum.routesAdded)) li.push(`<li><strong>New route${sum.routesAdded.length > 1 ? 's' : ''}:</strong> ${sum.routesAdded.map(esc).join(', ')}</li>`);
  if (has(sum.routesRemoved)) li.push(`<li><strong>Withdrawn route${sum.routesRemoved.length > 1 ? 's' : ''}:</strong> ${sum.routesRemoved.map(esc).join(', ')}</li>`);
  if (has(sum.descChanged)) li.push(`<li><strong>${sum.descChanged.length}</strong> route description${sum.descChanged.length > 1 ? 's' : ''} reworded <span class="muted">(${sum.descChanged.map((d) => esc(d.id)).join(', ')})</span></li>`);
  if (has(sum.stopsChanged)) li.push(`<li><strong>Stops changed</strong> on ${sum.stopsChanged.map((s) => esc(s.id) + ' (+' + s.added + '/−' + s.removed + ')').join(', ')}</li>`);
  if (has(sum.operatorsAdded)) li.push(`<li><strong>New operator${sum.operatorsAdded.length > 1 ? 's' : ''}:</strong> ${sum.operatorsAdded.map(esc).join(', ')}</li>`);
  if (has(sum.operatorsRemoved)) li.push(`<li><strong>Operator${sum.operatorsRemoved.length > 1 ? 's' : ''} removed:</strong> ${sum.operatorsRemoved.map(esc).join(', ')}</li>`);
  if (sum.validity) li.push(`<li><strong>Timetable valid from:</strong> ${esc(sum.validity.from || '—')} → ${esc(sum.validity.to || '—')}</li>`);
  return `<ul class="update-list">${li.join('')}</ul>`;
}

// ---- status strip ------------------------------------------------------------
// The flow has five states, three actors and days between them, and until now no
// screen answered the question people actually have: *whose turn is it, and how far
// along am I?* Everything below is a read-out of state `mapDetail` already returns —
// no new endpoint, no schema change. It also puts the next action at the TOP of the
// page rather than 900px down (C1), explains the frozen controls where the freezing
// is noticed (C2), and keeps the published version and its age in view (B3, B4).
const STRIP_STEPS = ['Update offered', 'Draft ready', 'Sent for review', 'Published', 'Public page'];
const PC = () => window.PortalChanges || { fmtDay: String, ageText: () => '', daysAgo: () => null };

function scrollToPanel(id) {
  const el = $(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash-target');
  setTimeout(() => el.classList.remove('flash-target'), 1600);
}

// How many sheets one publication covers — the unit of publication is the whole
// map, never a single sheet, and nothing on the page used to say so (H1).
function sheetCount() {
  return (detail.outputs || []).filter((o) => o.enabled && o.available).length;
}

/**
 * Which step the map is on, who holds it, and what to offer.
 * @returns {{at:number, blocked:boolean, offeredAt:string|null, draftAt:string|null,
 *            sentAt:string|null, publishedAt:string|null, sentBack:object|null,
 *            title:string, why:string, action:object|null, mine:boolean}|null}
 */
function stripState() {
  if (!detail.currentVersion) return null;
  const pu = detail.proposedUpdate, pending = detail.pendingRequest;
  const head = detail.currentVersion, pub = detail.publishedVersion;
  const hist = detail.publishHistory || [];          // newest first
  const refreshes = detail.refreshHistory || [];     // newest first
  const accepted = refreshes.find((r) => r.status === 'accepted') || null;
  const lastReq = hist[0] || null;
  const approvedPub = hist.find((h) => h.status === 'approved' && h.version_key === pub) || null;
  const sentBack = !pending && lastReq && lastReq.status === 'rejected' && lastReq.version_key === head ? lastReq : null;
  const headVer = (detail.versions || []).find((v) => v.storage_key === head) || null;
  // An approver or admin looking at somebody else's map is not the one being asked,
  // so the strip says "their move" — the same read-out, from the other side of the
  // handoff. (Admins carry no customer of their own, hence the explicit test.)
  const mine = !detail.customer || !!(ME && ME.customer && ME.customer.id === detail.customer.id);
  const you = mine ? 'you' : 'the customer';
  // The unit of publication is the whole map, never one sheet (H1) — say so, in
  // whichever tense the step is in.
  const sheets = sheetCount();
  const sheetLine = (lead) => (sheets > 1 ? ` ${lead} all ${sheets} sheets of this map together.` : '');

  const common = {
    offeredAt: pu ? pu.createdAt : (accepted ? accepted.created_at : null),
    draftAt: headVer ? headVer.created_at : null,
    sentAt: pending ? pending.createdAt : (lastReq ? lastReq.created_at : null),
    publishedAt: approvedPub ? approvedPub.reviewed_at : null,
    fromRefresh: !!accepted, sentBack, mine,
  };

  if (pending) {
    const age = PC().ageText(pending.createdAt);
    return {
      ...common, at: 2, blocked: true,
      title: `With BusMaps.uk since ${PC().fmtDay(pending.createdAt)}${age ? ` (${age})` : ''}.`,
      why: `Editing is paused while we review ${pending.versionKey || head}. The public ${pub ? `is still being served ${pub}` : 'has nothing yet'}.`,
      action: { label: 'Withdraw and edit', kind: 'ghost', fn: withdrawPublish },
    };
  }
  if (pu) {
    return {
      ...common, at: 0, blocked: false,
      title: mine ? 'An update is waiting for your decision.' : 'An update is waiting for the customer’s decision.',
      why: `${pu.sourceNote ? pu.sourceNote + '. ' : ''}Nothing is public yet, and the map is unaffected until ${you} decide${mine ? '' : 's'}.`,
      action: { label: 'See what changed ↓', kind: 'primary', fn: () => scrollToPanel('updatePanel') },
    };
  }
  if (sentBack) {
    return {
      ...common, at: 1, blocked: false,
      title: `BusMaps.uk asked for a change on ${PC().fmtDay(sentBack.reviewed_at)}.`,
      why: sentBack.decision_note ? `“${sentBack.decision_note}”` : `${head} was sent back without a reason recorded.`,
      action: { label: 'Edit and resubmit →', kind: 'primary', fn: () => submitPublish() },
    };
  }
  if (pub !== head) {
    const age = PC().ageText(common.draftAt);
    return {
      ...common, at: 1, blocked: false,
      title: `Draft ${head} is ready${age && age !== 'today' ? ` (saved ${age} ago)` : ''}. Nothing is public yet.`,
      why: `${pub ? `The public still has ${pub}.` : 'This map has never been published.'} It will not publish itself — send it for review when ${you} ${mine ? 'are' : 'is'} happy with the sheets below.${sheetLine('Publishing covers')}`,
      action: { label: 'Send for review →', kind: 'primary', fn: () => submitPublish() },
    };
  }
  const live = !!(detail.publicListed && detail.publicUrl);
  return {
    ...common, at: live ? 4 : 3, blocked: false,
    title: `${pub} is the official version${common.publishedAt ? `, signed off on ${PC().fmtDay(common.publishedAt)}` : ''}.`,
    why: live
      ? `Anyone can view, print or download it.${sheetLine('It covers')}`
      : 'It is not listed on the public site, so nobody outside your organisation can see it.',
    action: live
      ? { label: 'View public page ↗', kind: 'ghost', href: detail.publicUrl }
      : { label: 'Publish the page ↓', kind: 'primary', fn: () => scrollToPanel('publicPanel') },
  };
}

function buildStatusStrip() {
  const box = $('statusStrip');
  const s = stripState();
  if (!box) return;
  if (!s) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  // Dates only for steps this version has actually reached — the map's PREVIOUS
  // cycle also has a submitted-on and a published-on, and showing those against
  // steps ahead of the current one says the opposite of the truth.
  const when = [
    s.offeredAt ? PC().fmtDay(s.offeredAt) : '',
    s.draftAt ? `${detail.currentVersion} · ${PC().fmtDay(s.draftAt)}` : '',
    s.sentBack ? `sent back ${PC().fmtDay(s.sentBack.reviewed_at)}` : (s.sentAt ? PC().fmtDay(s.sentAt) : ''),
    s.publishedAt ? `${detail.publishedVersion} · ${PC().fmtDay(s.publishedAt)}` : '',
    detail.publicListed && detail.publicUrl ? 'listed' : (detail.publishedVersion ? 'not listed' : ''),
  ];
  const holder = ['', '', 'BusMaps.uk', '', 'live'];

  const rail = STRIP_STEPS.map((label, i) => {
    const cls = ['node'];
    if (i === s.at) cls.push(s.blocked ? 'blocked' : 'here');
    else if (i < s.at) cls.push(i === 0 && !s.fromRefresh ? 'skip' : 'done');
    // Step 0 didn't happen for a version the customer built by hand — say so
    // rather than implying an update we never offered.
    const label0 = i === 0 && !s.fromRefresh && i !== s.at ? 'No update involved' : label;
    const tick = cls.includes('done') ? '✓' : '';
    // An admin still holds the action (loadOwnedMap allows role:'admin' on any
    // customer's map), so "their move" alone would disown a button that works —
    // say who can act, not just who owns it, so the pill and the button agree.
    const whoText = i !== s.at ? '' : (s.blocked ? holder[2] : (s.mine ? 'your move' : (isAdmin() ? 'their move · you can act as admin' : 'their move')));
    const whoPill = i === s.at && i < 3 ? `<div class="who">${esc(whoText)}</div>`
      : (i === s.at && i === 4 ? '<div class="who">live</div>' : '');
    return `<div class="${cls.join(' ')}">
      <div class="bar"></div><div class="dot">${tick}</div>
      <div class="lbl">${esc(label0)}</div>
      ${when[i] && (i <= s.at || (i === 2 && s.sentBack)) ? `<div class="when">${esc(when[i])}</div>` : ''}
      ${whoPill}
    </div>`;
  }).join('');

  const act = s.action
    ? (s.action.href
      ? `<a class="btn btn-ghost btn-sm" id="stripAction" href="${esc(s.action.href)}" target="_blank" rel="noopener">${esc(s.action.label)}</a>`
      : `<button class="btn btn-${s.action.kind === 'ghost' ? 'ghost' : 'primary'} btn-sm" id="stripAction" type="button">${esc(s.action.label)}</button>`)
    : '';

  box.innerHTML = `<div class="rail">${rail}</div>
    <div class="strip-act">
      <p><strong>${esc(s.title)}</strong><span class="why">${esc(s.why)}</span></p>
      ${act}
    </div>`;
  const btn = $('stripAction');
  if (btn && s.action && s.action.fn) btn.addEventListener('click', () => s.action.fn(btn));
}

function buildUpdatePanel() {
  const panel = $('updatePanel');
  const pu = detail.proposedUpdate;
  if (!pu) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.hidden = false;
  // One name for one thing: this was "a monthly update" here, a "refresh" on the
  // admin side and a "proposed update" in the API (findings D). What the customer
  // is offered is an *update*, whatever the pipeline calls the payload.
  panel.innerHTML = `<div class="update-inner">
      <div class="update-main">
        <div class="update-title">🔄 An update is ready for this map</div>
        <p class="update-src">${esc(pu.sourceNote || 'A refreshed timetable is available for this map.')}</p>
        ${renderDataSummary(pu.summary)}
        <p class="hint-line">Accepting creates a new draft version with your colours and landmark choices re-applied. You then send it to us for review as usual — nothing goes public until an approver publishes it.</p>
      </div>
      <div class="update-actions">
        <button class="btn btn-ghost btn-sm" id="cmpBtn" type="button">Preview changes</button>
        <button class="btn btn-primary btn-sm" id="acceptBtn" type="button">Accept update</button>
        <button class="link-btn" id="declineBtn" type="button">Decline</button>
      </div>
    </div>`;
  $('cmpBtn').addEventListener('click', openCompare);
  $('acceptBtn').addEventListener('click', acceptUpdate);
  $('declineBtn').addEventListener('click', declineUpdate);
}

// old-vs-new comparison dialog
let cmpData = null, cmpBase = null;
function buildCompareTabs(bases) {
  $('compareTabs').innerHTML = bases.map((b) => `<button class="tab ${b === cmpBase ? 'active' : ''}" data-map="${esc(b)}" role="tab" aria-selected="${b === cmpBase}" title="${esc(hintForBase(b) || labelForBase(b))}">${esc(labelForBase(b))}</button>`).join('');
  $('compareTabs').querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { cmpBase = t.dataset.map; showCompare(); }));
}
function showCompare() {
  $('compareBefore').innerHTML = (cmpData.before && cmpData.before[cmpBase]) || '<div class="placeholder">—</div>';
  $('compareAfter').innerHTML = (cmpData.after && cmpData.after[cmpBase]) || '<div class="placeholder">—</div>';
  $('compareTabs').querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.map === cmpBase));
}
async function openCompare() {
  const btn = $('cmpBtn'); btn.disabled = true; btn.textContent = 'Rendering…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/proposed/${detail.proposedUpdate.id}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok || !b.ok) { notice('err', (b && b.error) || 'Could not render the comparison.'); return; }
    cmpData = b;
    const bases = Object.keys(b.after || {}).length ? Object.keys(b.after) : Object.keys(b.before || {});
    cmpBase = bases[0] || null;
    $('compareBeforeVer').textContent = detail.currentVersion ? '(' + detail.currentVersion + ')' : '';
    // The sheets below are at about half printed size, so a reworded description
    // or a dropped stop cannot be read off them (findings B1). Say in words what
    // the images cannot show — the same account the accept step will record.
    $('compareChanges').innerHTML = window.PortalChanges
      ? window.PortalChanges.dataChangeHtml(
        [{ version: null, createdAt: detail.proposedUpdate.createdAt, sourceNote: detail.proposedUpdate.sourceNote || '', summary: b.summary || detail.proposedUpdate.summary || {} }],
        { detail: true, heading: 'What this update changes' },
      ) : '';
    $('compareFoot').innerHTML = (b.dropped && b.dropped.length)
      ? `<span class="warn-inline">Note: ${b.dropped.length} of your customisation${b.dropped.length > 1 ? 's' : ''} no longer appl${b.dropped.length > 1 ? 'y' : 'ies'} after this update and will be dropped.</span>`
      : '';
    buildCompareTabs(bases); showCompare();
    $('compareDialog').showModal();
  } catch { notice('err', 'Network error rendering the comparison.'); }
  finally { btn.disabled = false; btn.textContent = 'Preview changes'; }
}
$('compareClose').addEventListener('click', () => $('compareDialog').close());
$('compareDialog').addEventListener('click', (e) => { if (e.target === $('compareDialog')) $('compareDialog').close(); });

async function acceptUpdate() {
  if (!confirm('Accept this update? It becomes a new draft version with your colours and landmark choices re-applied. Nothing is public yet — you then send it to us for review.')) return;
  const btn = $('acceptBtn'); btn.disabled = true; btn.textContent = 'Applying…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/proposed/${detail.proposedUpdate.id}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) {
      // "Review it below" collided with the approver's Review step (H3), and "below"
      // was past the whole editor (C1). The strip at the top now carries both.
      let msg = `Update accepted — new draft version ${b.version} is ready. Check the sheets over, then use “Send for review” at the top of the page. Nothing is public until an approver publishes it.`;
      if (b.dropped && b.dropped.length) msg += ` (${b.dropped.length} customisation${b.dropped.length > 1 ? 's' : ''} no longer applied and ${b.dropped.length > 1 ? 'were' : 'was'} dropped.)`;
      flash('ok', msg); location.reload();
    } else { notice('err', (b && b.error) || 'Could not accept the update.'); btn.disabled = false; btn.textContent = 'Accept update'; }
  } catch { notice('err', 'Network error accepting the update.'); btn.disabled = false; btn.textContent = 'Accept update'; }
}

async function declineUpdate() {
  if (!confirm('Decline this update? Your map keeps its current data. We can offer a fresh update next month.')) return;
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/proposed/${detail.proposedUpdate.id}/decline`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) { flash('warn', 'Update declined — your map is unchanged.'); location.reload(); }
    else notice('err', (b && b.error) || 'Could not decline the update.');
  } catch { notice('err', 'Network error declining the update.'); }
}

// ---- load saved-version SVGs -------------------------------------------------
async function loadSavedSvg() {
  if (!detail.currentVersion) return;
  for (const o of enabledOutputs()) {
    try { const r = await fetch(`/api/maps/${MAP_ID}/versions/${detail.currentVersion}/${o.base}.svg`); if (r.ok) savedSvg[o.base] = await r.text(); }
    catch { /* leave missing */ }
  }
}

// ---- save --------------------------------------------------------------------
$('saveBtn').addEventListener('click', async () => {
  const btn = $('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides: overridesFromStaged(staged), note: $('saveNote').value }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      detail.currentVersion = body.version; detail.downloads = body.downloads || [];
      detail.overrides = overridesFromStaged(staged); savedSig = sig(staged);
      $('mapCrumb').textContent = [detail.subject, 'current ' + body.version].filter(Boolean).join(' · ');
      if (previewSvg) for (const k of Object.keys(previewSvg)) savedSvg[k] = previewSvg[k];
      previewSvg = null; $('saveNote').value = '';
      buildDownloads(); showStage(); refreshState(); setPvState('clean', 'Showing saved version');
      reloadPublish(); // head advanced → refresh the publish panel (now ahead of the published version)
      notice('ok', `Saved version ${body.version}. Print-ready files are ready to download below.`);
    } else notice('err', (body && body.error) || 'Save failed.', true);
  } catch { notice('err', 'Network error while saving.', true); }
  finally { btn.textContent = 'Save new version'; btn.disabled = !isDirty(); }
});

// ---- reset / preview / logout ------------------------------------------------
$('resetBtn').addEventListener('click', () => { staged = { colors: {}, hide: new Set(), hiddenOps: new Set() }; buildRoutes(); buildOperators(); buildPois(); onEdit(); });
$('previewBtn').addEventListener('click', () => { clearTimeout(debounce); runPreview(); });
$('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/login.html'; });
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---- not-yet-built maps (requested/approved/building) ------------------------
function showPending() {
  const phrase = {
    requested: 'awaiting review',
    approved: 'approved and queued for the operator to build',
    building: 'being prepared by the operator',
  }[detail.status] || detail.status;
  $('stateDot').className = 'dot';
  $('stateText').textContent = 'Not built yet';
  document.querySelector('.editor').innerHTML =
    `<div class="panel" style="grid-column:1/-1"><div class="body">
      <p>This ${detail.kind === 'place' ? 'place' : 'area'} map is <strong>${esc(phrase)}</strong>.</p>
      <p class="hint-line">Once the base map has been built you'll be able to recolour routes, show or hide points of interest, and download print-ready sheets right here. We'll let you know by email.</p>
      <a class="btn btn-ghost btn-sm" href="/app">← Back to my maps</a>
    </div></div>`;
}

// ---- init --------------------------------------------------------------------
(async () => {
  // gate
  let me;
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) { location.href = '/app/login.html'; return; }
    me = (await r.json()).user;
    $('whoami').textContent = me.customer ? `${me.email} · ${me.customer.name}` : `${me.email} · admin`;
    $('logoutBtn').style.display = '';
    if (me.role === 'admin') $('adminLink').style.display = '';
    ME = me;
    // Public details belong to a customer organisation, not a platform account.
    if (!me.customer) document.querySelectorAll('a[href="/app/branding"]').forEach((a) => { a.style.display = 'none'; });
  } catch { $('stagePlaceholder').textContent = 'Could not reach the server.'; return; }

  try {
    const res = await fetch(`/api/maps/${MAP_ID}`);
    if (res.status === 403) { $('stagePlaceholder').textContent = 'You do not have access to this map.'; return; }
    const body = await res.json();
    if (!res.ok || !body.ok) { $('stagePlaceholder').textContent = (body && body.error) || 'Could not load this map.'; return; }
    detail = body.map;
    document.title = `Edit ${detail.name} — BusMaps.uk`;
    $('mapName').textContent = detail.name;
    $('mapTag').innerHTML = `<span class="tag ${detail.kind === 'place' ? 'place' : 'area'}">${detail.kind === 'place' ? 'Place' : 'Area'}</span>`;
    $('mapCrumb').textContent = [detail.subject, detail.currentVersion ? 'current ' + detail.currentVersion : ''].filter(Boolean).join(' · ');

    // A requested/approved/building map has no rendered version yet — show a
    // friendly "being prepared" state instead of empty editing controls.
    if (!detail.currentVersion) { showPending(); return; }

    staged = stagedFromOverrides(detail.overrides || {});
    savedSig = sig(staged);
    // The landmark chooser (OA-212) is a page of its own: it needs the town's
    // streets under the list, and the three-way answer does not fit a tick box.
    for (const el of [$('landmarksLink'), $('poiPanelLink')]) {
      if (!el) continue;
      el.href = `/app/maps/${MAP_ID}/landmarks`;
      el.style.display = '';
    }
    buildOutputs(); buildRoutes(); buildOperators(); buildPois(); buildDownloads(); buildVersionList();
    buildPublish(); buildPublic(); buildBanner(); buildUpdatePanel(); buildStatusStrip(); applyLock();
    buildExpertLinks();

    await loadSavedSvg();
    // An output switched on since the last save has no file in the saved version.
    // Render it now: "Save to render" as the first thing a customer sees reads as
    // a fault, and the sheet costs nothing to preview from the saved settings.
    const missing = enabledOutputs().some((o) => !savedSvg[o.base]);
    renderPending = missing;
    buildTabs();
    setPvState(missing ? 'busy' : 'clean', missing ? 'Rendering…' : 'Showing saved version');
    if (missing) runPreview();

    // Surface a one-shot message left by a preceding accept/decline reload.
    try {
      const f = JSON.parse(sessionStorage.getItem('cbm_flash') || 'null');
      if (f) { sessionStorage.removeItem('cbm_flash'); notice(f.kind, f.text, true); }
    } catch { /* ignore */ }
  } catch { $('stagePlaceholder').textContent = 'Could not load this map. Is the server running?'; }
})();
