// Diagram pin editor (client) — the expert half of the editing story (P7).
//
// Adapted from the desktop tool that shipped with the map-making skill
// (assets/diagram_edit.js): same interaction — drag a junction to pin it, drop to
// re-solve, right-click to unpin — but talking to the portal's admin-only expert
// API, and saving through the ordinary versioned render so the result goes to the
// publish gate like any other change.

const MAP_ID = Number(location.pathname.split('/')[3]); // /app/maps/:id/diagram
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = 6.5;              // board scale (px per mm) — A4 landscape at ~1930px
let nodes = {}, pins = {}, dirty = false, editable = true, busy = false;

// A pin is stored in the solver's own page-mm frame, which is NOT the frame the
// finished sheet is drawn in (the generator re-fits the workspace, and the pilot
// band shrinks the document again). The server measures the composite and sends
// it as `frame`; without it we fall back to the raw solver coordinates, which is
// what the handles used to do — near the right junction, but not on it.
let frame = null;
const IDENT = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
const toSheet = ([x, y]) => {
  const m = frame || IDENT;
  return [m.a * x + m.b * y + m.c, m.d * x + m.e * y + m.f];
};
const toMm = ([x, y]) => {
  const m = frame || IDENT;
  const det = m.a * m.e - m.b * m.d;
  if (!det) return [x, y];
  const u = x - m.c, v = y - m.f;
  return [(u * m.e - v * m.b) / det, (v * m.a - u * m.d) / det];
};

const board = $('board'), box = $('svgbox'), ovl = $('ovl');
board.style.width = (297 * S) + 'px';
board.style.height = (210 * S) + 'px';

function state(kind, text) {
  $('stateDot').className = 'dot ' + kind;
  $('stateText').textContent = text;
}
function notice(kind, text) {
  const n = $('notice');
  n.className = 'notice ' + (kind ? kind + ' show' : '');
  n.innerHTML = text || '';
}
function countPins() {
  const n = Object.keys(pins).length;
  $('pinCount').textContent = `${n} pin${n === 1 ? '' : 's'}${dirty ? ' · unsaved' : ''}`;
  $('saveBtn').disabled = !dirty || !editable || busy;
}

function setSvg(text) {
  box.innerHTML = text;
  const s = box.querySelector('svg');
  if (!s) return;
  s.removeAttribute('width');
  s.removeAttribute('height');
  s.style.width = (297 * S) + 'px';
  s.style.height = (210 * S) + 'px';
}

function mmAt(ev) {
  const p = ovl.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  const q = p.matrixTransform(ovl.getScreenCTM().inverse());
  return [q.x, q.y];
}

function drawHandles() {
  ovl.innerHTML = '';
  if (!$('showHandles').checked) return;
  for (const k of Object.keys(nodes)) {
    const n = nodes[k];
    const [hx, hy] = toSheet([n.x, n.y]);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', hx); c.setAttribute('cy', hy); c.setAttribute('r', 1.6);
    c.setAttribute('class', 'jn' + (pins[k] ? ' pinned' : ''));
    c.dataset.k = k;
    if (editable) {
      c.addEventListener('pointerdown', startDrag);
      c.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        if (!pins[k]) return;
        delete pins[k]; dirty = true; solve();
      });
    }
    ovl.appendChild(c);
  }
}

let drag = null;
function startDrag(ev) {
  if (!editable || busy) return;
  ev.preventDefault();
  drag = { k: ev.target.dataset.k, el: ev.target };
  ev.target.setPointerCapture(ev.pointerId);
  ev.target.addEventListener('pointermove', moveDrag);
  ev.target.addEventListener('pointerup', endDrag, { once: true });
}
function moveDrag(ev) {
  if (!drag) return;
  const [x, y] = mmAt(ev);
  drag.el.setAttribute('cx', x); drag.el.setAttribute('cy', y);
  drag.pos = [x, y];
}
function endDrag() {
  if (!drag) return;
  drag.el.removeEventListener('pointermove', moveDrag);
  if (drag.pos) {
    const n = nodes[drag.k] || {};
    const [mx, my] = toMm(drag.pos); // handles move in sheet units; pins are stored in solver mm
    pins[drag.k] = { x: +mx.toFixed(2), y: +my.toFixed(2), ll: n.ll };
    dirty = true;
    solve();
  }
  drag = null;
}

