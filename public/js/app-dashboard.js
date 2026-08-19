// Extracted from app/index.html on 2026-08-19 so the Caddyfile's CSP can say
// `script-src 'self'` with no 'unsafe-inline' (technical-audit_2026-08-19 S1).
// An inline-script allowance is site-wide, so it would also have applied to
// /m/<slug>, which injects generated SVG straight into the DOM (S9) - the CSP
// is the control that makes that injection safe, and 'unsafe-inline' would
// have handed the exemption straight back. Loaded with `defer`: it runs after
// parsing, so every element it reaches for exists, and any non-deferred script
// before it (editor-eye-view.js) has already run.

const tag = (k) => `<span class="tag ${k === 'place' ? 'place' : 'area'}">${k === 'place' ? 'Place' : 'Area'}</span>`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

// Non-editable lifecycle states → a pill (editable maps have a currentVersion and link to the editor).
const STATUS = {
  requested: { label: 'Requested', cls: 'req' },
  approved:  { label: 'Approved — being prepared', cls: 'prep' },
  building:  { label: 'Being prepared', cls: 'prep' },
  published: { label: 'Published', cls: 'pub' },
};

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/app/login.html';
});

let me = null;

function renderQuota() {
  if (!me || !me.customer) return;
  const c = me.customer;
  const bar = $('quotaBar');
  bar.style.display = '';
  bar.innerHTML =
    `<span class="quota-pill"><strong>${c.usedAreas}</strong> / ${c.quotaAreas} area map${c.quotaAreas === 1 ? '' : 's'}</span>` +
    `<span class="quota-pill"><strong>${c.usedPlaces}</strong> / ${c.quotaPlaces} place map${c.quotaPlaces === 1 ? '' : 's'}</span>` +
    `<span class="quota-hint">Need more? <a href="/contact.html">Contact us.</a></span>`;
  const areaFull = c.usedAreas >= c.quotaAreas, placeFull = c.usedPlaces >= c.quotaPlaces;
  $('requestQuota').textContent = areaFull && placeFull
    ? 'You have used your full quota. You can still request, but we may ask you to raise your plan.'
    : `You can request ${Math.max(0, c.quotaAreas - c.usedAreas)} more area and ${Math.max(0, c.quotaPlaces - c.usedPlaces)} more place map${(c.quotaPlaces - c.usedPlaces) === 1 ? '' : 's'}.`;
}

// A publish-state pill for a built map (draft / awaiting review / published).
function publishPill(m) {
  if (m.pendingReview) return '<span class="status-pill req">Awaiting review</span>';
  if (m.publishedVersion && m.publishedVersion === m.currentVersion) return `<span class="status-pill pub">Published ${escapeHtml(m.publishedVersion)}</span>`;
  if (m.publishedVersion) return `<span class="status-pill pub">Published ${escapeHtml(m.publishedVersion)}</span> <span class="status-pill">draft ahead</span>`;
  return '<span class="status-pill">Draft</span>';
}
// An update is waiting for the customer to accept/decline (P5).
const updatePill = () => '<span class="status-pill upd">Update ready</span>';
// P6: a published, listed map has a public page anyone can view.
const publicPill = (m) => (m.publicUrl ? '<span class="status-pill pub">Public page</span>' : '');
function cardFor(m, isAdmin) {
  const owner = isAdmin && m.customer ? `<div class="meta owner">${escapeHtml(m.customer.name)}</div>` : '';
  const sub = `<div class="meta">${escapeHtml(m.subject || '')}${m.currentVersion ? ' · ' + escapeHtml(m.currentVersion) : ''}</div>`;
  if (m.currentVersion) {
    return `<a class="card map-card" href="/app/maps/${m.id}"><h3>${escapeHtml(m.name)} ${tag(m.kind)}</h3>${sub}<div class="card-pills">${publishPill(m)}${m.pendingUpdate ? updatePill() : ''}${publicPill(m)}</div>${owner}</a>`;
  }
  const st = STATUS[m.status] || { label: m.status, cls: 'req' };
  return `<div class="card map-card is-pending"><h3>${escapeHtml(m.name)} ${tag(m.kind)}</h3>
    <div class="meta">${escapeHtml(m.subject || '')}</div>
    <span class="status-pill ${st.cls}">${escapeHtml(st.label)}</span>${owner}</div>`;
}

async function loadMaps(isAdmin) {
  const box = $('maps');
  try {
    const body = await (await fetch('/api/maps')).json();
    const maps = ((body && body.maps) || []).filter((m) => m.status !== 'archived');
    if (!maps.length) {
      box.innerHTML = `<div class="empty">No maps yet. ${isAdmin ? 'Approved requests will appear here once built.' : 'Request one above, or once a map is approved for your organisation it will appear here.'}</div>`;
      return;
    }
    box.innerHTML = maps.map((m) => cardFor(m, isAdmin)).join('');
  } catch {
    box.innerHTML = '<div class="empty">Could not load maps.</div>';
  }
}

// ---- request dialog ----
const dlg = $('requestDialog');
$('requestBtn').addEventListener('click', () => { renderQuota(); $('requestMsg').className = 'notice'; dlg.showModal(); });
$('requestCancel').addEventListener('click', () => dlg.close());
$('requestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('requestSubmit'); const msg = $('requestMsg');
  const data = {}; new FormData(e.target).forEach((v, k) => { data[k] = v; });
  btn.disabled = true; btn.textContent = 'Sending…'; msg.className = 'notice';
  try {
    const res = await fetch('/api/maps/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      if (body.usage) { me.customer.usedAreas = body.usage.usedAreas; me.customer.usedPlaces = body.usage.usedPlaces; }
      dlg.close(); e.target.reset();
      renderQuota(); await loadMaps(me.role === 'admin');
    } else {
      msg.className = 'notice err show'; msg.textContent = (body && body.error) || 'Could not send the request.';
    }
  } catch { msg.className = 'notice err show'; msg.textContent = 'Network error — please try again.'; }
  finally { btn.disabled = false; btn.textContent = 'Send request'; }
});

(async () => {
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) { location.href = '/app/login.html'; return; }
    me = (await r.json()).user;
  } catch { $('maps').innerHTML = '<div class="empty">Could not reach the server.</div>'; return; }

  const isAdmin = me.role === 'admin';
  $('whoami').textContent = me.customer ? `${me.email} · ${me.customer.name}` : `${me.email} · ${me.role}`;
  $('logoutBtn').style.display = '';
  if (isAdmin || me.role === 'approver') $('reviewLink').style.display = '';
  if (isAdmin) {
    $('adminLink').style.display = '';
    $('dashTitle').textContent = 'All maps';
    $('dashIntro').textContent = 'Admin view — every customer’s maps. Open one to edit, or switch outputs. Layout/geometry edits remain expert-only.';
  } else if (me.role === 'approver') {
    $('dashTitle').textContent = 'Review & publish';
    $('dashIntro').innerHTML = 'You are a platform approver. Head to <a href="/app/review">Review</a> to review submitted map versions.';
  }
  if (me.customer) { $('requestBtn').style.display = ''; $('brandingLink').style.display = ''; renderQuota(); }
  if (window.EEV) window.EEV.apply(); // H9 — after role-based nav visibility is set

  await loadMaps(isAdmin);
})();
