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

  // SQLite datetime('now') is UTC without a zone marker; say so before parsing or
  // the browser reads it as local time and the ageing is out by an hour.
  function parseStamp(iso) {
    if (!iso) return null;
    const s = String(iso);
    const d = new Date(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T') + 'Z');
    return isNaN(d) ? null : d;
  }
  function fmtDay(iso) {
    const d = parseStamp(iso);
    return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : String(iso || '');
  }
  /** Whole days between `iso` and now (0 = today). */
  function daysAgo(iso) {
    const d = parseStamp(iso);
    return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null;
  }
  /** "today" / "yesterday" / "3 days" — for saying how long something has sat. */
  function ageText(iso) {
    const n = daysAgo(iso);
    if (n == null) return '';
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days`;
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
    for (const b of landmarkBullets(s)) out.push(b);
    return out;
  }

  /**
   * Landmarks OpenStreetMap gained or lost (OA-253).
   *
   * ONE IMPLEMENTATION, TWO SCREENS. The approver's review and the customer's
   * accept screen both include this file, and the editor's own renderDataSummary()
   * carried a second copy of this wording for about an hour before it was folded
   * back in here. A duplicate is how the two screens come to disagree about what
   * a refresh did, and it also puts half the sentence outside the only test that
   * reads it. `chooserHref` is the difference between them: the customer is the
   * one who can act, so their bullet says what happens if they do not and links
   * to the chooser; the approver's states the fact.
   */
  function landmarkBullets(s, opts) {
    const href = opts && opts.chooserHref;
    const n = (k) => (Array.isArray(s[k]) ? s[k].length : 0);
    const out = [];
    if (n('landmarksAdded')) {
      const c = n('landmarksAdded');
      const act = href
        ? ` — ${c > 1 ? 'each is' : 'it is'} shown if there is room until you say otherwise.
            ${c > 1 ? 'They are' : 'It is'} under <em>Not looked at yet</em> in <a href="${esc(href)}">Choose the landmarks</a>.`
        : '';
      out.push(`<li><strong>${plural(c, 'new place')}</strong> in OpenStreetMap${lmNames(s.landmarksAdded)}${act}</li>`);
    }
    if (n('landmarksRemoved')) {
      const c = n('landmarksRemoved');
      const act = href
        ? ` — any answer you gave ${c > 1 ? 'them is' : 'it is'} kept, in case ${c > 1 ? 'they come' : 'it comes'} back.`
        : '';
      out.push(`<li><strong>${plural(c, 'place')} gone</strong> from OpenStreetMap${lmNames(s.landmarksRemoved)}${act}</li>`);
    }
    return out;
  }

  // Up to six names, then a count — a refresh's landmark churn was never
  // measurable on this laptop, so the line is built to survive a long list.
  // A candidate with no name of its own is counted and not printed.
  function lmNames(list) {
    const named = (list || []).map((p) => String((p && p.name) || '').trim()).filter(Boolean);
    if (!named.length) return '';
    const shown = named.slice(0, 6).join(', ');
    const rest = named.length > 6 ? `, and ${named.length - 6} more` : '';
    return ` <span class="muted">(${esc(shown + rest)})</span>`;
  }

  /**
   * The data half of "what changed": every accepted refresh this version carries
   * — or, with a `heading`, the single update being offered but not yet accepted
   * (the compare dialog, findings B1). An entry with no `version` has not become
   * one yet, so it is dated rather than numbered.
   * @param {Array} dataChanges  from changeSummary().dataChanges (oldest first)
   * @param {{detail?:boolean, heading?:string}} opts  detail = show exact old→new wording
   */
  function dataChangeHtml(dataChanges, opts) {
    const list = Array.isArray(dataChanges) ? dataChanges : [];
    if (!list.length) return '';
    const detail = !!(opts && opts.detail);
    const blocks = list.map((d) => {
      const rows = bullets(d.summary || {}, detail);
      const when = fmtDay(d.createdAt);
      const src = d.sourceNote ? ` <span class="muted">— ${esc(d.sourceNote)}</span>` : '';
      const lead = d.version ? `${esc(d.version)} · timetable data refreshed` : 'Timetable data refreshed';
      return `<div class="chg-refresh">
        <div class="chg-when">${lead}${when ? ' ' + esc(when) : ''}${src}</div>
        <ul class="change-list detail">${rows.join('') || '<li class="muted">Rebuilt from newer data; no service facts differ.</li>'}</ul>
      </div>`;
    }).join('');
    const title = (opts && opts.heading) ? esc(opts.heading)
      : (list.length === 1 ? 'What changed in the map data' : `What changed in the map data <span class="muted">(${list.length} updates)</span>`);
    return `<div class="change-box data-change">
      <div class="change-title">${title}</div>
      ${blocks}
      <p class="hint-line">These came from the timetable data, not from an edit anyone made here.</p>
    </div>`;
  }

  w.PortalChanges = { dataChangeHtml, landmarkBullets, esc, fmtDay, daysAgo, ageText };
}(window));