function showNotes(list) {
  $('notes').innerHTML = (list && list.length)
    ? list.map((l) => `<div>${esc(l)}</div>`).join('')
    : 'The solver placed every junction itself — no pins applied.';
}

async function solve() {
  busy = true; state('dirty', 'solving…'); countPins();
  try {
    const res = await fetch(`/api/expert/maps/${MAP_ID}/diagram/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pins }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok || !b.ok) { notice('err', (b && b.error) || 'The solve failed.'); state('', 'solve failed'); return; }
    nodes = b.nodes; frame = b.frame || null; setSvg(b.svg); drawHandles(); showNotes(b.notes);
    notice('', '');
    state(dirty ? 'dirty' : 'clean', dirty ? 'unsaved pins' : 'saved');
  } catch {
    notice('err', 'Network error while solving.'); state('', 'solve failed');
  } finally { busy = false; countPins(); }
}

$('showHandles').addEventListener('change', drawHandles);

$('clearBtn').addEventListener('click', () => {
  if (!Object.keys(pins).length) return;
  pins = {}; dirty = true; solve();
});

$('saveBtn').addEventListener('click', async () => {
  busy = true; countPins(); state('dirty', 'saving + rendering…');
  try {
    const res = await fetch(`/api/expert/maps/${MAP_ID}/diagram/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pins, note: $('saveNote').value || '' }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok || !b.ok) { notice('err', (b && b.error) || 'Save failed.'); state('dirty', 'unsaved pins'); return; }
    dirty = false;
    $('saveNote').value = '';
    notice('ok', `Saved as <strong>${esc(b.version)}</strong> with ${b.pins} pin${b.pins === 1 ? '' : 's'}.`
      + (b.enabledDiagramOutput ? ' The diagram output was switched on for this map.' : '')
      + ` It is a draft — submit it for review on the <a href="/app/maps/${MAP_ID}">map page</a> when you are happy.`);
    state('clean', `saved ${b.version}`);
  } catch {
    notice('err', 'Network error while saving.'); state('dirty', 'unsaved pins');
  } finally { busy = false; countPins(); }
});

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/app/login.html';
});

(async () => {
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) { location.href = '/app/login.html'; return; }
    const me = (await r.json()).user;
    $('whoami').textContent = `${me.email} · ${me.role}`;
    $('logoutBtn').style.display = '';
  } catch { state('', 'could not reach the server'); return; }

  $('backLink').href = `/app/maps/${MAP_ID}`;
  state('clean', 'solving…');
  try {
    const res = await fetch(`/api/expert/maps/${MAP_ID}/diagram`);
    const b = await res.json().catch(() => ({}));
    if (!res.ok || !b.ok) {
      state('', 'unavailable');
      notice('err', (b && b.error) || 'Could not open the diagram editor.');
      $('clearBtn').disabled = true;
      return;
    }
    document.title = `Diagram — ${b.map.name} — BusMaps.uk`;
    $('mapName').textContent = `${b.map.name} — diagram layout`;
    $('mapCrumb').textContent = [b.map.customer, b.map.subject, b.map.currentVersion && ('current ' + b.map.currentVersion)].filter(Boolean).join(' · ');
    pins = b.pins || {}; nodes = b.nodes || {}; frame = b.frame || null; editable = b.editable !== false;
    setSvg(b.svg); drawHandles(); showNotes(b.notes);
    if (!editable) {
      notice('warn', 'This map is awaiting publication review, so the layout is read-only. Withdraw the request on the map page to tune it.');
      $('clearBtn').disabled = true;
    } else if (!b.diagramEnabled) {
      notice('warn', 'The diagram output is currently switched off for this map — saving a layout will switch it on.');
    }
    state('clean', 'saved');
  } catch {
    state('', 'could not load'); notice('err', 'Could not load the diagram.');
  } finally { countPins(); }
})();
