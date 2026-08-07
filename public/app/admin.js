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
const SECTIONS = ['applications', 'requests', 'customers', 'messages', 'refreshes', 'audit', 'ops'];
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
  if (!reqs.length) box.innerHTML = '<div class="empty">No pending map requests.</div>';
  else {
    box.innerHTML = `<table class="grid"><thead><tr>
        <th>Map</th><th>Customer</th><th>Requested by</th><th>Notes</th><th>When</th><th></th>
      </tr></thead><tbody>${reqs.map(rowReq).join('')}</tbody></table>`;
    box.querySelectorAll('button[data-appr]').forEach((b) => b.addEventListener('click', () => mapAction(b.dataset.appr, 'approve', b.dataset.name)));
    box.querySelectorAll('button[data-rej]').forEach((b) => b.addEventListener('click', () => mapAction(b.dataset.rej, 'reject', b.dataset.name)));
  }
  renderAwaitingBuild((body && body.awaitingBuild) || []);
};

// Approved requests the central pipeline still has to build. Each row carries the
// exact importer command that fulfils THAT request row in place.
function renderAwaitingBuild(rows) {
  const box = $('awaitingBuild');
  if (!rows.length) { box.innerHTML = '<div class="empty">Nothing waiting to be built.</div>'; return; }
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>Map</th><th>Customer</th><th>Approved for</th><th>Build command</th><th></th>
    </tr></thead><tbody>${rows.map((m) => `<tr>
      <td><strong>${esc(m.name)}</strong> <span class="tag ${m.kind === 'place' ? 'place' : 'area'}">${m.kind === 'place' ? 'Place' : 'Area'}</span>
        <div class="sub">#${m.id} · ${esc(m.slug)}${m.subject ? ' · ' + esc(m.subject) : ''}</div></td>
      <td>${esc(m.customer ? m.customer.name : '—')}<div class="sub">${esc(m.requestedBy || '')}</div></td>
      <td>${fmtDate(m.createdAt)}<div class="sub wrap">${esc(m.requestNote || '')}</div></td>
      <td class="wrap"><code class="cmd" data-cmd="${esc(m.importCommand)}">${esc(m.importCommand)}</code></td>
      <td class="actions">
        <button class="btn btn-ghost btn-xs" data-copy="${m.id}" data-cmd="${esc(m.importCommand)}">Copy</button>
        <button class="btn btn-ghost btn-xs" data-rej="${m.id}" data-name="${esc(m.name)}">Archive</button>
      </td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('button[data-copy]').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.cmd).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 2000); });
  }));
  box.querySelectorAll('button[data-rej]').forEach((b) => b.addEventListener('click', () => mapAction(b.dataset.rej, 'reject', b.dataset.name)));
}
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
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>Customer</th><th>Users</th><th>Area maps</th><th>Place maps</th><th>Status</th><th>Plan</th><th>Operator filter</th><th></th>
    </tr></thead><tbody>${custs.map(rowCust).join('')}</tbody></table>`;
  box.querySelectorAll('button[data-save]').forEach((b) => b.addEventListener('click', () => saveCust(b.dataset.save)));
};
function rowCust(c) {
  const overA = c.usedAreas > c.quotaAreas ? ' over' : '', overP = c.usedPlaces > c.quotaPlaces ? ' over' : '';
  return `<tr data-cust="${c.id}">
    <td><strong>${esc(c.name)}</strong><div class="sub">${esc(c.type)}${c.publicUrl ? ' · <a href="' + esc(c.publicUrl) + '" target="_blank" rel="noopener">public page</a>' : ''}</div></td>
    <td>${c.users}</td>
    <td class="qcell${overA}"><span class="used">${c.usedAreas}</span> / <input type="number" min="0" max="99" value="${c.quotaAreas}" data-q="areas" class="qnum"></td>
    <td class="qcell${overP}"><span class="used">${c.usedPlaces}</span> / <input type="number" min="0" max="99" value="${c.quotaPlaces}" data-q="places" class="qnum"></td>
    <td><select data-q="status"><option value="active"${c.status === 'active' ? ' selected' : ''}>active</option><option value="suspended"${c.status === 'suspended' ? ' selected' : ''}>suspended</option></select></td>
    <td><input type="text" value="${esc(c.plan)}" data-q="plan" class="planin" maxlength="40"></td>
    <td><input type="checkbox" data-q="hideOps"${c.hideOperatorsEnabled ? ' checked' : ''}></td>
    <td class="actions"><button class="btn btn-ghost btn-xs" data-save="${c.id}">Save</button></td>
  </tr>`;
}
async function saveCust(id) {
  const tr = $('customers').querySelector(`tr[data-cust="${id}"]`);
  const g = (q) => tr.querySelector(`[data-q="${q}"]`);
  const data = { quotaAreas: Number(g('areas').value), quotaPlaces: Number(g('places').value), status: g('status').value, plan: g('plan').value, hideOperatorsEnabled: g('hideOps').checked };
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
      <th>When</th><th>Kind</th><th>From</th><th>About</th><th>Message</th>
    </tr></thead><tbody>${msgs.map((m) => `<tr>
      <td>${fmtDate(m.created_at)}</td><td>${esc(m.kind)}</td>
      <td>${esc(m.name || '')}<div class="sub">${esc(m.email || '')}</div></td>
      <td>${m.map_slug ? '<a href="/m/' + esc(m.map_slug) + '" target="_blank" rel="noopener">' + esc(m.map_name || m.map_slug) + '</a>' : '<span class="muted">—</span>'}</td>
      <td class="wrap">${esc(m.body)}</td></tr>`).join('')}</tbody></table>`;
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
  if (!ups.length) { box.innerHTML = '<div class="empty">No pending monthly updates. 🎉</div>'; return; }
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>Map</th><th>Customer</th><th>Source</th><th>Changes</th><th>Staged</th>
    </tr></thead><tbody>${ups.map((u) => `<tr>
      <td><strong>${esc(u.map.name)}</strong> <span class="tag ${u.map.kind === 'place' ? 'place' : 'area'}">${u.map.kind === 'place' ? 'Place' : 'Area'}</span><div class="sub">${esc(u.map.subject || '')}</div></td>
      <td>${esc(u.customer || '—')}</td>
      <td class="wrap">${esc(u.sourceNote || '') || '<span class="muted">—</span>'}</td>
      <td class="wrap">${refreshSummaryText(u.summary)}</td>
      <td>${fmtDate(u.createdAt)}</td>
    </tr>`).join('')}</tbody></table>`;
};

// ---- audit ------------------------------------------------------------------
const ACTION_LABEL = {
  'version.submit': 'Submitted for publication',
  'version.publish': 'Published version',
  'version.revert': 'Reverted published version',
  'version.reject': 'Sent version back',
  'version.withdraw': 'Withdrew publish request',
  'version.save': 'Saved version',
  'application.approve': 'Approved application',
  'application.reject': 'Rejected application',
  'maprequest.approve': 'Approved map request',
  'maprequest.reject': 'Rejected map request',
  'maprequest.fulfil': 'Built an approved request',
  'customer.update': 'Updated customer',
  'refresh.accept': 'Accepted monthly update',
  'refresh.decline': 'Declined monthly update',
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
  box.innerHTML = `<table class="grid"><thead><tr>
      <th>When</th><th>Who</th><th>Action</th><th>Map</th><th>Details</th>
    </tr></thead><tbody>${rows.map((a) => `<tr>
      <td>${fmtDate(a.at)}</td>
      <td>${esc(a.actor)}</td>
      <td>${esc(ACTION_LABEL[a.action] || a.action)}</td>
      <td>${a.mapName ? esc(a.mapName) : '<span class="muted">—</span>'}</td>
      <td class="wrap">${auditDetail(a) || '<span class="muted">—</span>'}</td>
    </tr>`).join('')}</tbody></table>`;
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

  const rows = s.maps.map((m) => `<tr>
      <td><strong>${esc(m.name)}</strong><div class="sub">#${m.id} · ${esc(m.kind)} · ${m.versions} version(s)</div></td>
      <td>${mb(m.bytes.data)}</td><td>${mb(m.bytes.renders)}</td>
      <td>${mb(m.bytes.staged)}</td><td>${mb(m.bytes.archived)}</td>
      <td><strong>${mb(m.bytes.total)}</strong></td>
    </tr>`).join('');

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
    <div class="table-wrap" style="margin-top:14px"><table class="grid"><thead><tr>
      <th>Map</th><th>Data</th><th>Renders</th><th>Staged</th><th>Archived</th><th>Total</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="6">No maps with an object store yet.</td></tr>'}</tbody></table></div>`;
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
