// The public sheet viewer (P8a) — pan and zoom over the map's own SVG.
//
// A sheet is A4 at 300 dpi. Shown whole on a phone its body text lands at about
// 4 CSS pixels, so "the map is online" is not worth much without a way in. This
// gives one: drag or arrow-key to pan, pinch/buttons/+ − to zoom, 0 or Reset to
// go back. It also satisfies WCAG 1.4.10 (reflow) and 1.4.4 (resize) for content
// that is, unavoidably, one big picture.
//
// Everything is keyboard-reachable and announced: the stage takes focus, the
// controls are real buttons with labels, and the zoom level goes through a
// polite live region. The map itself carries role="img" with a <title>/<desc>
// naming the text alternative (src/public/inlineSvg.js), because no amount of
// panning makes a picture readable to a screen reader.
//
// Falls back to the raster preview when the SVG cannot be fetched, when
// scripting-free rendering is needed, or when the browser has no font that is
// metric-compatible with the Arial the labels were laid out against — see
// hasMetricFont() below.
(function () {
  var MIN = 1, MAX = 10, STEP = 1.5;

  // Do we have a font whose widths match what the generator assumed?
  //
  // The labels were positioned against Arial's metrics, so a substitute with
  // WIDER glyphs can collide. The stack we serve puts Arial first and then its
  // metric twins (Liberation Sans, Arimo), which covers Windows, macOS and
  // essentially every Linux desktop. Where Arial is merely ALIASED to a local
  // face — Android resolving it to Roboto — this check passes and we keep the
  // SVG: Roboto is slightly narrower, which opens gaps rather than closing them.
  // What this rules out is the case where none of the stack exists at all and
  // the browser reaches its own default, which may be much wider.
  var _metric = null;
  function hasMetricFont() {
    if (_metric !== null) return _metric;
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      var sample = 'mmmmmmmmmmlliWWWWiii';
      ctx.font = '72px monospace';
      var base = ctx.measureText(sample).width;
      _metric = ['Arial', 'Liberation Sans', 'Arimo', 'Helvetica', 'Nimbus Sans'].some(function (f) {
        ctx.font = '72px "' + f + '", monospace';
        return ctx.measureText(sample).width !== base;
      });
    } catch (e) { _metric = true; }
    return _metric;
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function create(host) {
    var stage = el('div', 'viewer-stage');
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    var canvas = el('div', 'viewer-canvas');
    stage.appendChild(canvas);

    var live = el('p', 'viewer-live');
    live.setAttribute('aria-live', 'polite');

    var bar = el('div', 'viewer-bar');
    function button(label, text) {
      var b = el('button', 'viewer-btn', text);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      bar.appendChild(b);
      return b;
    }
    var outB = button('Zoom out', '&minus;');
    var inB = button('Zoom in', '+');
    var resetB = el('button', 'viewer-btn viewer-btn-wide', 'Reset');
    resetB.type = 'button';
    bar.appendChild(resetB);
    var hint = el('span', 'viewer-hint', 'Drag to move · pinch or use + and &minus; to zoom · arrow keys work too');
    bar.appendChild(hint);

    host.appendChild(bar);
    host.appendChild(stage);
    host.appendChild(live);

    var scale = 1, tx = 0, ty = 0, raster = false;

    function apply() {
      // Keep at least a third of the sheet on screen in each direction.
      var w = stage.clientWidth, h = stage.clientHeight;
      var maxX = w * (scale - 1), maxY = h * (scale - 1);
      tx = Math.min(0, Math.max(-maxX, tx));
      ty = Math.min(0, Math.max(-maxY, ty));
      canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      stage.classList.toggle('zoomed', scale > 1);
      resetB.disabled = scale === 1 && tx === 0 && ty === 0;
      outB.disabled = scale <= MIN;
      inB.disabled = scale >= MAX;
    }

    // Zoom about a point given in stage coordinates (defaults to the centre).
    function zoomTo(next, px, py) {
      next = Math.min(MAX, Math.max(MIN, next));
      if (next === scale) return;
      var cx = px == null ? stage.clientWidth / 2 : px;
      var cy = py == null ? stage.clientHeight / 2 : py;
      var k = next / scale;
      tx = cx - k * (cx - tx);
      ty = cy - k * (cy - ty);
      scale = next;
      apply();
      live.textContent = 'Zoom ' + Math.round(scale * 100) + '%';
    }
    function reset() { scale = 1; tx = 0; ty = 0; apply(); live.textContent = 'Zoom 100%'; }

    inB.addEventListener('click', function () { zoomTo(scale * STEP); });
    outB.addEventListener('click', function () { zoomTo(scale / STEP); });
    resetB.addEventListener('click', function () { reset(); stage.focus(); });

    // --- pointer drag + pinch ---
    var pointers = new Map(), lastMid = null, lastDist = 0, moved = false;
    stage.addEventListener('pointerdown', function (e) {
      if (raster && scale === 1) return;             // nothing to drag yet
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      moved = false;
      if (pointers.size === 2) { lastDist = spread(); lastMid = mid(); }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      var prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (scale === 1) return;
        tx += e.clientX - prev.x; ty += e.clientY - prev.y;
        moved = true;
        apply();
      } else if (pointers.size === 2) {
        var d = spread(), m = mid(), r = stage.getBoundingClientRect();
        if (lastDist > 0) zoomTo(scale * (d / lastDist), m.x - r.left, m.y - r.top);
        if (lastMid) { tx += m.x - lastMid.x; ty += m.y - lastMid.y; apply(); }
        lastDist = d; lastMid = m; moved = true;
      }
      e.preventDefault();
    });
    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) { lastDist = 0; lastMid = null; }
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    function pts() { return Array.from(pointers.values()); }
    function spread() { var p = pts(); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
    function mid() { var p = pts(); return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; }

    // Double-click/tap zooms in at the point; when already zoomed it resets, so
    // there is always a way back without hunting for the button.
    stage.addEventListener('dblclick', function (e) {
      var r = stage.getBoundingClientRect();
      if (scale > 1) reset(); else zoomTo(scale * STEP * STEP, e.clientX - r.left, e.clientY - r.top);
    });

    // The wheel scrolls the PAGE unless the user asks to zoom (Ctrl/⌘, which is
    // also what a trackpad pinch sends). Hijacking plain scroll over a map that
    // fills the screen is the single most complained-about map behaviour there is.
    stage.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomTo(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    stage.addEventListener('keydown', function (e) {
      var pan = e.shiftKey ? 120 : 48;
      var k = e.key;
      if (k === '+' || k === '=') zoomTo(scale * STEP);
      else if (k === '-' || k === '_') zoomTo(scale / STEP);
      else if (k === '0') reset();
      else if (k === 'ArrowLeft') { tx += pan; apply(); }
      else if (k === 'ArrowRight') { tx -= pan; apply(); }
      else if (k === 'ArrowUp') { ty += pan; apply(); }
      else if (k === 'ArrowDown') { ty -= pan; apply(); }
      else return;
      e.preventDefault();
    });

    window.addEventListener('resize', apply);

    /** Show one output. `o` is an entry from the public map API. */
    function show(o, label) {
      reset();
      canvas.innerHTML = '';
      raster = false;
      stage.setAttribute('aria-label', label + ' — zoomable map. Use the arrow keys to move and plus or minus to zoom.');
      var useSvg = o.inlineUrl && hasMetricFont();
      if (!useSvg) return showRaster(o, label);
      fetch(o.inlineUrl)
        .then(function (r) { if (!r.ok) throw new Error('svg'); return r.text(); })
        .then(function (svg) {
          canvas.innerHTML = svg;
          host.classList.add('is-vector');
        })
        .catch(function () { showRaster(o, label); });
    }
    function showRaster(o, label) {
      raster = true;
      host.classList.remove('is-vector');
      var img = document.createElement('img');
      img.src = o.previewUrl || o.jpgUrl || '';
      img.alt = label;
      img.draggable = false;
      canvas.innerHTML = '';
      canvas.appendChild(img);
    }

    apply();
    return { show: show, reset: reset, useRaster: function (o, l) { showRaster(o, l); } };
  }

  window.CBMViewer = { create: create, hasMetricFont: hasMetricFont };
})();
