// Review console (P4). Approvers/admins review a submitted map version before
// it becomes the official public version. Gated to approver/admin; the server
// independently enforces the role and the completed-checklist requirement.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? s : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtTime = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Say up front whether this sign-in is fresh enough to publish with.
 *
 * Publishing needs a sign-in from the last `stepUpMinutes`, and until 2026-08-22
 * the only thing that ever mentioned it was the 403 raised by the Publish button —
 * i.e. after opening every sheet and ticking the whole checklist, which is the
 * entire cost of a review, and then having to redo it. The server has always known
 * the answer; the screen just never asked.
 *
 * Phrased against the DEADLINE rather than a yes/no, because the window is anchored
 * on when the session was created and can therefore run out midway through a review.
 * "Good until 14:05" stays true as the clock moves; "you are fine" would not.
 */
function stepUpHtml(r) {
  if (r.stepUpFresh === undefined) return '';           // older server, say nothing
  if (!r.stepUpFresh) {
    return `<p class="rd-note rd-warn"><strong>You will not be able to publish this without signing in again.</strong>
      Publishing needs a sign-in from the last ${esc(r.stepUpMinutes)} minutes and yours is older.
      <strong>Do it before you start reviewing</strong> — sign out, follow a fresh sign-in link and come back here,
      or you will tick the whole checklist and be turned away at the last step. Sending it back to the editor still works.</p>`;
  }
  const until = fmtTime(r.stepUpExpiresAt);
  return until
    ? `<p class="rd-note">Your sign-in lets you publish until <strong>${esc(until)}</strong>. After that you will need a fresh sign-in link.</p>`
    : '';
}

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
let currentPublished = null; // the map whose publication history is open (rollback view)

