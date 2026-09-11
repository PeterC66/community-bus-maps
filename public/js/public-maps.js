// Public gallery of published maps (/maps). Reads /api/public/maps — which only
// ever returns published, listed maps of active organisations.
//
// Maps belonging to a SEEDED DEMO organisation are labelled "Sample" so a
// visitor can never mistake our own test data for an organisation's published
// work (org.isDemo comes from customer.is_demo — see src/branding/index.js).
//
// P9 Part B — the search box above the grid answers "does any map cover my
// village?" against place names inside the maps (GET /api/public/search), not
// the map titles.
//
// "PROGRESSIVE ENHANCEMENT" IS TRUE NOW, AND WAS NOT (technical-audit_2026-08-25 N1).
// The line above used to say "the form is a real GET to /maps and works with JS
// off". The form was real; nothing on the server had ever read `q`, and the grid
// itself was built here, so with JavaScript off /maps showed "Loading published
// maps…" and a ?q= link showed the same. The server renders both the grid and
// the search results now. What this file does is avoid a page reload — which is
// what an enhancement is.
//
// OA-308 TIER 2 — a second panel below the grid answers the question a miss
// leaves behind: "then does anybody publish one?" It is filled from the same
// response (`directory` on /api/public/search), drawn by the same shared
// module, and rendered server-side too, so it is in the HTML a crawler gets.
// Everything in it is somebody ELSE's map and the markup says so; see
// src/search/directory.js for the three rules that panel exists to keep.
//
// So: no first render here. The page arrives complete, and this script only
// takes over when the reader actually types or submits. It imports the same
// markup module the server imports, so a card looks identical whichever side
// drew it.
import { grid as renderGrid, directoryBlock } from './shared/map-card.mjs';

(() => {
  const gridEl = document.getElementById('grid');
  const form = document.querySelector('#search .search-form');
  const input = document.getElementById('q');
  const meta = document.getElementById('searchMeta');
  // OA-308 tier 2 — the "somebody else publishes one" panel below the grid.
  const dirEl = document.getElementById('directory');
  if (!gridEl) return;

  function paint({ className, html }) {
    gridEl.className = className;
    gridEl.innerHTML = html;
  }

  function paintDirectory(html) {
    if (dirEl) dirEl.innerHTML = html || '';
  }

  async function loadAll() {
    if (meta) meta.hidden = true;
    paintDirectory('');
    try {
      const body = await (await fetch('/api/public/maps')).json();
      paint(renderGrid((body && body.maps) || []));
    } catch {
      gridEl.className = '';
      gridEl.innerHTML = '<p class="form-note">Sorry — we could not load the published maps just now. Please try again shortly.</p>';
    }
  }

  async function runSearch(q) {
    if (meta) {
      meta.hidden = false;
      meta.textContent = `Searching for “${q}”…`;
    }
    try {
      const body = await (await fetch(`/api/public/search?q=${encodeURIComponent(q)}`)).json();
      const results = (body && body.results) || [];
      const corrected = body && body.corrected;
      const directory = (body && body.directory) || [];
      if (meta) {
        if (results.length && corrected) {
          meta.textContent = `No exact match for “${q}” — showing results for “${corrected}”.`;
        } else if (results.length) {
          meta.textContent = `${results.length} map${results.length === 1 ? '' : 's'} match “${q}”.`;
        } else if (directory.length) {
          // Not "no matches": we found somebody else's map, which is an answer.
          meta.textContent = `No map of ours matches “${q}” — but see what the local transport authority publishes, below.`;
        } else {
          meta.textContent = `No matches for “${q}”.`;
        }
      }
      paint(renderGrid(results.map((r) => r.map), {
        reasons: new Map(results.map((r) => [r.map.slug, r.reason])),
        query: q,
        hasDirectory: directory.length > 0,
      }));
      paintDirectory(directoryBlock(directory, { query: q, size: (body && body.directorySize) || 0 }));
    } catch {
      if (meta) meta.textContent = '';
      paintDirectory('');
      gridEl.className = '';
      gridEl.innerHTML = '<p class="form-note">Sorry — search is not available just now. Please try again shortly.</p>';
    }
  }

  function apply(q) {
    const trimmed = (q || '').trim();
    const url = trimmed ? `/maps?q=${encodeURIComponent(trimmed)}` : '/maps';
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
    if (trimmed.length >= 2) runSearch(trimmed);
    else loadAll();
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      apply(input ? input.value : '');
    });
  }
  if (input) {
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => apply(input.value), 300);
    });
  }
})();
