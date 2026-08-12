// Rendering the "what changed" account, shared by the customer's editor and the
// approver's review screen (both include this file before their own script).
//
// Why it exists: a version made by accepting a data refresh differs from the
// published one in its DATA, not in the customer's overrides. Until the server
// started carrying that diff (map_version.data_change_json), both screens compared
// overrides alone and announced that a fully-rebuilt map was identical to the one
// already public — see findings A1. Everything below is a read-out of what the
// accept step already recorded; nothing here recomputes a diff.
(function (w) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const asLines = (v) => (Array.isArray(v) ? v : [v]).filter((x) => x != null && x !== '').map(String);
  const joinDesc = (v) => asLines(v).join(' · ');

  function fmtDay(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
    return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // One refresh, as plain-language bullets. `detail` adds the exact before/after
  // wording — the approver's screen is the one place that must show it.
  function bullets(s, detail) {
    const out = [];
    const n = (k) => (Array.isArray(s[k]) ? s[k].length : 0);
    if (n('routesAdded')) out.push(`<li><strong>${plural(n('routesAdded'), 'route')} added</strong> <span class="muted">(${esc(s.routesAdded.join(', '))})</span></li>`);
    if (n('routesRemoved')) out.push(`<li><strong>${plural(n('routesRemoved'), 'route')} removed</strong> <span class="muted">(${esc(s.routesRemoved.join(', '))})</span></li>`);
    if (n('stopsChanged')) {
      const list = s.stopsChanged.map((c) => {
        const bits = [];
        if (c.added) bits.push(`+${c.added}`);
        if (c.removed) bits.push(`−${c.removed}`);
        return `${esc(c.id)}${bits.length ? ' (' + bits.join(' ') + ')' : ''}`;
      }).join(', ');
      const c = n('stopsChanged');
      out.push(`<li><strong>${plural(c, 'route')}</strong> now call${c === 1 ? 's' : ''} at different stops <span class="muted">(${list})</span></li>`);
    }
    if (n('descChanged')) {
      if (detail) {
        for (const d of s.descChanged) {
          out.push(`<li>Route <strong>${esc(d.id)}</strong> description reworded:
            <div class="chg-text"><span class="chg-from">${esc(joinDesc(d.from)) || '<em>nothing</em>'}</span>
            <span class="chg-arrow">→</span>
            <span class="chg-to">${esc(joinDesc(d.to)) || '<em>nothing</em>'}</span></div></li>`);
        }
      } else {
        out.push(`<li><strong>${plural(n('descChanged'), 'service description')} reworded</strong> <span class="muted">(${esc(s.descChanged.map((d) => d.id).join(', '))})</span></li>`);
      }
    }
    if (n('operatorsAdded')) out.push(`<li><strong>${plural(n('operatorsAdded'), 'operator')} added</strong> <span class="muted">(${esc(s.operatorsAdded.join(', '))})</span></li>`);
    if (n('operatorsRemoved')) out.push(`<li><strong>${plural(n('operatorsRemoved'), 'operator')} removed</strong> <span class="muted">(${esc(s.operatorsRemoved.join(', '))})</span></li>`);
    if (s.validity && (s.validity.to || s.validity.from)) {
      out.push(`<li>Valid from <strong>${esc(s.validity.from) || '—'}</strong> → <strong>${esc(s.validity.to) || '—'}</strong></li>`);
    }
    return out;
  }

  /**
   * The data half of "what changed": every accepted refresh this version carries.
   * @param {Array} dataChanges  from changeSummary().dataChanges (oldest first)
   * @param {{detail?:boolean}} opts  detail = show exact old→new wording
   */
  function dataChangeHtml(dataChanges, opts) {
    const list = Array.isArray(dataChanges) ? dataChanges : [];
    if (!list.length) return '';
    const detail = !!(opts && opts.detail);
    const blocks = list.map((d) => {
      const rows = bullets(d.summary || {}, detail);
      const when = fmtDay(d.createdAt);
      const src = d.sourceNote ? ` <span class="muted">— ${esc(d.sourceNote)}</span>` : '';
      return `<div class="chg-refresh">
        <div class="chg-when">${esc(d.version)} · timetable data refreshed${when ? ' ' + esc(when) : ''}${src}</div>
        <ul class="change-list detail">${rows.join('') || '<li class="muted">Rebuilt from newer data; no service facts differ.</li>'}</ul>
      </div>`;
    }).join('');
    const title = list.length === 1 ? 'What changed in the map data' : `What changed in the map data <span class="muted">(${list.length} updates)</span>`;
    return `<div class="change-box data-change">
      <div class="change-title">${title}</div>
      ${blocks}
      <p class="hint-line">These came from the timetable data, not from an edit anyone made here.</p>
    </div>`;
  }

  w.PortalChanges = { dataChangeHtml, esc };
}(window));
