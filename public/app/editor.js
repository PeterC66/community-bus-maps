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
let staged = { colors: {}, hide: new Set() };
let savedSig = '';
let activeMap = null;             // artefact base name of the shown output
const savedSvg = {};             // saved-version SVGs by base
let previewSvg = null;           // last preview SVGs by base (null → show saved)

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
function sig(s) {
  const c = Object.keys(s.colors).sort().map((k) => `${k}=${(s.colors[k] || '').toLowerCase()}`).join(',');
  return `C:${c}|H:${[...s.hide].sort().join(',')}`;
}
const isDirty = () => sig(staged) !== savedSig;

const enabledOutputs = () => detail.outputs.filter((o) => o.available && o.enabled);
const labelForBase = (base) => (detail.outputs.find((o) => o.base === base) || {}).label || base;
const isLocked = () => detail && detail.editable === false; // frozen while awaiting sign-off
const DL_LABELS = {
  'internal.svg': 'Within · SVG', 'internal.jpg': 'Within · JPG (print)',
  'external.svg': 'To towns · SVG', 'external.jpg': 'To towns · JPG (print)',
  'internal-schematic.svg': 'Schematic · SVG', 'internal-schematic.jpg': 'Schematic · JPG (print)',
  'internal-diagram.svg': 'Diagram · SVG', 'internal-diagram.jpg': 'Diagram · JPG (print)',
};

// ---- state chips -------------------------------------------------------------
function refreshState() {
  const locked = isLocked();
  const dirty = isDirty();
  $('stateDot').className = 'dot ' + (locked ? '' : (dirty ? 'dirty' : 'clean'));
  $('stateText').textContent = locked ? 'Locked for review' : (dirty ? 'Unsaved changes' : 'Saved');
  $('saveBtn').disabled = locked || !dirty;
  $('resetBtn').disabled = locked || (staged.hide.size === 0 && Object.keys(staged.colors).length === 0);
}

// Disable the editing controls while a version awaits publication sign-off.
function applyLock() {
  const locked = isLocked();
  document.querySelectorAll('#routes input, #routes button, #pois input, #outputs input, #resetBtn, #saveNote')
    .forEach((el) => { el.disabled = locked; });
  refreshState();
}
function setPvState(kind, text) { $('pvDot').className = 'dot ' + kind; $('pvText').textContent = text; }

// ---- controls: outputs -------------------------------------------------------
function buildOutputs() {
  const box = $('outputs');
  box.innerHTML = detail.outputs.map((o) => `
    <div class="poi-item ${o.enabled ? '' : 'off'}" data-key="${esc(o.key)}">
      <input type="checkbox" id="out_${esc(o.key)}" ${o.enabled ? 'checked' : ''} ${o.available ? '' : 'disabled'}>
      <label for="out_${esc(o.key)}">${esc(o.label)}${o.available ? (o.expert ? ' <span class="soon">— expert style</span>' : '') : ' <span class="soon">— not set up for this map</span>'}</label>
    </div>`).join('');
  $('outputCount').textContent = enabledOutputs().length + ' on';
  box.querySelectorAll('input[type=checkbox]').forEach((inp) => inp.addEventListener('change', onOutputsChange));
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
      buildOutputs();
      buildTabs();
      notice('warn', 'Outputs updated — Save to render the enabled sheets.');
      runPreview();
    } else {
      notice('err', (body && body.error) || 'Could not update outputs.');
      buildOutputs(); // revert checkboxes to server truth
    }
  } catch { notice('err', 'Network error updating outputs.'); }
}

// ---- controls: routes --------------------------------------------------------
function buildRoutes() {
  const box = $('routes');
  box.innerHTML = detail.routes.map((r) => {
    const sub = r.desc ? esc(Array.isArray(r.desc) ? r.desc.join(' · ') : r.desc) : '';
    return `<div class="route-row" data-route="${esc(r.id)}">
      <input class="route-swatch" type="color" value="${esc((staged.colors[r.id] || r.defaultColor).toLowerCase())}" data-route="${esc(r.id)}" aria-label="Colour for route ${esc(r.id)}">
      <span class="route-badge" style="background:${esc(staged.colors[r.id] || r.defaultColor)};color:${esc(r.textOn)}">${esc(r.id)}</span>
      <span class="route-desc"><span class="r-title">${sub || ('Route ' + esc(r.id))}</span></span>
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
  row.querySelector('.route-badge').style.background = staged.colors[r] || def.defaultColor;
  row.querySelector('.r-reset').disabled = !staged.colors[r];
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
  $('tabs').innerHTML = outs.map((o) => `<button class="tab ${o.base === activeMap ? 'active' : ''}" data-map="${esc(o.base)}" role="tab">${esc(o.label)}</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    $('tabs').querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); activeMap = t.dataset.map; showStage();
  }));
  showStage();
}

