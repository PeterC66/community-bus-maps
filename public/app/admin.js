// Admin console (P3): review applications, run the map-request lifecycle, and
// manage customers/quotas. Admin-only — the page redirects non-admins; the API
// independently enforces the admin role on every route.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
// CSS-grid "table" builder — see the .grid-table comment in app.css for why
// this replaced <table>: header and body rows share one grid-template-columns
// track list, so columns can't drift apart the way a <table>'s own column-sync
// did once a row held unbreakable content.
function gtOpen(colWidths, headers) {
  const style = `grid-template-columns:${colWidths.map((w) => w + '%').join(' ')}`;
  const head = headers.map((h) => `<div class="gt-cell" role="columnheader">${h}</div>`).join('');
  return `<div class="grid-table" role="table" style="${style}"><div class="gt-row gt-head" role="row">${head}</div>`;
}
const gtClose = '</div>';

// ---- sortable tables ----------------------------------------------------
// Click-to-sort for the grid tables above. Each column can carry a `key`
// (a dotted path into the row object); clicking its header toggles
// ascending/descending and redraws from the already-fetched rows, no
// extra API round trip. Columns without a `key` (actions, free text) just
// render as plain, unclickable headers.
function sortRows(rows, key, dir) {
  const get = (r) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), r);
  return [...rows].sort((a, b) => {
    const av = get(a), bv = get(b);
    const aNull = av == null || av === '', bNull = bv == null || bv === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv
      : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
    return cmp * dir;
  });
}
// Stable multi-key pre-sort, used to set a sensible default order (e.g.
// users grouped by customer, then role) before any column is clicked.
function sortRowsMulti(rows, keys) {
  let out = rows;
  for (const k of [...keys].reverse()) out = sortRows(out, k, 1);
  return out;
}
const sortState = {}; // { [stateKey]: { key, dir } } — remembers the active sort per table
// `box` is the element whose entire innerHTML becomes the table — pass a tab's
// own section element for a table that IS the tab, or a nested placeholder
// element for a table embedded alongside other content (e.g. the ops cards).
function renderSortable(stateKey, box, colWidths, columns, rows, rowFn, afterRender) {
  const st = sortState[stateKey] || (sortState[stateKey] = { key: null, dir: 1 });
  const sorted = st.key ? sortRows(rows, st.key, st.dir) : rows;
  const style = `grid-template-columns:${colWidths.map((w) => w + '%').join(' ')}`;
  const head = columns.map((c) => {
    if (!c.key) return `<div class="gt-cell" role="columnheader">${c.label}</div>`;
    const arrow = st.key === c.key ? `<span class="gt-sort-arrow">${st.dir === 1 ? '▲' : '▼'}</span>` : '';
    return `<div class="gt-cell gt-sortable" role="columnheader" tabindex="0" data-sort-key="${c.key}">${c.label}${arrow}</div>`;
  }).join('');
  box.innerHTML = `<div class="grid-table" role="table" style="${style}"><div class="gt-row gt-head" role="row">${head}</div>${sorted.map(rowFn).join('')}</div>`;
  box.querySelectorAll('.gt-sortable').forEach((h) => {
    const activate = () => {
      const key = h.dataset.sortKey;
      if (st.key === key) st.dir *= -1; else { st.key = key; st.dir = 1; }
      renderSortable(stateKey, box, colWidths, columns, rows, rowFn, afterRender);
    };
    h.addEventListener('click', activate);
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
  if (afterRender) afterRender(box);
  return box;
}
async function jget(url) { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function jsend(url, method, data) {
  const r = await fetch(url, { method, headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let banished = null;
function banner(kind, html) {
  const el = $('banner'); el.className = 'notice show ' + kind; el.innerHTML = html;
  clearTimeout(banished); if (kind !== 'ok-sticky') banished = setTimeout(() => { el.className = 'notice'; }, 8000);
  if (kind === 'ok-sticky') el.className = 'notice show ok';
}

// ---- tabs -------------------------------------------------------------------
const SECTIONS = ['todo', 'applications', 'requests', 'customers', 'users', 'sessions', 'messages', 'refreshes', 'audit', 'ops'];
const LOADERS = {};
function showTab(name) {
  $('tabs').querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  SECTIONS.forEach((s) => { $('sec-' + s).hidden = s !== name; });
  if (LOADERS[name]) LOADERS[name]();
}
$('tabs').querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---- summary badges ---------------------------------------------------------
async function loadSummary() {
  const { body } = await jget('/api/admin/summary');
  if (!body.ok) return;
  const s = body.summary;
  const set = (id, n, warn) => { const el = $(id); el.textContent = n || ''; el.classList.toggle('warn', !!warn && n > 0); };
  set('badge-applications', s.pendingApplications, true);
  // Both halves of the request lifecycle need an admin: decide it, then build it.
  set('badge-requests', (s.pendingMapRequests || 0) + (s.awaitingBuild || 0), true);
  set('badge-customers', s.customers, false);
  set('badge-messages', s.newMessages, false);
  set('badge-refreshes', s.pendingProposedUpdates, true);
}

// ---- to do ------------------------------------------------------------------
// The landing tab: every queue on this page, ranked by who is blocked, from
// /api/admin/worklist. The ranking lives server-side (src/worklist/index.js) so
// this view and the operator's bus-work skill cannot drift apart. Nothing is
// actionable from here by design — an approval gate is decided on its own tab,
// with its own evidence in front of you; this list only tells you where to go.
LOADERS.todo = async () => {
  const box = $('todo');
  const { body } = await jget('/api/admin/worklist');
  if (!body.ok) { box.innerHTML = '<div class="empty">Could not load the worklist.</div>'; return; }
  const { items, meta } = body.worklist;
  const badge = $('badge-todo');
  badge.textContent = meta.actionable || '';
  badge.classList.toggle('warn', meta.actionable > 0);
  if (!items.length) {
    box.innerHTML = '<div class="empty">Nothing is waiting. 🎉<div class="sub" style="margin-top:6px">Engine staleness and verification runs live on the operator\'s machine — <code>bus-work</code> shows those alongside this list.</div></div>';
    return;
  }
  let html = '';
  let band = null;
  for (const it of items) {
    if (it.band !== band) { band = it.band; html += `<h3 class="todo-band">${esc(band)}</h3>`; }
    // A card whose only action is "go look at a portal page" can be the whole
    // card's click target, same as the review queue. Cards with a shell command
    // (a Copy button to hit) stay plain divs so that click isn't shadowed.
    const singleUrl = it.do.length === 1 && it.do[0].kind === 'portal-ui' ? it.do[0].url : null;
    const tag = singleUrl ? 'a' : 'div';
    html += `<${tag} class="todo-item r${it.rank}${singleUrl ? ' todo-item-link' : ''}"${singleUrl ? ` href="${esc(singleUrl)}"` : ''}>
      <div class="todo-head">
        <span class="status-pill ${it.rank <= 3 ? 'rej' : it.rank <= 8 ? 'req' : 'prep'}">${esc(it.type)}</span>
        <strong>${esc(it.title)}</strong>
        <span class="grow"></span>
        ${it.ageDays == null ? '' : `<span class="muted">${it.ageDays}d</span>`}
      </div>
      <p class="sub wrap">${esc(it.why)}</p>
      ${it.detail ? `<pre class="todo-detail">${esc(it.detail)}</pre>` : ''}
      ${it.do.map((d) => {
        if (d.kind === 'shell') {
          return `<div class="todo-step"><code class="cmd">${esc(d.cmd)}</code>
            <button class="btn btn-ghost btn-xs" data-copy-cmd="${esc(d.cmd)}">Copy</button>
            ${d.note ? `<span class="sub">${esc(d.note)}</span>` : ''}</div>`;
        }
        if (d.kind === 'portal-ui') return `<div class="todo-step">→ ${esc(d.what)} ${singleUrl ? '<span class="muted">Open →</span>' : `<a class="btn btn-ghost btn-xs" href="${esc(d.url)}">Open</a>`}</div>`;
        return `<div class="todo-step">→ ${esc(d.what)}</div>`;
      }).join('')}
    </${tag}>`;
  }
  box.innerHTML = html + `<p class="hint-line" style="margin-top:14px">${meta.actionable} of ${meta.total} waiting on you. Runbook references: R1 build · R2 onboarding · R3 review · R4 refresh.</p>`;
  box.querySelectorAll('button[data-copy-cmd]').forEach((btn) => btn.addEventListener('click', () => {
    const done = (label) => { btn.textContent = label; setTimeout(() => { btn.textContent = 'Copy'; }, 2500); };
    // The clipboard write can be refused (window not focused, or served over
    // plain http from another machine — it needs a secure context). A Copy
    // button that silently does nothing is worse than no button, so fall back
    // to selecting the command so Ctrl+C still works.
    navigator.clipboard.writeText(btn.dataset.copyCmd).then(() => done('Copied')).catch(() => {
      const code = btn.parentElement.querySelector('code.cmd');
      if (code) { const r = document.createRange(); r.selectNodeContents(code); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      done('Selected — Ctrl+C');
    });
  }));
};

// ---- applications -----------------------------------------------------------
LOADERS.applications = async () => {
  const showReviewed = $('showReviewed').checked;
  const { body } = await jget('/api/admin/applications' + (showReviewed ? '' : '?status=pending'));
  const box = $('applications');
  const apps = (body && body.applications) || [];
  if (!apps.length) { box.innerHTML = `<div class="empty">${showReviewed ? 'No applications yet.' : 'No pending applications. 🎉'}</div>`; return; }
  const columns = [{ label: 'Organisation', key: 'org_name' }, { label: 'Contact', key: 'contact_name' }, { label: 'Wants' }, { label: 'Received', key: 'created_at' }, { label: 'Status', key: 'status' }, { label: '' }];
  renderSortable('applications', box, [20, 16, 28, 11, 10, 15], columns, apps, rowApp, (b) => {
    b.querySelectorAll('button[data-approve]').forEach((b2) => b2.addEventListener('click', () => openApprove(b2.dataset.approve, b2.dataset.name, b2.dataset.contact)));
    b.querySelectorAll('button[data-reject]').forEach((b2) => b2.addEventListener('click', () => rejectApp(b2.dataset.reject, b2.dataset.name)));
  });
};
function rowApp(a) {
  const pending = a.status === 'pending';
  const badge = pending ? '<span class="status-pill req">pending</span>'
    : a.status === 'approved' ? '<span class="status-pill pub">approved</span>'
    : '<span class="status-pill rej">rejected</span>';
  const actions = pending
    ? `<button class="btn btn-primary btn-xs" data-approve="${a.id}" data-name="${esc(a.org_name)}" data-contact="${esc(a.contact_name)}">Approve</button>
       <button class="btn btn-ghost btn-xs" data-reject="${a.id}" data-name="${esc(a.org_name)}">Reject</button>`
    : `<span class="muted">${a.reviewed_at ? fmtDate(a.reviewed_at) : ''}</span>`;
  return `<div class="gt-row" role="row">
    <div class="gt-cell" role="cell"><strong>${esc(a.org_name)}</strong><div class="sub">${esc(a.org_type)}${a.website ? ' · <a href="' + esc(a.website) + '" target="_blank" rel="noopener">site</a>' : ''}</div></div>
    <div class="gt-cell" role="cell">${esc(a.contact_name)}<div class="sub">${esc(a.email)}${a.phone ? ' · ' + esc(a.phone) : ''}</div></div>
    <div class="gt-cell wrap" role="cell">${esc(a.wants || '') || '<span class="muted">—</span>'}${a.message ? '<div class="sub">' + esc(a.message) + '</div>' : ''}</div>
    <div class="gt-cell" role="cell">${fmtDate(a.created_at)}</div>
    <div class="gt-cell" role="cell">${badge}</div>
    <div class="gt-cell actions" role="cell">${actions}</div>
  </div>`;
}

// approve dialog
const approveDlg = $('approveDialog');
function openApprove(id, name, contact) {
  $('approveForm').dataset.id = id;
  $('approveWho').innerHTML = `Approving <strong>${esc(name)}</strong>.`;
  $('editorName').value = contact || '';
  $('qAreas').value = 1; $('qPlaces').value = 3;
  $('approveMsg').className = 'notice';
  approveDlg.showModal();
}
$('approveCancel').addEventListener('click', () => approveDlg.close());
$('approveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('approveForm').dataset.id;
  const btn = $('approveSubmit'); btn.disabled = true; btn.textContent = 'Approving…';
  const data = { quotaAreas: Number($('qAreas').value), quotaPlaces: Number($('qPlaces').value), editorName: $('editorName').value };
  const { body } = await jsend(`/api/admin/applications/${id}/approve`, 'POST', data);
  btn.disabled = false; btn.textContent = 'Approve & invite';
  if (body.ok) {
    approveDlg.close();
    const link = body.inviteLink
      ? `<div class="invite">Invite link (dev — normally emailed): <code id="ilink">${esc(body.inviteLink)}</code> <button class="btn btn-ghost btn-xs" id="copyLink" type="button">Copy</button></div>`
      : ' The invite has been emailed.';
    banner('ok-sticky', `✓ Approved <strong>${esc(body.customer.name)}</strong> and invited ${esc(body.user.email)}.${link}`);
    const cp = $('copyLink'); if (cp) cp.addEventListener('click', () => navigator.clipboard.writeText(body.inviteLink).then(() => { cp.textContent = 'Copied'; }));
    LOADERS.applications(); loadSummary();
  } else {
    $('approveMsg').className = 'notice err show'; $('approveMsg').textContent = body.error || 'Approve failed.';
  }
});
async function rejectApp(id, name) {
  if (!confirm(`Reject the application from ${name}? They will not be set up as a customer.`)) return;
  const { body } = await jsend(`/api/admin/applications/${id}/reject`, 'POST');
  if (body.ok) { banner('warn', `Application from ${esc(name)} rejected.`); LOADERS.applications(); loadSummary(); }
  else banner('err', body.error || 'Reject failed.');
}
$('showReviewed').addEventListener('change', () => LOADERS.applications());

// ---- map requests -----------------------------------------------------------
LOADERS.requests = async () => {
  const { body } = await jget('/api/admin/map-requests');
  const box = $('requests');
  const reqs = (body && body.requests) || [];
  if (!reqs.length) box.innerHTML = '<div class="empty">No pending map requests.</div>';
  else {
    const columns = [{ label: 'Map', key: 'name' }, { label: 'Customer', key: 'customer.name' }, { label: 'Requested by', key: 'requestedBy' }, { label: 'Notes' }, { label: 'When', key: 'createdAt' }, { label: '' }];
    renderSortable('requests', box, [18, 16, 14, 26, 12, 14], columns, reqs, rowReq, (b) => {
      b.querySelectorAll('button[data-appr]').forEach((b2) => b2.addEventListener('click', () => mapAction(b2.dataset.appr, 'approve', b2.dataset.name)));
      b.querySelectorAll('button[data-rej]').forEach((b2) => b2.addEventListener('click', () => mapAction(b2.dataset.rej, 'reject', b2.dataset.name)));
    });
  }
  renderAwaitingBuild((body && body.awaitingBuild) || []);
};

// Approved requests the central pipeline still has to build. Each row carries the
// exact importer command that fulfils THAT request row in place.
function rowAwaitingBuild(m) {
  return `<div class="gt-row" role="row">
      <div class="gt-cell" role="cell"><strong>${esc(m.name)}</strong> <span class="tag ${m.kind === 'place' ? 'place' : 'area'}">${m.kind === 'place' ? 'Place' : 'Area'}</span>
        <div class="sub">#${m.id} · ${esc(m.slug)}${m.subject ? ' · ' + esc(m.subject) : ''}</div></div>
      <div class="gt-cell" role="cell">${esc(m.customer ? m.customer.name : '—')}<div class="sub">${esc(m.requestedBy || '')}</div></div>
      <div class="gt-cell" role="cell">${fmtDate(m.createdAt)}<div class="sub wrap">${esc(m.requestNote || '')}</div></div>
      <div class="gt-cell wrap" role="cell"><code class="cmd" data-cmd="${esc(m.importCommand)}">${esc(m.importCommand)}</code></div>
      <div class="gt-cell actions" role="cell">
        <button class="btn btn-ghost btn-xs" data-copy="${m.id}" data-cmd="${esc(m.importCommand)}">Copy</button>
        <button class="btn btn-ghost btn-xs" data-rej="${m.id}" data-name="${esc(m.name)}">Archive</button>
      </div></div>`;
}
function renderAwaitingBuild(rows) {
  const box = $('awaitingBuild');
  if (!rows.length) { box.innerHTML = '<div class="empty">Nothing waiting to be built.</div>'; return; }
  const columns = [{ label: 'Map', key: 'name' }, { label: 'Customer', key: 'customer.name' }, { label: 'Approved for', key: 'createdAt' }, { label: 'Build command' }, { label: '' }];
  renderSortable('awaitingBuild', box, [18, 16, 12, 40, 14], columns, rows, rowAwaitingBuild, (b) => {
    b.querySelectorAll('button[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.cmd).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); });
    }));
    b.querySelectorAll('button[data-rej]').forEach((btn) => btn.addEventListener('click', () => mapAction(btn.dataset.rej, 'reject', btn.dataset.name)));
  });
}
function rowReq(m) {
  const kind = `<span class="tag ${m.kind === 'place' ? 'place' : 'area'}">${m.kind === 'place' ? 'Place' : 'Area'}</span>`;
  return `<div class="gt-row" role="row">
    <div class="gt-cell" role="cell"><strong>${esc(m.name)}</strong> ${kind}<div class="sub">${esc(m.subject || '')}</div></div>
    <div class="gt-cell" role="cell">${esc(m.customer ? m.customer.name : '—')}</div>
    <div class="gt-cell" role="cell">${esc(m.requestedBy || '—')}</div>
    <div class="gt-cell wrap" role="cell">${esc(m.requestNote || '') || '<span class="muted">—</span>'}</div>
    <div class="gt-cell" role="cell">${fmtDate(m.createdAt)}</div>
    <div class="gt-cell actions" role="cell">
      <button class="btn btn-primary btn-xs" data-appr="${m.id}" data-name="${esc(m.name)}">Approve</button>
      <button class="btn btn-ghost btn-xs" data-rej="${m.id}" data-name="${esc(m.name)}">Reject</button>
    </div></div>`;
}
async function mapAction(id, action, name) {
  if (action === 'reject' && !confirm(`Reject the request for "${name}"? It will be archived and the quota slot freed.`)) return;
  const { body } = await jsend(`/api/admin/maps/${id}/${action}`, 'POST');
  if (body.ok) {
    banner(action === 'approve' ? 'ok' : 'warn', action === 'approve'
      ? `Approved "${esc(name)}" — it's now queued for the operator to build.`
      : `Request for "${esc(name)}" archived.`);
    LOADERS.requests(); loadSummary();
  } else banner('err', body.error || 'Action failed.');
}

// ---- customers --------------------------------------------------------------
LOADERS.customers = async () => {
  const { body } = await jget('/api/admin/customers');
  const box = $('customers');
  const custs = (body && body.customers) || [];
  if (!custs.length) { box.innerHTML = '<div class="empty">No customers yet.</div>'; return; }
  const columns = [{ label: 'Customer', key: 'name' }, { label: 'Users', key: 'users' }, { label: 'Area maps', key: 'usedAreas' }, { label: 'Place maps', key: 'usedPlaces' }, { label: 'Status', key: 'status' }, { label: 'Plan', key: 'plan' }, { label: 'Operator filter' }, { label: 'Watermark downloads' }, { label: '' }];
  renderSortable('customers', box, [17, 7, 11, 11, 9, 12, 12, 12, 9], columns, custs, rowCust, (b) => {
    b.querySelectorAll('button[data-save]').forEach((b2) => b2.addEventListener('click', () => saveCust(b2.dataset.save)));
  });
};
function rowCust(c) {
  const overA = c.usedAreas > c.quotaAreas ? ' over' : '', overP = c.usedPlaces > c.quotaPlaces ? ' over' : '';
  return `<div class="gt-row" role="row" data-cust="${c.id}">
    <div class="gt-cell" role="cell"><strong>${esc(c.name)}</strong><div class="sub">${esc(c.type)}${c.publicUrl ? ' · <a href="' + esc(c.publicUrl) + '" target="_blank" rel="noopener">public page</a>' : ''}</div></div>
    <div class="gt-cell" role="cell">${c.users}</div>
    <div class="gt-cell qcell${overA}" role="cell"><span class="used">${c.usedAreas}</span> / <input type="number" min="0" max="99" value="${c.quotaAreas}" data-q="areas" class="qnum"></div>
    <div class="gt-cell qcell${overP}" role="cell"><span class="used">${c.usedPlaces}</span> / <input type="number" min="0" max="99" value="${c.quotaPlaces}" data-q="places" class="qnum"></div>
    <div class="gt-cell" role="cell"><select data-q="status"><option value="active"${c.status === 'active' ? ' selected' : ''}>active</option><option value="suspended"${c.status === 'suspended' ? ' selected' : ''}>suspended</option></select></div>
    <div class="gt-cell" role="cell"><input type="text" value="${esc(c.plan)}" data-q="plan" class="planin" maxlength="40"></div>
    <div class="gt-cell" role="cell"><input type="checkbox" data-q="hideOps"${c.hideOperatorsEnabled ? ' checked' : ''}></div>
    <div class="gt-cell" role="cell"><input type="checkbox" data-q="watermark" title="Watermark downloads for non-owners"${c.watermarkEnabled ? ' checked' : ''}></div>
    <div class="gt-cell actions" role="cell"><button class="btn btn-ghost btn-xs" data-save="${c.id}">Save</button></div>
  </div>`;
}
async function saveCust(id) {
  const tr = $('customers').querySelector(`[data-cust="${id}"]`);
  const g = (q) => tr.querySelector(`[data-q="${q}"]`);
  const data = { quotaAreas: Number(g('areas').value), quotaPlaces: Number(g('places').value), status: g('status').value, plan: g('plan').value, hideOperatorsEnabled: g('hideOps').checked, watermarkEnabled: g('watermark').checked };
  const { body } = await jsend(`/api/admin/customers/${id}`, 'PATCH', data);
  if (body.ok) banner('ok', `Saved changes to ${esc(body.customer.name)}.`);
  else banner('err', body.error || 'Save failed.');
}

// ---- users --------------------------------------------------------------
let me = null; // set once at init; used only to stop an admin disabling their own row in the UI
let customersForInvite = null; // cached [{id,name}], shared by the invite dialog and the users tab's org picker
async function ensureCustomersList() {
  if (!customersForInvite) {
    const { body } = await jget('/api/admin/customers');
    customersForInvite = ((body && body.customers) || []).map((c) => ({ id: c.id, name: c.name }));
  }
  return customersForInvite;
}
LOADERS.users = async () => {
  const [{ body }] = await Promise.all([jget('/api/admin/users'), ensureCustomersList()]);
  const box = $('users');
  const users = (body && body.users) || [];
  if (!users.length) { box.innerHTML = '<div class="empty">No users yet.</div>'; return; }
  // Default view: grouped by customer, then role — a click on any header still
  // overrides this via the normal single-column sort.
  const ordered = sortRowsMulti(users, ['customerName', 'role']);
  const columns = [{ label: 'User', key: 'email' }, { label: 'Customer', key: 'customerName' }, { label: 'Role', key: 'role' }, { label: 'Status', key: 'status' }, { label: 'Invited', key: 'createdAt' }, { label: '' }];
  renderSortable('users', box, [26, 18, 14, 14, 12, 16], columns, ordered, rowUser, (b) => {
    b.querySelectorAll('button[data-save]').forEach((b2) => b2.addEventListener('click', () => saveUser(b2.dataset.save)));
  });
};
function rowUser(u) {
  const self = me && u.id === me.id;
  const custOptions = '<option value="">— platform admin —</option>'
    + (customersForInvite || []).map((c) => `<option value="${c.id}"${u.customerId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="gt-row" role="row" data-user="${u.id}" data-current-customer="${u.customerId || ''}">
    <div class="gt-cell" role="cell"><strong>${esc(u.email)}</strong>${self ? ' <span class="muted">(you)</span>' : ''}<div><input type="text" value="${esc(u.name || '')}" data-q="name" class="planin" maxlength="120" placeholder="name"></div></div>
    <div class="gt-cell" role="cell"><select data-q="customerId">${custOptions}</select></div>
    <div class="gt-cell" role="cell"><select data-q="role">
        <option value="editor"${u.role === 'editor' ? ' selected' : ''}>editor</option>
        <option value="approver"${u.role === 'approver' ? ' selected' : ''}>approver</option>
        <option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option>
      </select></div>
    <div class="gt-cell" role="cell"><select data-q="status"${self ? ' disabled title="You cannot disable your own account."' : ''}>
        <option value="active"${u.status === 'active' ? ' selected' : ''}>active</option>
        <option value="disabled"${u.status === 'disabled' ? ' selected' : ''}>disabled</option>
      </select></div>
    <div class="gt-cell" role="cell">${fmtDate(u.createdAt)}</div>
    <div class="gt-cell actions" role="cell"><button class="btn btn-ghost btn-xs" data-save="${u.id}">Save</button></div>
  </div>`;
}
// ---- sessions ---------------------------------------------------------------
// Who is signed in, and the ability to end it (technical-audit_2026-08-19 S5).
// Before this there was neither: `purgeExpiredSessions` removes only the
// already-dead, so a token that escaped stayed a valid credential until its own
// clock ran out and nobody could do anything about it.
LOADERS.sessions = async () => {
  const box = $('sessions');
  const { body } = await jget('/api/admin/sessions');
  if (!body || !body.ok) { box.innerHTML = '<div class="empty">Could not load sessions.</div>'; return; }
  $('sessDays').textContent = body.sessionDays;
  $('sessStepUp').textContent = body.stepUpMinutes;
  const rows = body.sessions || [];
  if (!rows.length) { box.innerHTML = '<div class="empty">Nobody is signed in.</div>'; return; }
  const columns = [{ label: 'User', key: 'user' }, { label: 'Organisation' }, { label: 'Signed in', key: 'signedInAt' }, { label: 'Last used', key: 'lastSeenAt' }, { label: 'Expires', key: 'expiresAt' }, { label: 'Handle' }, { label: '' }];
  renderSortable('sessions', box, [24, 18, 14, 14, 14, 10, 6], columns, rows, rowSession, (b) => {
    b.querySelectorAll('button[data-revoke]').forEach((btn) => btn.addEventListener('click', () => revokeSession(btn.dataset.revoke, btn.dataset.who, btn.dataset.self === '1')));
  });
};
function rowSession(x) {
  return `<div class="gt-row" role="row" data-session="${esc(x.handle)}">
    <div class="gt-cell" role="cell"><strong>${esc(x.user.email)}</strong>${x.current ? ' <span class="muted">(this browser)</span>' : ''}<div class="muted">${esc(x.user.role)}</div></div>
    <div class="gt-cell" role="cell">${esc(x.customer ? x.customer.name : '— platform admin —')}</div>
    <div class="gt-cell" role="cell">${fmtDate(x.signedInAt)}</div>
    <div class="gt-cell" role="cell">${fmtDate(x.lastSeenAt)}</div>
    <div class="gt-cell" role="cell">${fmtDate(x.expiresAt)}</div>
    <div class="gt-cell" role="cell"><code>${esc(x.handle)}</code></div>
    <div class="gt-cell actions" role="cell"><button class="btn btn-ghost btn-xs" data-revoke="${esc(x.handle)}" data-who="${esc(x.user.email)}" data-self="${x.current ? '1' : '0'}">Revoke</button></div>
  </div>`;
}
async function revokeSession(handle, who, isSelf) {
  const msg = isSelf
    ? 'This is the session you are using. Revoking it signs YOU out of this browser immediately.\n\nContinue?'
    : `Sign ${who} out of this session immediately?\n\nThey can sign in again with a fresh link; anything unsaved in that browser is lost.`;
  if (!confirm(msg)) return;
  const { body } = await jsend(`/api/admin/sessions/${encodeURIComponent(handle)}/revoke`, 'POST', {});
  if (!body.ok) { banner('err', body.error || 'Could not revoke that session.'); return; }
  if (body.self) { location.href = '/app/login.html'; return; }
  banner('ok', `Revoked ${esc(who)}'s session.`);
  LOADERS.sessions();
}

async function saveUser(id) {
  const tr = $('users').querySelector(`[data-user="${id}"]`);
  const g = (q) => tr.querySelector(`[data-q="${q}"]`);
  const customerId = g('customerId').value;
  const wasCustomer = tr.dataset.currentCustomer || '';
  if (customerId !== wasCustomer) {
    const fromName = (customersForInvite || []).find((c) => String(c.id) === wasCustomer);
    const toName = (customersForInvite || []).find((c) => String(c.id) === customerId);
    const msg = `Move this user from ${fromName ? fromName.name : '— platform admin —'} to ${toName ? toName.name : '— platform admin —'}?\n\nThis changes which maps they can see.`;
    if (!confirm(msg)) { g('customerId').value = wasCustomer; return; }
  }
  const data = { name: g('name').value, role: g('role').value, status: g('status').disabled ? undefined : g('status').value, customerId: customerId || null };
  const { body } = await jsend(`/api/admin/users/${id}`, 'PATCH', data);
  if (body.ok) { banner('ok', `Saved changes to ${esc(body.user.email)}.`); customersForInvite = null; LOADERS.users(); LOADERS.customers(); }
  else banner('err', body.error || 'Save failed.');
}

// invite dialog
const inviteDlg = $('inviteDialog');
async function openInvite() {
  $('inviteForm').reset();
  $('inviteMsg').className = 'notice';
  if (!customersForInvite) {
    const { body } = await jget('/api/admin/customers');
    customersForInvite = ((body && body.customers) || []).map((c) => ({ id: c.id, name: c.name }));
  }
  const sel = $('invCustomer');
  sel.innerHTML = '<option value="">— platform admin, no customer —</option>'
    + customersForInvite.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  inviteDlg.showModal();
}
$('inviteUserBtn').addEventListener('click', openInvite);
$('inviteCancel').addEventListener('click', () => inviteDlg.close());
$('inviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('inviteSubmit'); btn.disabled = true; btn.textContent = 'Inviting…';
  const data = {
    email: $('invEmail').value, name: $('invName').value, role: $('invRole').value,
    customerId: $('invCustomer').value || undefined,
  };
  const { body } = await jsend('/api/admin/users', 'POST', data);
  btn.disabled = false; btn.textContent = 'Invite';
  if (body.ok) {
    inviteDlg.close();
    const link = body.inviteLink
      ? `<div class="invite">Invite link (dev — normally emailed): <code id="ulink">${esc(body.inviteLink)}</code> <button class="btn btn-ghost btn-xs" id="copyULink" type="button">Copy</button></div>`
      : ' The invite has been emailed.';
    banner('ok-sticky', `✓ Invited ${esc(body.user.email)} as ${esc(body.user.role)}.${link}`);
    const cp = $('copyULink'); if (cp) cp.addEventListener('click', () => navigator.clipboard.writeText(body.inviteLink).then(() => { cp.textContent = 'Copied'; }));
    customersForInvite = null; // customer user-counts changed
    LOADERS.users(); LOADERS.customers();
  } else {
    $('inviteMsg').className = 'notice err show'; $('inviteMsg').textContent = body.error || 'Invite failed.';
  }
});

// ---- messages ---------------------------------------------------------------
LOADERS.messages = async () => {
  const { body } = await jget('/api/admin/messages');
  const box = $('messages');
  const msgs = (body && body.messages) || [];
  if (!msgs.length) { box.innerHTML = '<div class="empty">No messages.</div>'; return; }
  const columns = [{ label: 'When', key: 'created_at' }, { label: 'Kind', key: 'kind' }, { label: 'From', key: 'name' }, { label: 'About', key: 'map_name' }, { label: 'Message' }];
  renderSortable('messages', box, [10, 10, 18, 18, 44], columns, msgs, (m) => `<div class="gt-row" role="row">
      <div class="gt-cell" role="cell">${fmtDate(m.created_at)}</div><div class="gt-cell" role="cell">${esc(m.kind)}</div>
      <div class="gt-cell" role="cell">${esc(m.name || '')}<div class="sub">${esc(m.email || '')}</div></div>
      <div class="gt-cell" role="cell">${m.map_slug ? '<a href="/m/' + esc(m.map_slug) + '" target="_blank" rel="noopener">' + esc(m.map_name || m.map_slug) + '</a>' : '<span class="muted">—</span>'}</div>
      <div class="gt-cell wrap" role="cell">${esc(m.body)}</div></div>`);
};

// ---- refreshes (P5 monthly-update queue, read-only) -------------------------
function refreshSummaryText(s) {
  if (!s) return '<span class="muted">—</span>';
  if (s.unchanged) return '<span class="muted">data only (no service changes)</span>';
  const bits = [];
  if (s.routesAdded && s.routesAdded.length) bits.push('+' + s.routesAdded.join('/'));
  if (s.routesRemoved && s.routesRemoved.length) bits.push('−' + s.routesRemoved.join('/'));
  if (s.stopsChanged && s.stopsChanged.length) bits.push(s.stopsChanged.length + ' stop change' + (s.stopsChanged.length > 1 ? 's' : ''));
  if (s.descChanged && s.descChanged.length) bits.push(s.descChanged.length + ' reworded');
  if (s.validity) bits.push('validity → ' + esc(s.validity.to || '—'));
  return bits.length ? esc(bits.join(' · ')) : '<span class="muted">minor</span>';
}
// Plain-text (unescaped) version for the audit table, which esc()s the result.
function refreshSummaryTextPlain(s) {
  if (!s || s.unchanged) return s && s.unchanged ? 'data only' : '';
  const bits = [];
  if (s.routesAdded && s.routesAdded.length) bits.push('+' + s.routesAdded.join('/'));
  if (s.routesRemoved && s.routesRemoved.length) bits.push('−' + s.routesRemoved.join('/'));
  if (s.stopsChanged && s.stopsChanged.length) bits.push(s.stopsChanged.length + ' stop change' + (s.stopsChanged.length > 1 ? 's' : ''));
  if (s.descChanged && s.descChanged.length) bits.push(s.descChanged.length + ' reworded');
  if (s.validity) bits.push('validity → ' + (s.validity.to || '—'));
  return bits.join(' · ');
}
LOADERS.refreshes = async () => {
  const { body } = await jget('/api/admin/proposed-updates');
  const box = $('refreshes');
  const ups = (body && body.updates) || [];
  if (!ups.length) { box.innerHTML = '<div class="empty">No pending updates. 🎉</div>'; return; }
  const columns = [{ label: 'Map', key: 'map.name' }, { label: 'Customer', key: 'customer' }, { label: 'Source' }, { label: 'Changes' }, { label: 'Staged', key: 'createdAt' }, { label: '' }];
  renderSortable('refreshes', box, [17, 12, 15, 26, 14, 16], columns, ups, (u) => `<div class="gt-row" role="row">
      <div class="gt-cell" role="cell"><a href="/app/maps/${u.map.id}" target="_blank" rel="noopener"><strong>${esc(u.map.name)}</strong></a> <span class="tag ${u.map.kind === 'place' ? 'place' : 'area'}">${u.map.kind === 'place' ? 'Place' : 'Area'}</span><div class="sub">${esc(u.map.subject || '')}</div></div>
      <div class="gt-cell" role="cell">${esc(u.customer || '—')}</div>
      <div class="gt-cell wrap" role="cell">${esc(u.sourceNote || '') || '<span class="muted">—</span>'}</div>
      <div class="gt-cell wrap" role="cell">${refreshSummaryText(u.summary)}</div>
      <div class="gt-cell" role="cell">${fmtDate(u.createdAt)}</div>
      <div class="gt-cell actions" role="cell" data-eev-hide>
        <button class="btn btn-primary btn-xs" data-accept-refresh="${u.id}" data-map="${u.map.id}" data-name="${esc(u.map.name)}">Accept</button>
        <button class="btn btn-ghost btn-xs" data-decline-refresh="${u.id}" data-map="${u.map.id}" data-name="${esc(u.map.name)}">Decline</button>
      </div>
    </div>`, (b) => {
    b.querySelectorAll('button[data-accept-refresh]').forEach((b2) => b2.addEventListener('click', () => decideRefresh(b2.dataset.map, b2.dataset.acceptRefresh, b2.dataset.name, 'accept')));
    b.querySelectorAll('button[data-decline-refresh]').forEach((b2) => b2.addEventListener('click', () => decideRefresh(b2.dataset.map, b2.dataset.declineRefresh, b2.dataset.name, 'decline')));
    if (window.EEV) window.EEV.apply(); // rows render after the toggle's own init
  });
};
// Admins may accept/decline any map's proposed update (src/server.js
// loadOwnedMap allows role:'admin' regardless of customer_id) — this reuses
// the exact same customer-facing endpoints editor.js calls, just from the
// admin console, so there's a fast path that doesn't require opening the map
// page (the "Map" link above still does, for previewing the change first).
async function decideRefresh(mapId, pid, mapName, verb) {
  const msg = verb === 'accept'
    ? `Accept the pending update for "${mapName}"? It becomes a new draft version with the customer's colours and landmark choices re-applied; it still has to be sent for review and published before the public sees it.`
    : `Decline the pending update for "${mapName}"? The map keeps its current data.`;
  if (!confirm(msg)) return;
  const { body } = await jsend(`/api/maps/${mapId}/proposed/${pid}/${verb}`, 'POST', {});
  if (body.ok) {
    banner(verb === 'accept' ? 'ok' : 'warn', verb === 'accept'
      ? `✓ Update accepted for <strong>${esc(mapName)}</strong> — new draft version ${esc(body.version || '')} staged. <a href="/app/maps/${mapId}" target="_blank" rel="noopener">Open the map</a> to send it for review.`
      : `Update declined for <strong>${esc(mapName)}</strong> — unchanged.`);
    LOADERS.refreshes(); loadSummary();
  } else {
    banner('err', body.error || `Could not ${verb} the update.`);
  }
}

// ---- audit ------------------------------------------------------------------
const ACTION_LABEL = {
  'version.submit': 'Sent version for review',
  'version.publish': 'Published version',
  'version.revert': 'Reverted published version',
  'version.reject': 'Sent version back',
  'version.withdraw': 'Withdrew version from review',
  'version.save': 'Saved version',
  'application.approve': 'Approved application',
  'application.reject': 'Rejected application',
  'maprequest.approve': 'Approved map request',
  'maprequest.reject': 'Rejected map request',
  'maprequest.fulfil': 'Built an approved request',
  'customer.update': 'Updated customer',
  'user.invite': 'Invited user',
  'user.update': 'Updated user',
  'user.reassign': 'Moved user to another organisation',
  'refresh.accept': 'Accepted update',
  'refresh.decline': 'Declined update',
  'branding.update': 'Updated public details',
  'public.list': 'Listed map publicly',
  'public.unlist': 'Removed map from public site',
};
function auditDetail(a) {
  const d = a.detail || {};
  if (a.action === 'version.revert') return esc([`${d.from || '?'} → ${d.to || '?'}`, d.reason && '“' + d.reason + '”'].filter(Boolean).join(' · '));
  if (a.action.startsWith('version.')) return esc([d.version, d.note && '“' + d.note + '”'].filter(Boolean).join(' · '));
  if (a.action.startsWith('application.')) return esc([d.org, d.email].filter(Boolean).join(' · '));
  if (a.action === 'maprequest.fulfil') return esc([d.name, d.kind, d.version, d.slug].filter(Boolean).join(' · '));
  if (a.action.startsWith('maprequest.')) return esc([d.name, d.kind, d.from && 'was ' + d.from].filter(Boolean).join(' · '));
  if (a.action === 'customer.update') return esc([d.name, `areas ${d.quotaAreas}`, `places ${d.quotaPlaces}`, d.status].filter((x) => x != null).join(' · '));
  if (a.action === 'user.reassign') return esc([d.email, `${d.fromCustomerName || '— platform —'} → ${d.toCustomerName || '— platform —'}`].filter(Boolean).join(' · '));
  if (a.action === 'user.invite') return esc([d.email, d.role, d.customerId != null ? '' : '— platform —'].filter(Boolean).join(' · '));
  if (a.action === 'user.update') return esc([d.email, d.role, d.status].filter(Boolean).join(' · '));
  if (a.action.startsWith('refresh.')) {
    const drops = d.droppedOverrides && d.droppedOverrides.length ? `${d.droppedOverrides.length} override(s) dropped` : '';
    return esc([d.version, refreshSummaryTextPlain(d.changeSummary), drops].filter(Boolean).join(' · '));
  }
  return '';
}
LOADERS.audit = async () => {
  const { body } = await jget('/api/admin/audit');
  const box = $('audit');
  const rows = (body && body.audit) || [];
  if (!rows.length) { box.innerHTML = '<div class="empty">No audit events yet.</div>'; return; }
  const columns = [{ label: 'When', key: 'at' }, { label: 'Who', key: 'actor' }, { label: 'Action', key: 'action' }, { label: 'Map', key: 'mapName' }, { label: 'Details' }];
  renderSortable('audit', box, [12, 16, 18, 16, 38], columns, rows, (a) => `<div class="gt-row" role="row">
      <div class="gt-cell" role="cell">${fmtDate(a.at)}</div>
      <div class="gt-cell" role="cell">${esc(a.actor)}</div>
      <div class="gt-cell" role="cell">${esc(ACTION_LABEL[a.action] || a.action)}</div>
      <div class="gt-cell" role="cell">${a.mapName ? esc(a.mapName) : '<span class="muted">—</span>'}</div>
      <div class="gt-cell wrap" role="cell">${auditDetail(a) || '<span class="muted">—</span>'}</div>
    </div>`);
};

// ---- ops (P7) ---------------------------------------------------------------
const mb = (b) => `${(Number(b || 0) / 1048576).toFixed(1)} MB`;
LOADERS.ops = async () => {
  const { body } = await jget('/api/admin/ops');
  const box = $('ops');
  if (!body || !body.ok) { box.innerHTML = '<div class="empty">Could not read the ops snapshot.</div>'; return; }
  const o = body.ops;
  const r = o.readiness, s = o.storage, a = o.activity, p = o.process;
  const badge = $('badge-ops');
  if (badge) { badge.textContent = r.ok ? '' : '!'; badge.className = 'count-badge' + (r.ok ? '' : ' warn'); }

  const checks = Object.entries(r.checks).map(([name, c]) =>
    `<span class="status-pill ${c.ok ? 'pub' : 'req'}">${esc(name)}${c.ok ? ' ok' : ' — ' + esc(c.error || (c.missing || []).join(', '))}</span>`).join(' ');

  const reclaimable = (s.totals.stagedBytes || 0) + (s.totals.archivedBytes || 0);
  box.innerHTML = `
    <div class="ops-grid">
      <div class="card"><h3>Health</h3><div class="pill-row">${checks}</div>
        <p class="sub">${esc(p.version)} · node ${esc(p.node)} · ${esc(p.platform)} · up ${Math.floor(p.uptimeSeconds / 60)} min · RSS ${mb(p.rssBytes)}</p></div>
      <div class="card"><h3>Store</h3>
        <p>${s.totals.maps} map(s), ${s.totals.versions} rendered version(s), <strong>${mb(s.totals.bytes)}</strong> on disk.</p>
        <p class="sub">Reclaimable by <code>npm run prune:staged</code>: <strong>${mb(reclaimable)}</strong> (staged ${mb(s.totals.stagedBytes)} + archived ${mb(s.totals.archivedBytes)}).</p>
        <p class="sub">${esc(s.dataDir)}</p></div>
      <div class="card"><h3>Activity</h3>
        <p>${a.publishedMaps} published · ${a.pendingPublishRequests} awaiting review · ${a.pendingProposedUpdates} update(s) pending · ${a.sessions} active session(s)</p>
        <p class="sub">last version ${esc(fmtDate(a.lastVersionAt) || '—')} · last publish ${esc(fmtDate(a.lastPublishAt) || '—')} · ${a.auditEvents} audit event(s)</p></div>
    </div>
    <div class="table-wrap" style="margin-top:14px" id="opsMapsTable"></div>`;

  if (s.maps.length) {
    const columns = [{ label: 'Map', key: 'name' }, { label: 'Data', key: 'bytes.data' }, { label: 'Renders', key: 'bytes.renders' }, { label: 'Staged', key: 'bytes.staged' }, { label: 'Archived', key: 'bytes.archived' }, { label: 'Total', key: 'bytes.total' }];
    renderSortable('opsMaps', $('opsMapsTable'), [30, 14, 14, 14, 14, 14], columns, s.maps, (m) => `<div class="gt-row" role="row">
      <div class="gt-cell" role="cell"><strong>${esc(m.name)}</strong><div class="sub">#${m.id} · ${esc(m.kind)} · ${m.versions} version(s)</div></div>
      <div class="gt-cell" role="cell">${mb(m.bytes.data)}</div><div class="gt-cell" role="cell">${mb(m.bytes.renders)}</div>
      <div class="gt-cell" role="cell">${mb(m.bytes.staged)}</div><div class="gt-cell" role="cell">${mb(m.bytes.archived)}</div>
      <div class="gt-cell" role="cell"><strong>${mb(m.bytes.total)}</strong></div>
    </div>`);
  } else {
    $('opsMapsTable').innerHTML = gtOpen([30, 14, 14, 14, 14, 14], ['Map', 'Data', 'Renders', 'Staged', 'Archived', 'Total']) + '<div class="gt-row" role="row"><div class="gt-cell" role="cell" style="grid-column:1/-1">No maps with an object store yet.</div></div>' + gtClose;
  }
};

// ---- init -------------------------------------------------------------------
$('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/login.html'; });
(async () => {
  const { status, body } = await jget('/api/me');
  if (status === 401) { location.href = '/app/login.html'; return; }
  me = body.user;
  if (!me || me.role !== 'admin') { location.href = '/app'; return; }
  $('whoami').textContent = `${me.email} · admin`;
  $('logoutBtn').style.display = '';
  // H9 — purely presentational; see public/js/editor-eye-view.js.
  $('eevToggle').checked = window.EEV ? window.EEV.on() : false;
  $('eevToggle').addEventListener('change', (e) => window.EEV && window.EEV.set(e.target.checked));
  if (window.EEV) window.EEV.apply();
  await loadSummary();
  // The first thing an admin sees should be the work, not a queue they then
  // have to cross-reference against five other queues.
  showTab('todo');
})();