// ---- queue ------------------------------------------------------------------
async function loadQueue(keepId) {
  const { body } = await jget('/api/review/queue');
  queue = (body && body.requests) || [];
  $('queueCount').textContent = queue.length || '';
  const box = $('queue');
  if (!queue.length) {
    box.innerHTML = '<div class="empty">Nothing awaiting review. 🎉</div>';
    // Don't clobber a rollback view the approver is working in.
    if (!keepId && !currentPublished) $('detail').innerHTML = '<div class="empty">Nothing to review right now. Pick a published map to see its history.</div>';
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

// A submitted version differs from the published one in two independent ways: the
// DATA it was rebuilt from (an accepted refresh) and the customer's own overrides.
// Showing only the second told the approver a refreshed map had "nothing to change"
// — the one screen that should say "the timetable moved" said the opposite.
function changeHtml(sum, pubKey) {
  const base = sum.base === 'published' ? `the published version (${esc(pubKey)})` : 'the original map';
  if (sum.unchanged) return `<p class="hint-line">⚠ This version is identical to ${base} — there is nothing to change.</p>`;
  const dataHtml = window.PortalChanges ? window.PortalChanges.dataChangeHtml(sum.dataChanges, { detail: true }) : '';
  const rows = [];
  for (const r of sum.routes) {
    rows.push(`<li>Route <strong>${esc(r.id)}</strong>: ${swatch(r.from)} ${esc(r.from)} → ${swatch(r.to)} ${esc(r.to)}${r.default && r.to === r.default ? ' <span class="muted">(back to default)</span>' : ''}</li>`);
  }
  for (const k of sum.poisHidden) rows.push(`<li>Hide landmark <strong>${esc(k)}</strong></li>`);
  for (const k of sum.poisShown) rows.push(`<li>Show landmark <strong>${esc(k)}</strong></li>`);
  const yours = rows.length
    ? `${dataHtml ? '<div class="change-title">What the customer changed</div>' : ''}<ul class="change-list detail">${rows.join('')}</ul>`
    : (dataHtml ? '<p class="hint-line">The customer made no changes of their own to this version.</p>' : '');
  return dataHtml + yours;
}

// How many sheets this one decision covers. The list below shows them as
// separate items, and nothing said they publish together (findings H1).
/**
 * WHAT THE ENGINE THOUGHT OF THIS BUILD (OA-046).
 *
 * The bus skill writes build-warnings.txt beside every run, and until 2026-08-30
 * nothing downstream read it: 161 of them on the map tree, zero mentions of the
 * name anywhere in the portal. This screen is the one place a human has already
 * agreed to look at a sheet, so it is where the verdict belongs.
 *
 * THREE STATES, AND THE THIRD IS THE ONE WORTH THE CODE. A pack that carries no
 * file says so, in as many words, instead of showing nothing — because "no
 * warnings" and "we do not know" look identical when the answer is absent, and
 * the second is the one that should make an approver ask. A false zero here
 * would tell somebody the engine was happy with a sheet it had refused to draw.
 */
function buildWarningsHtml(bw) {
  if (bw === undefined) return '';   // older server, say nothing at all
  if (bw === null) {
    return `<p class="rd-note">The engine's build report did not travel with this version, so there is
      <strong>no record here of what it warned about</strong>. That is not the same as a clean build.
      Packs delivered before 2026-08-30 carry none.</p>`;
  }
  if (bw.blocking > 0) {
    return `<p class="rd-note rd-warn"><strong>The engine refused to draw ${bw.blocking} thing${bw.blocking === 1 ? '' : 's'} on this build.</strong>
      BLOCKING means a sheet is wrong in a way the reader cannot see — a symbol missing, or a label naming nothing.
      Look at the sheets below with these in mind before you sign anything off.</p>
      <ul class="rd-warn-list">${bw.blockingLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  }
  if (bw.total > 0) {
    return `<p class="hint-line">The engine reported ${bw.total} warning${bw.total === 1 ? '' : 's'} on this build and
      <strong>none of them blocking</strong> — nothing it refused to draw.</p>`;
  }
  return '<p class="hint-line">The engine reported no warnings on this build.</p>';
}

function sheetCount(inspect) {
  return new Set(inspect.filter((d) => /\.(svg|jpg)$/.test(d.file)).map((d) => d.file.replace(/\.(svg|jpg)$/, ''))).size;
}

function inspectHtml(inspect) {
  const jpgs = inspect.filter((d) => d.file.endsWith('.jpg'));
  const svgs = inspect.filter((d) => d.file.endsWith('.svg'));
  const imgs = jpgs.map((d) => `
    <figure class="inspect-fig">
      <a href="${d.url}" target="_blank" rel="noopener"><img loading="lazy" src="${d.url}" alt="${esc(d.file)}"></a>
      <figcaption>${esc(d.file)} <a href="${d.url}" target="_blank" rel="noopener">view full-size ↗ (opens in a new tab)</a> · <a href="${d.url}?download" download>download</a></figcaption>
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
  currentPublished = null;
  const r = body.request, sum = body.changeSummary, checklist = body.checklist;
  $('queue').querySelectorAll('.queue-item').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === id));
  $('published').querySelectorAll('.queue-item').forEach((b) => b.classList.remove('active'));

  const decided = r.status !== 'pending';
  const sheets = sheetCount(body.inspect);
  box.innerHTML = `
    <div class="rd-head">
      <h2>${esc(r.map.name)} <span class="tag ${r.map.kind === 'place' ? 'place' : 'area'}">${r.map.kind === 'place' ? 'Place' : 'Area'}</span></h2>
      <div class="rd-meta">${esc(r.customer ? r.customer.name : '—')} · version <strong>${esc(r.version)}</strong>${r.publishedVersion ? ' · currently published ' + esc(r.publishedVersion) : ' · not yet published'}</div>
      <div class="rd-meta">Submitted by ${esc(r.requestedBy || '—')} on ${fmtDate(r.createdAt)}</div>
      ${r.note ? `<p class="rd-note">“${esc(r.note)}”</p>` : ''}
      ${!decided && r.selfReview ? (r.selfApprovalAllowed
        ? '<p class="rd-note"><strong>You submitted this version.</strong> There is no second pair of eyes on this review, so publishing it will be recorded in the audit trail as a self-approval.</p>'
        : '<p class="rd-note"><strong>You submitted this version, so you cannot publish it.</strong> Another approver has to review it. You can still send it back to the editor.</p>') : ''}
      ${!decided ? stepUpHtml(r) : ''}
    </div>

    <div class="rd-section">
      <h3>Changes to review</h3>
      ${changeHtml(sum, r.publishedVersion)}
    </div>

    <div class="rd-section">
      <h3>Inspect the print-ready output</h3>
      <p class="hint-line">Open each sheet full-size and check it prints correctly.${sheets > 1
        ? ` <strong>One decision covers all ${sheets} sheets of this map</strong> — there is no way to publish one and hold another back.`
        : ''}</p>
      ${buildWarningsHtml(body.buildWarnings)}
      ${inspectHtml(body.inspect)}
      <div class="dl-row" style="margin-top:8px"><a class="dl" href="/app/review-services.html?id=${r.id}" target="_blank" rel="noopener">↗ Open services and stops list (opens in a new tab)</a></div>
    </div>

    ${decided ? renderDecided(r) : `
    <div class="rd-section">
      <h3>Review checklist</h3>
      <p class="hint-line">This is a visual check, not an independent verification against timetables — it confirms nothing here looks wrong or out of date, not that the underlying data was re-checked.</p>
      <div class="checklist" id="checklist">
        ${checklist.map((c) => `<label class="check-item"><input type="checkbox" data-cid="${esc(c.id)}"> <span>${esc(c.label)}</span></label>`).join('')}
      </div>
      <label class="hint-line" for="decisionNote" style="display:block;margin-top:12px">Notes <span class="hint">— required if rejecting; recorded either way</span></label>
      <textarea class="field" id="decisionNote" maxlength="2000" placeholder="Any notes on this review, or the reason for sending it back…"></textarea>
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
    ${ev ? `<p class="hint-line">Review checklist recorded (${ev} item${ev === 1 ? '' : 's'}).</p>` : ''}
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
      current = null; await loadQueue(); await loadPublished();
      $('detail').innerHTML = '<div class="empty">Published. Pick the next submission to review.</div>';
    } else {
      const m = $('reviewMsg'); m.className = 'notice err show';
      // src/server.js's requireStepUp() says `code: 'step-up-required'` "is what the
      // UI keys on". Nothing did, until 2026-08-22 — the raw sentence was shown and
      // the ticked checklist was left on screen with no hint it would survive. It
      // does: signing in again in another tab and pressing Publish once more works,
      // and saying so is the difference between a re-review and a reload.
      if (status === 403 && body && body.code === 'step-up-required') {
        m.innerHTML = `${esc(body.error)}<br><strong>Your ticks are kept.</strong> Sign in again in another tab, come back to this one and press Publish — you do not have to review it a second time.`;
      } else {
        m.textContent = (body && body.error) || 'Publish failed.';
      }
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

// ---- rollback (incident response) -------------------------------------------
// Reverting moves the PUBLIC pointer back to a version an approver already signed
// off; it never publishes anything new and never touches the editor's head. The
// server re-checks both (reviewed + files on disk) before it moves anything.

async function loadPublished(keepId) {
  const { body } = await jget('/api/review/published');
  const maps = (body && body.maps) || [];
  const box = $('published');
  if (!maps.length) { box.innerHTML = '<div class="empty">No maps are published yet.</div>'; return; }
  box.innerHTML = maps.map((m) => `
    <button class="queue-item ${m.id === keepId ? 'active' : ''}" data-map="${m.id}" type="button">
      <div class="qi-title">${esc(m.name)} <span class="tag ${m.kind === 'place' ? 'place' : 'area'}">${m.kind === 'place' ? 'Place' : 'Area'}</span></div>
      <div class="qi-sub">${esc(m.customer ? m.customer.name : '—')} · published ${esc(m.publishedVersion)}</div>
      <div class="qi-meta">${m.canRevert ? `${m.publishedVersions} reviewed versions` : 'first published version'}${m.publicListed ? '' : ' · un-listed'}${m.customerSuspended ? ' · customer suspended' : ''}</div>
    </button>`).join('');
  box.querySelectorAll('.queue-item').forEach((b) => b.addEventListener('click', () => openPublished(Number(b.dataset.map))));
}

async function openPublished(mapId) {
  const box = $('detail');
  box.innerHTML = '<div class="empty">Loading publication history…</div>';
  const { status, body } = await jget(`/api/review/maps/${mapId}/published-history`);
  if (status !== 200 || !body.ok) { box.innerHTML = `<div class="empty">${esc((body && body.error) || 'Could not load this map.')}</div>`; return; }
  current = null;
  currentPublished = mapId;
  $('queue').querySelectorAll('.queue-item').forEach((b) => b.classList.remove('active'));
  $('published').querySelectorAll('.queue-item').forEach((b) => b.classList.toggle('active', Number(b.dataset.map) === mapId));

  const m = body.map, history = body.history;
  const rows = history.map((h) => {
    const badge = h.isCurrent ? '<span class="status-pill pub">published now</span>'
      : h.files.length ? '<span class="status-pill">earlier version</span>'
      : '<span class="status-pill rej">files missing</span>';
    const jpgs = h.files.filter((f) => f.file.endsWith('.jpg'))
      .map((f) => `<a href="${f.url}" target="_blank" rel="noopener">${esc(f.file)}</a>`).join(' · ');
    return `<div class="gt-row" role="row">
      <div class="gt-cell" role="cell"><strong>${esc(h.version)}</strong> ${badge}</div>
      <div class="gt-cell" role="cell">${fmtDate(h.publishedAt)}<div class="qi-meta">${esc(h.approver || '—')}</div></div>
      <div class="gt-cell wrap" role="cell">${esc(h.decisionNote || '') || '<span class="muted">—</span>'}<div class="qi-meta">${jpgs || ''}</div></div>
      <div class="gt-cell actions" role="cell">${h.revertable
        ? `<button class="btn btn-ghost btn-xs" data-revert="${h.versionId}" data-ver="${esc(h.version)}" type="button">Revert to this</button>`
        : ''}</div>
    </div>`;
  }).join('');

  const target = history.find((h) => h.revertable);
  box.innerHTML = `
    <div class="rd-head">
      <h2>${esc(m.name)} <span class="tag ${m.kind === 'place' ? 'place' : 'area'}">${m.kind === 'place' ? 'Place' : 'Area'}</span></h2>
      <div class="rd-meta">${esc(m.customer ? m.customer.name : '—')} · published <strong>${esc(m.publishedVersion || '—')}</strong> · editor's latest ${esc(m.currentVersion || '—')}</div>
      <div class="rd-meta">${m.publicUrl ? `Public page: <a href="${esc(m.publicUrl)}" target="_blank" rel="noopener">${esc(m.publicUrl)}</a>` : 'Not on the public site right now.'}</div>
    </div>

    <div class="rd-section">
      <h3>Publication history</h3>
      <p class="hint-line">Reverting changes only what the public is served. It does not undo the customer's edits, and only versions that already passed review are offered.</p>
      <div class="table-wrap"><div class="grid-table" role="table" style="grid-template-columns:16% 20% 44% 20%"><div class="gt-row gt-head" role="row">
        <div class="gt-cell" role="columnheader">Version</div><div class="gt-cell" role="columnheader">Reviewed</div><div class="gt-cell" role="columnheader">Approver's note</div><div class="gt-cell" role="columnheader"></div>
      </div>${rows}</div></div>
    </div>

    <div class="rd-section">
      <h3>Revert${target ? ` to ${esc(target.version)}` : ''}</h3>
      ${target ? `
      <label class="hint-line" for="revertReason" style="display:block">Reason <span class="hint">— required; recorded in the audit trail for the incident log</span></label>
      <textarea class="field" id="revertReason" maxlength="2000" placeholder="e.g. Route 55 shown with the wrong terminus in v1.4 — restoring v1.3 while a correction is prepared."></textarea>
      <div class="notice" id="revertMsg"></div>
      <p class="hint-line">Remember: un-listing takes a wrong map off the public site fastest. Reverting is the fix that puts a correct sheet back.</p>`
      : '<p class="hint-line">This map has only ever published one version, so there is nothing to roll back to. Publish a corrected version through the gate instead.</p>'}
    </div>`;

  box.querySelectorAll('button[data-revert]').forEach((b) =>
    b.addEventListener('click', () => doRevert(mapId, Number(b.dataset.revert), b.dataset.ver)));
}

async function doRevert(mapId, versionId, version) {
  const field = $('revertReason');
  const reason = field ? field.value.trim() : '';
  const msg = $('revertMsg');
  if (!reason) {
    if (msg) { msg.className = 'notice err show'; msg.textContent = 'Please record why you are reverting.'; }
    if (field) field.focus();
    return;
  }
  if (!confirm(`Serve ${version} to the public again? The current published version stops being served immediately.`)) return;
  const { status, body } = await jsend(`/api/review/maps/${mapId}/revert`, 'POST', { versionId, reason });
  if (status === 200 && body.ok) {
    banner('ok-sticky', `✓ Reverted to <strong>${esc(body.publishedVersion)}</strong>${body.revertedFrom ? ` (was ${esc(body.revertedFrom)})` : ''}. ${body.publicListed ? 'It is live on the public page now.' : 'The map is still un-listed, so nothing is public until you re-list it.'}`);
    await loadPublished(mapId);
    await openPublished(mapId);
  } else if (msg) {
    msg.className = 'notice err show'; msg.textContent = (body && body.error) || 'Revert failed.';
  }
}

// ---- init -------------------------------------------------------------------
$('refreshBtn').addEventListener('click', () => { loadQueue(); loadPublished(); });
$('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/login.html'; });
(async () => {
  const { status, body } = await jget('/api/me');
  if (status === 401) { location.href = '/app/login.html'; return; }
  const me = body.user;
  if (!me || (me.role !== 'approver' && me.role !== 'admin')) { location.href = '/app'; return; }
  $('whoami').textContent = `${me.email} · ${me.role}`;
  if (me.role === 'admin') $('adminLink').style.display = '';
  $('logoutBtn').style.display = '';
  if (window.EEV) window.EEV.apply(); // H9 — after role-based nav visibility is set
  await loadQueue();
  await loadPublished();
})();