// ---- preview (single-flight, debounced) --------------------------------------
let debounce = null, inFlight = false, queued = false;
function onEdit() { refreshState(); clearTimeout(debounce); debounce = setTimeout(runPreview, 350); }
async function runPreview() {
  if (inFlight) { queued = true; return; }
  inFlight = true; queued = false;
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
  else stage.insertAdjacentHTML('afterbegin', `<div class="placeholder">${activeMap ? 'Save to render “' + esc(labelForBase(activeMap)) + '”.' : 'No outputs enabled.'}</div>`);
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
function dlRow(list) {
  return `<div class="dl-row">${list.map((d) => `<a class="dl" href="${d.url}?download" download>⬇ ${DL_LABELS[d.file] || d.file}</a>`).join('')}</div>`;
}
function buildDownloads() {
  const box = $('downloads');
  if (!detail.currentVersion || !detail.downloads.length) { box.innerHTML = ''; return; }
  const published = detail.publishedVersion && detail.publishedVersion === detail.currentVersion;
  const tag = published ? ' <span class="status-pill pub">published</span>' : ' <span class="status-pill">draft</span>';
  box.innerHTML = `<h3>Latest version ${esc(detail.currentVersion)}${tag}</h3>${dlRow(detail.downloads)}`;
}

// ---- publish gate (P4) -------------------------------------------------------
function renderChangeSummary(sum, pubKey) {
  if (!sum) return '';
  const base = sum.base === 'published' ? `the published version (${esc(pubKey)})` : 'the original map';
  if (sum.unchanged) return `<p class="hint-line">No differences from ${base} yet — make an edit and save first.</p>`;
  const parts = [];
  if (sum.routes.length) parts.push(`<li><strong>${sum.routes.length}</strong> route colour${sum.routes.length === 1 ? '' : 's'} changed <span class="muted">(${sum.routes.map((r) => esc(r.id)).join(', ')})</span></li>`);
  if (sum.poisHidden.length) parts.push(`<li><strong>${sum.poisHidden.length}</strong> landmark${sum.poisHidden.length === 1 ? '' : 's'} hidden</li>`);
  if (sum.poisShown.length) parts.push(`<li><strong>${sum.poisShown.length}</strong> landmark${sum.poisShown.length === 1 ? '' : 's'} shown</li>`);
  return `<div class="change-box"><div class="change-title">What publishing will change vs ${base}</div><ul class="change-list">${parts.join('')}</ul></div>`;
}

function buildPublishedDownloads() {
  const box = $('publishedDownloads');
  const pub = detail.publishedVersion;
  // Only shown when the published (official) version differs from the working head.
  if (!pub || pub === detail.currentVersion || !detail.publishedDownloads || !detail.publishedDownloads.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h3>Published files — official version ${esc(pub)}</h3>${dlRow(detail.publishedDownloads)}`;
}

function buildPublish() {
  const panel = $('publishPanel');
  if (!detail.currentVersion) { panel.hidden = true; return; }
  panel.hidden = false;
  const head = detail.currentVersion, pub = detail.publishedVersion, pending = detail.pendingRequest;
  const stateEl = $('publishState'), body = $('publishBody');

  if (pending) stateEl.innerHTML = '<span class="status-pill req">Awaiting sign-off</span>';
  else if (pub && pub === head) stateEl.innerHTML = `<span class="status-pill pub">Published ${esc(pub)}</span>`;
  else if (pub) stateEl.innerHTML = `<span class="status-pill pub">Published ${esc(pub)}</span> <span class="muted">· draft ${esc(head)}</span>`;
  else stateEl.innerHTML = '<span class="status-pill">Not yet published</span>';

  if (pending) {
    body.innerHTML = `<div class="publish-note-box">
        <p><strong>Version ${esc(pending.versionKey || head)}</strong> has been submitted for an approver's sign-off.${pending.note ? ' <span class="muted">Your note: “' + esc(pending.note) + '”.</span>' : ''}</p>
        <p class="hint-line">Editing is paused while we review. Withdraw the request if you need to make more changes.</p>
        <button class="btn btn-ghost btn-sm" id="withdrawBtn" type="button">Withdraw request</button>
      </div>`;
    $('withdrawBtn').addEventListener('click', withdrawPublish);
  } else if (pub === head) {
    body.innerHTML = '<p class="published-ok">✓ Your latest version is the published one. Make an edit and save to prepare a new version to publish.</p>';
  } else {
    body.innerHTML = `${renderChangeSummary(detail.changeSummary, pub)}
      <label class="hint-line" for="publishNote" style="display:block;margin-top:10px">Note for the reviewer <span class="hint">— optional</span></label>
      <input class="field" id="publishNote" type="text" maxlength="200" placeholder="e.g. New route 9 colour for the summer timetable">
      <button class="btn btn-primary btn-sm" id="submitPublishBtn" type="button" style="margin-top:8px">Submit ${esc(head)} for publication</button>`;
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
// touching the signed-off version. `publicUrl` is only set by the server when the
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
      : '<p class="hint-line">Nothing is public yet — a version has to be signed off first.</p>');

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
    });
    applyLock(); buildPublish(); buildPublic(); buildDownloads();
  } catch { /* leave as-is */ }
}

async function submitPublish() {
  const note = ($('publishNote') || {}).value || '';
  const btn = $('submitPublishBtn'); btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/publish-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) { notice('ok', 'Submitted for publication — an approver will review it and sign it off.'); await reloadPublish(); }
    else { notice('err', (b && b.error) || 'Could not submit for publication.'); btn.disabled = false; btn.textContent = `Submit ${esc(detail.currentVersion)} for publication`; }
  } catch { notice('err', 'Network error while submitting.'); btn.disabled = false; }
}

async function withdrawPublish() {
  if (!confirm('Withdraw the publication request? You will be able to edit the map again.')) return;
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/publish-request/withdraw`, { method: 'POST' });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) { notice('warn', 'Request withdrawn — you can edit again.'); await reloadPublish(); }
    else notice('err', (b && b.error) || 'Could not withdraw the request.');
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

function buildUpdatePanel() {
  const panel = $('updatePanel');
  const pu = detail.proposedUpdate;
  if (!pu) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.hidden = false;
  panel.innerHTML = `<div class="update-inner">
      <div class="update-main">
        <div class="update-title">🔄 A monthly update is ready for this map</div>
        <p class="update-src">${esc(pu.sourceNote || 'A refreshed timetable is available for this map.')}</p>
        ${renderDataSummary(pu.summary)}
        <p class="hint-line">Accepting creates a new draft version with your colours and landmark choices re-applied. You then submit it for publication as usual — nothing goes public until it's signed off.</p>
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
  $('compareTabs').innerHTML = bases.map((b) => `<button class="tab ${b === cmpBase ? 'active' : ''}" data-map="${esc(b)}" role="tab">${esc(labelForBase(b))}</button>`).join('');
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
  if (!confirm('Accept this update? It becomes a new draft version with your colours and landmark choices re-applied. You can then submit it for publication.')) return;
  const btn = $('acceptBtn'); btn.disabled = true; btn.textContent = 'Applying…';
  try {
    const res = await fetch(`/api/maps/${MAP_ID}/proposed/${detail.proposedUpdate.id}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) {
      let msg = `Update accepted — new draft version ${b.version} is ready. Review it below, then submit it for publication.`;
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
$('resetBtn').addEventListener('click', () => { staged = { colors: {}, hide: new Set() }; buildRoutes(); buildPois(); onEdit(); });
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
    document.title = `Edit ${detail.name} — Community Bus Maps`;
    $('mapName').textContent = detail.name;
    $('mapTag').innerHTML = `<span class="tag ${detail.kind === 'place' ? 'place' : 'area'}">${detail.kind === 'place' ? 'Place' : 'Area'}</span>`;
    $('mapCrumb').textContent = [detail.subject, detail.currentVersion ? 'current ' + detail.currentVersion : ''].filter(Boolean).join(' · ');

    // A requested/approved/building map has no rendered version yet — show a
    // friendly "being prepared" state instead of empty editing controls.
    if (!detail.currentVersion) { showPending(); return; }

    staged = stagedFromOverrides(detail.overrides || {});
    savedSig = sig(staged);
    buildOutputs(); buildRoutes(); buildPois(); buildDownloads(); buildPublish(); buildPublic(); buildUpdatePanel(); applyLock();
    buildExpertLinks();

    await loadSavedSvg();
    buildTabs();
    setPvState('clean', 'Showing saved version');

    // Surface a one-shot message left by a preceding accept/decline reload.
    try {
      const f = JSON.parse(sessionStorage.getItem('cbm_flash') || 'null');
      if (f) { sessionStorage.removeItem('cbm_flash'); notice(f.kind, f.text, true); }
    } catch { /* ignore */ }
  } catch { $('stagePlaceholder').textContent = 'Could not load this map. Is the server running?'; }
})();
