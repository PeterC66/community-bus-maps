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
const SECTIONS = ['applications', 'requests', 'customers', 'messages'];
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
  set('badge-requests', s.pendingMapRequests, true);
  set('badge-customers', s.customers, false);
  set('badge-messages', s.newMessages, false);
}

// ---- applications -----------------------------------------------------------
LOADERS.applications = async () => {
  const showReviewed = $('showReviewed').checked;
  const { body } = await jget('/api/admin/applications' + (showReviewed ? '' : '?status=pending'));
  const box = $('applications');
  const apps = (body && body.applications) || [];
  if (!apps.length) { box.innerHTML = `<div class="empty">${showReviewed ? 'No applications yet.' : 'No pending applications. 🎉'}</div>`; return; }
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>Organisation</th><th>Contact</th><th>Wants</th><th>Received</th><th>Status</th><th></th>
    </tr></thead><tbody>${apps.map(rowApp).join('')}</tbody></table>`;
  box.querySelectorAll('button[data-approve]').forEach((b) => b.addEventListener('click', () => openApprove(b.dataset.approve, b.dataset.name, b.dataset.contact)));
  box.querySelectorAll('button[data-reject]').forEach((b) => b.addEventListener('click', () => rejectApp(b.dataset.reject, b.dataset.name)));
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
  return `<tr>
    <td><strong>${esc(a.org_name)}</strong><div class="sub">${esc(a.org_type)}${a.website ? ' · <a href="' + esc(a.website) + '" target="_blank" rel="noopener">site</a>' : ''}</div></td>
    <td>${esc(a.contact_name)}<div class="sub">${esc(a.email)}${a.phone ? ' · ' + esc(a.phone) : ''}</div></td>
    <td class="wrap">${esc(a.wants || '') || '<span class="muted">—</span>'}${a.message ? '<div class="sub">' + esc(a.message) + '</div>' : ''}</td>
    <td>${fmtDate(a.created_at)}</td>
    <td>${badge}</td>
    <td class="actions">${actions}</td>
  </tr>`;
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
  if (!reqs.length) { box.innerHTML = '<div class="empty">No pending map requests.</div>'; return; }
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>Map</th><th>Customer</th><th>Requested by</th><th>Notes</th><th>When</th><th></th>
    </tr></thead><tbody>${reqs.map(rowReq).join('')}</tbody></table>`;
  box.querySelectorAll('button[data-appr]').forEach((b) => b.addEventListener('click', () => mapAction(b.dataset.appr, 'approve', b.dataset.name)));
  box.querySelectorAll('button[data-rej]').forEach((b) => b.addEventListener('click', () => mapAction(b.dataset.rej, 'reject', b.dataset.name)));
};
function rowReq(m) {
  const kind = `<span class="tag ${m.kind === 'place' ? 'place' : 'area'}">${m.kind === 'place' ? 'Place' : 'Area'}</span>`;
  return `<tr>
    <td><strong>${esc(m.name)}</strong> ${kind}<div class="sub">${esc(m.subject || '')}</div></td>
    <td>${esc(m.customer ? m.customer.name : '—')}</td>
    <td>${esc(m.requestedBy || '—')}</td>
    <td class="wrap">${esc(m.requestNote || '') || '<span class="muted">—</span>'}</td>
    <td>${fmtDate(m.createdAt)}</td>
    <td class="actions">
      <button class="btn btn-primary btn-xs" data-appr="${m.id}" data-name="${esc(m.name)}">Approve</button>
      <button class="btn btn-ghost btn-xs" data-rej="${m.id}" data-name="${esc(m.name)}">Reject</button>
    </td></tr>`;
}
async function mapAction(id, action, name) {
  if (action === 'reject' && !confirm(`Reject the request for "${name}"? It will be archived and the quota slot freed.`)) return;
  const { body } = await jsend(`/api/admin/maps/${id}/${action}`, 'POST');
  if (body.ok) {
    banner(action === 'approve' ? 'ok' : 'warn', action === 'approve'
      ? `Approved "${esc(name)}" — it's now queued for our team to build.`
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
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>Customer</th><th>Users</th><th>Area maps</th><th>Place maps</th><th>Status</th><th>Plan</th><th></th>
    </tr></thead><tbody>${custs.map(rowCust).join('')}</tbody></table>`;
  box.querySelectorAll('button[data-save]').forEach((b) => b.addEventListener('click', () => saveCust(b.dataset.save)));
};
function rowCust(c) {
  const overA = c.usedAreas > c.quotaAreas ? ' over' : '', overP = c.usedPlaces > c.quotaPlaces ? ' over' : '';
  return `<tr data-cust="${c.id}">
    <td><strong>${esc(c.name)}</strong><div class="sub">${esc(c.type)}</div></td>
    <td>${c.users}</td>
    <td class="qcell${overA}"><span class="used">${c.usedAreas}</span> / <input type="number" min="0" max="99" value="${c.quotaAreas}" data-q="areas" class="qnum"></td>
    <td class="qcell${overP}"><span class="used">${c.usedPlaces}</span> / <input type="number" min="0" max="99" value="${c.quotaPlaces}" data-q="places" class="qnum"></td>
    <td><select data-q="status"><option value="active"${c.status === 'active' ? ' selected' : ''}>active</option><option value="suspended"${c.status === 'suspended' ? ' selected' : ''}>suspended</option></select></td>
    <td><input type="text" value="${esc(c.plan)}" data-q="plan" class="planin" maxlength="40"></td>
    <td class="actions"><button class="btn btn-ghost btn-xs" data-save="${c.id}">Save</button></td>
  </tr>`;
}
async function saveCust(id) {
  const tr = $('customers').querySelector(`tr[data-cust="${id}"]`);
  const g = (q) => tr.querySelector(`[data-q="${q}"]`);
  const data = { quotaAreas: Number(g('areas').value), quotaPlaces: Number(g('places').value), status: g('status').value, plan: g('plan').value };
  const { body } = await jsend(`/api/admin/customers/${id}`, 'PATCH', data);
  if (body.ok) banner('ok', `Saved changes to ${esc(body.customer.name)}.`);
  else banner('err', body.error || 'Save failed.');
}

// ---- messages ---------------------------------------------------------------
LOADERS.messages = async () => {
  const { body } = await jget('/api/admin/messages');
  const box = $('messages');
  const msgs = (body && body.messages) || [];
  if (!msgs.length) { box.innerHTML = '<div class="empty">No messages.</div>'; return; }
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>When</th><th>Kind</th><th>From</th><th>Message</th>
    </tr></thead><tbody>${msgs.map((m) => `<tr>
      <td>${fmtDate(m.created_at)}</td><td>${esc(m.kind)}</td>
      <td>${esc(m.name || '')}<div class="sub">${esc(m.email || '')}</div></td>
      <td class="wrap">${esc(m.body)}</td></tr>`).join('')}</tbody></table>`;
};

// ---- init -------------------------------------------------------------------
$('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/login.html'; });
(async () => {
  const { status, body } = await jget('/api/me');
  if (status === 401) { location.href = '/app/login.html'; return; }
  const me = body.user;
  if (!me || me.role !== 'admin') { location.href = '/app'; return; }
  $('whoami').textContent = `${me.email} · admin`;
  $('logoutBtn').style.display = '';
  await loadSummary();
  showTab('applications');
})();
