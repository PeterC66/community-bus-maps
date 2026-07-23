// Review console (P4). Approvers/admins sign off a submitted map version before
// it becomes the official public version. Gated to approver/admin; the server
// independently enforces the role and the completed-checklist requirement.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? s : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
async function jget(url) { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function jsend(url, method, data) {
  const r = await fetch(url, { method, headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let bt = null;
function banner(kind, html) {
  const el = $('banner'); el.className = 'notice show ' + (kind === 'ok-sticky' ? 'ok' : kind); el.innerHTML = html;
  clearTimeout(bt); if (kind !== 'ok-sticky') bt = setTimeout(() => { el.className = 'notice'; }, 8000);
}

let queue = [];
let current = null; // the open review detail

// ---- queue ------------------------------------------------------------------
async function loadQueue(keepId) {
  const { body } = await jget('/api/review/queue');
  queue = (body && body.requests) || [];
  $('queueCount').textContent = queue.length || '';
  const box = $('queue');
  if (!queue.length) {
    box.innerHTML = '<div class="empty">Nothing awaiting sign-off. 🎉</div>';
    if (!keepId) $('detail').innerHTML = '<div class="empty">Nothing to review right now.</div>';
    return;
  }
  box.innerHTML = queue.map((r) => `
    <button class="queue-item ${r.id === (current && current.id) ? 'active' : ''}" data-id="${r.id}" type="button">
      <div class="qi-title">${esc(r.map_name)} <span class="tag ${r.map_kind === 'place' ? 'place' : 'area'}">${r.map_kind === 'place' ? 'Place' : 'Area'}</span></div>
      <div class="qi-sub">${esc(r.customer_name || '—')} · ${esc(r.version_key)}</div>
      <div class="qi-meta">${esc(r.requested_by_email || '')} · ${fmtDate(r.created_at)}</div>
    </button>`).join('');
  box.querySelectorAll('.queue-item').forEach((b) => b.addEventListener('click', () => openReview(Number(b.dataset.id))));
}

// ---- detail -----------------------------------------------------------------
function swatch(hex) { return `<span class="mini-swatch" style="background:${esc(hex)}"></span>`; }

function changeHtml(sum, pubKey) {
  const base = sum.base === 'published' ? `the published version (${esc(pubKey)})` : 'the original map';
  if (sum.unchanged) return `<p class="hint-line">⚠ This version is identical to ${base} — there is nothing to change.</p>`;
  const rows = [];
  for (const r of sum.routes) {
    rows.push(`<li>Route <strong>${esc(r.id)}</strong>: ${swatch(r.from)} ${esc(r.from)} → ${swatch(r.to)} ${esc(r.to)}${r.default && r.to === r.default ? ' <span class="muted">(back to default)</span>' : ''}</li>`);
  }
  for (const k of sum.poisHidden) rows.push(`<li>Hide landmark <strong>${esc(k)}</strong></li>`);
  for (const k of sum.poisShown) rows.push(`<li>Show landmark <strong>${esc(k)}</strong></li>`);
  return `<ul class="change-list detail">${rows.join('')}</ul>`;
}

function inspectHtml(inspect) {
  const jpgs = inspect.filter((d) => d.file.endsWith('.jpg'));
  const svgs = inspect.filter((d) => d.file.endsWith('.svg'));
  const imgs = jpgs.map((d) => `
    <figure class="inspect-fig">
      <a href="${d.url}" target="_blank" rel="noopener"><img loading="lazy" src="${d.url}" alt="${esc(d.file)}"></a>
      <figcaption>${esc(d.file)} <a href="${d.url}?download" download>download</a></figcaption>
    </figure>`).join('');
  const svgLinks = svgs.map((d) => `<a class="dl" href="${d.url}?download" download>⬇ ${esc(d.file)}</a>`).join(' ');
  return `<div class="inspect-grid">${imgs || '<p class="hint-line">No print files found for this version.</p>'}</div>
    ${svgLinks ? `<div class="dl-row" style="margin-top:8px">${svgLinks}</div>` : ''}`;
}

async function openReview(id) {
  const box = $('detail');
  box.innerHTML = '<div class="empty">Loading submission…</div>';
  const { status, body } = await jget('/api/review/' + id);
  if (status !== 200 || !body.ok) { box.innerHTML = `<div class="empty">${esc((body && body.error) || 'Could not load this submission.')}</div>`; return; }
  current = body.request;
  const r = body.request, sum = body.changeSummary, checklist = body.checklist;
  $('queue').querySelectorAll('.queue-item').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === id));

  const decided = r.status !== 'pending';
  box.innerHTML = `
    <div class="rd-head">
      <h2>${esc(r.map.name)} <span class="tag ${r.map.kind === 'place' ? 'place' : 'area'}">${r.map.kind === 'place' ? 'Place' : 'Area'}</span></h2>
      <div class="rd-meta">${esc(r.customer ? r.customer.name : '—')} · version <strong>${esc(r.version)}</strong>${r.publishedVersion ? ' · currently published ' + esc(r.publishedVersion) : ' · not yet published'}</div>
      <div class="rd-meta">Submitted by ${esc(r.requestedBy || '—')} on ${fmtDate(r.createdAt)}</div>
      ${r.note ? `<p class="rd-note">“${esc(r.note)}”</p>` : ''}
    </div>

    <div class="rd-section">
      <h3>Changes to sign off</h3>
      ${changeHtml(sum, r.publishedVersion)}
    </div>

    <div class="rd-section">
      <h3>Inspect the print-ready output</h3>
      <p class="hint-line">Open each sheet full-size and check it prints correctly.</p>
      ${inspectHtml(body.inspect)}
    </div>

    ${decided ? renderDecided(r) : `
    <div class="rd-section">
      <h3>Sign-off checklist</h3>
      <div class="checklist" id="checklist">
        ${checklist.map((c) => `<label class="check-item"><input type="checkbox" data-cid="${esc(c.id)}"> <span>${esc(c.label)}</span></label>`).join('')}
      </div>
      <label class="hint-line" for="decisionNote" style="display:block;margin-top:12px">Notes <span class="hint">— required if rejecting; recorded either way</span></label>
      <textarea class="field" id="decisionNote" maxlength="2000" placeholder="Any notes on this sign-off, or the reason for sending it back…"></textarea>
      <div class="notice" id="reviewMsg"></div>
      <div class="rd-actions">
        <button class="btn btn-ghost btn-sm" id="rejectBtn" type="button">Send back to editor</button>
        <span class="grow"></span>
        <button class="btn btn-primary btn-sm" id="approveBtn" type="button" disabled>Publish version ${esc(r.version)}</button>
      </div>
    </div>`}`;

  if (!decided) wireDecision(id, r.version);
}

function renderDecided(r) {
  const pill = r.status === 'approved' ? '<span class="status-pill pub">published</span>'
    : r.status === 'rejected' ? '<span class="status-pill rej">sent back</span>'
    : `<span class="status-pill">${esc(r.status)}</span>`;
  const ev = r.evidence && r.evidence.checklist ? Object.keys(r.evidence.checklist).length : 0;
  return `<div class="rd-section">
    <h3>Decision ${pill}</h3>
    <div class="rd-meta">${esc(r.reviewedBy || '—')} · ${fmtDate(r.reviewedAt)}</div>
    ${r.decisionNote ? `<p class="rd-note">“${esc(r.decisionNote)}”</p>` : ''}
    ${ev ? `<p class="hint-line">Sign-off checklist recorded (${ev} item${ev === 1 ? '' : 's'}).</p>` : ''}
  </div>`;
}

function wireDecision(id, version) {
  const boxes = [...document.querySelectorAll('#checklist input[type=checkbox]')];
  const approve = $('approveBtn');
  const allChecked = () => boxes.every((b) => b.checked);
  boxes.forEach((b) => b.addEventListener('change', () => { approve.disabled = !allChecked(); }));

  approve.addEventListener('click', async () => {
    if (!allChecked()) return;
    const checklist = {}; boxes.forEach((b) => { checklist[b.dataset.cid] = true; });
    approve.disabled = true; approve.textContent = 'Publishing…';
    const { status, body } = await jsend(`/api/review/${id}/approve`, 'POST', { checklist, note: $('decisionNote').value });
    if (status === 200 && body.ok) {
      banner('ok-sticky', `✓ Published <strong>${esc(version)}</strong>. It is now the official public version.`);
      current = null; await loadQueue(); $('detail').innerHTML = '<div class="empty">Published. Pick the next submission to review.</div>';
    } else {
      const m = $('reviewMsg'); m.className = 'notice err show'; m.textContent = (body && body.error) || 'Publish failed.';
      approve.disabled = false; approve.textContent = `Publish version ${version}`;
    }
  });

  $('rejectBtn').addEventListener('click', async () => {
    const note = $('decisionNote').value.trim();
    if (!note) { const m = $('reviewMsg'); m.className = 'notice err show'; m.textContent = 'Please give a reason so the editor knows what to change.'; return; }
    if (!confirm('Send this version back to the editor? They will be able to edit and resubmit.')) return;
    const { status, body } = await jsend(`/api/review/${id}/reject`, 'POST', { note });
    if (status === 200 && body.ok) {
      banner('warn', `Sent ${esc(version)} back to the editor.`);
      current = null; await loadQueue(); $('detail').innerHTML = '<div class="empty">Sent back. Pick the next submission to review.</div>';
    } else {
      const m = $('reviewMsg'); m.className = 'notice err show'; m.textContent = (body && body.error) || 'Could not send it back.';
    }
  });
}

// ---- init -------------------------------------------------------------------
$('refreshBtn').addEventListener('click', () => loadQueue());
$('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/login.html'; });
(async () => {
  const { status, body } = await jget('/api/me');
  if (status === 401) { location.href = '/app/login.html'; return; }
  const me = body.user;
  if (!me || (me.role !== 'approver' && me.role !== 'admin')) { location.href = '/app'; return; }
  $('whoami').textContent = `${me.email} · ${me.role}`;
  if (me.role === 'admin') $('adminLink').style.display = '';
  $('logoutBtn').style.display = '';
  await loadQueue();
})();
