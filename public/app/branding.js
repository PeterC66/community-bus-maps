// Public details (P6): a customer edits its own public identity. The server
// whitelist (src/branding/index.js) is the real gate — it rebuilds the stored
// object and reports anything it dropped, which we surface here.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = { branding: {}, accents: [], customer: null, preview: null };

function note(kind, text) {
  const m = $('msg');
  m.className = 'notice ' + (kind ? kind + ' show' : '');
  m.textContent = text || '';
}

function paintAccents() {
  $('accents').innerHTML = state.accents.map((a) => `
    <label class="accent ${state.branding.accent === a.key ? 'on' : ''}" title="${esc(a.label)}">
      <input type="radio" name="accent" value="${esc(a.key)}" ${state.branding.accent === a.key ? 'checked' : ''}>
      <span class="dot-swatch" style="background:${esc(a.hex)}"></span>${esc(a.label)}
    </label>`).join('');
  $('accents').querySelectorAll('input[name=accent]').forEach((r) => r.addEventListener('change', () => {
    state.branding.accent = r.value;
    paintAccents(); paintPreview();
  }));
}

// Mirrors brandingForPublic() closely enough for a live preview; the saved
// response replaces it with the server's own version.
function paintPreview() {
  const p = state.preview || {};
  const name = $('publicName').value.trim() || (state.customer && state.customer.name) || 'Your organisation';
  const badge = $('emoji').value.trim() || initials(name);
  const accent = state.accents.find((a) => a.key === (state.branding.accent || (p.accent || 'blue')));
  $('preview').innerHTML = `<span class="org-badge" style="--org-accent:${esc(accent ? accent.hex : '#1b4db3')}">${esc(badge)}</span>
    <span>Published by <a href="#" onclick="return false">${esc(name)}</a>${$('website').value.trim() ? ' · <a href="#" onclick="return false">their website</a>' : ''}</span>`;
  $('previewBlurb').textContent = $('blurb').value.trim();
}

function initials(name) {
  const w = String(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return w.slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '•';
}

function paintPublicList(maps) {
  const box = $('publicList');
  if (!maps || !maps.length) {
    box.innerHTML = '<p class="hint-line">None of your maps are on the public site yet. A map appears here once a version has been reviewed and you have left it listed.</p>';
    return;
  }
  box.innerHTML = `<ul class="plain-list">${maps.map((m) => `
    <li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}</a>
      <span class="muted">· ${esc(m.kind === 'place' ? 'place' : 'area')} · ${esc(m.version)}</span></li>`).join('')}</ul>`;
}

$('brandForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  const branding = {
    publicName: $('publicName').value.trim(),
    blurb: $('blurb').value.trim(),
    website: $('website').value.trim(),
    emoji: $('emoji').value.trim(),
    accent: state.branding.accent || '',
  };
  for (const k of Object.keys(branding)) if (!branding[k]) delete branding[k];
  try {
    const res = await fetch('/api/customer/branding', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branding }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) {
      state.branding = b.branding; state.preview = b.preview;
      fill();
      note('ok', b.rejected && b.rejected.length
        ? `Saved. We could not use: ${b.rejected.join(', ')} — please check those.`
        : 'Saved — your public pages now show these details.');
    } else note('err', (b && b.error) || 'Could not save your public details.');
  } catch { note('err', 'Network error while saving.'); }
  finally { btn.disabled = false; btn.textContent = 'Save public details'; }
});

function fill() {
  const b = state.branding || {};
  $('publicName').value = b.publicName || '';
  $('blurb').value = b.blurb || '';
  $('website').value = b.website || '';
  $('emoji').value = b.emoji || '';
  if (!b.accent && state.preview) state.branding.accent = state.preview.accent;
  paintAccents(); paintPreview();
}

['publicName', 'blurb', 'website', 'emoji'].forEach((id) => $(id).addEventListener('input', paintPreview));

function settingsNote(kind, text) {
  const m = $('settingsMsg');
  m.className = 'notice ' + (kind ? kind + ' show' : '');
  m.textContent = text || '';
}

$('settingsSaveBtn').addEventListener('click', async () => {
  const btn = $('settingsSaveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/customer/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watermarkEnabled: !$('watermarkFree').checked }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok && b.ok) {
      $('watermarkFree').checked = !b.watermarkEnabled;
      settingsNote('ok', 'Saved.');
    } else settingsNote('err', (b && b.error) || 'Could not save this setting.');
  } catch { settingsNote('err', 'Network error while saving.'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/app/login.html';
});

(async () => {
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) { location.href = '/app/login.html'; return; }
    const me = (await r.json()).user;
    $('whoami').textContent = me.customer ? `${me.email} · ${me.customer.name}` : `${me.email} · ${me.role}`;
    $('logoutBtn').style.display = '';
    if (!me.customer) {
      document.querySelector('.editor').innerHTML = '<p class="hint-line">Public branding belongs to a customer organisation. Platform accounts have none — open a customer’s map instead.</p>';
      return;
    }
  } catch { note('err', 'Could not reach the server.'); return; }

  try {
    const res = await fetch('/api/customer/branding');
    const b = await res.json();
    if (!res.ok || !b.ok) { note('err', (b && b.error) || 'Could not load your public details.'); return; }
    state = { branding: b.branding || {}, accents: b.accents || [], customer: b.customer, preview: b.preview };
    $('nameHint').textContent = `Leave blank to use “${b.customer.name}”.`;
    $('watermarkFree').checked = !b.customer.watermarkEnabled;
    if (b.customer.publicUrl) {
      $('viewPublic').href = b.customer.publicUrl;
      $('viewPublic').style.display = (b.publicMaps && b.publicMaps.length) ? '' : 'none';
    }
    fill();
    paintPublicList(b.publicMaps);
  } catch { note('err', 'Could not load your public details.'); }
})();
