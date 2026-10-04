#!/usr/bin/env node
// CLICKING A ROUTE DIMS THE OTHERS ON THE PUBLIC SHEET VIEWER (buses-data OA-551).
//
//   node scripts/test-route-focus.mjs [path/to/map-viewer.js [path/to/styles.css]]
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). With no
// arguments it reads the shipped files; the two optional paths are for
// prove-red-route-focus.mjs, which hands it mutated copies.
//
// WHY IT EXISTS. The engine can keep a `data-route` on every route's ink and wrap
// every badge in `<g data-route>` (design.routeTags, claude-skills #286). The
// viewer reads those to dim every route but the one a reader picked. map-viewer.js
// expects a browser, so this loads the whole file in a vm behind a stub `window`
// and drives `CBMViewer.routeFocus` over a small fake of the SVG tree. What the
// fake cannot show (the CSS actually dimming, a screen reader announcing it) is
// asserted as text in the source, and is the weaker half of this test.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS = process.argv[2] || path.join(ROOT, 'public', 'js', 'map-viewer.js');
const CSS = process.argv[3] || path.join(ROOT, 'public', 'css', 'styles.css');
const src = readFileSync(JS, 'utf8');
const css = readFileSync(CSS, 'utf8');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const BADGE = 'g[data-route]:not([data-kind])';
class Node {
  constructor(route, kind) {
    this.attrs = {}; this.classes = new Set(); this.isBadge = !kind;
    if (route != null) this.attrs['data-route'] = route;
    if (kind) this.attrs['data-kind'] = kind;
    this.classList = {
      add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
    };
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  closest(sel) { return sel === BADGE && this.isBadge && this.attrs['data-route'] != null ? this : null; }
}
function sheet(spec) {
  const nodes = spec.map(([route, kind]) => new Node(route, kind));
  const root = new Node(null, 'root');
  root.querySelectorAll = (sel) => (sel === 'g[data-route]' ? nodes : []);
  return { root, nodes };
}

const win = {};
vm.runInNewContext(src, { window: win, document: {} });
const { routeFocus } = win.CBMViewer || {};
check('the viewer exposes routeFocus', typeof routeFocus === 'function');

if (typeof routeFocus === 'function') {
  const s = sheet([['A', 'route'], ['A', 'shared'], ['A'], ['B', 'route'], ['B'], ['C']]);
  const f = routeFocus(s.root);
  const on = () => s.nodes.map((n) => (n.classes.has('route-on') ? 1 : 0)).join('');

  check('keys are each route once, in drawing order', f.keys.join() === 'A,B,C', f.keys.join());
  check('a sheet with route tags is marked live', s.root.classes.has('routes-live'));
  check('nothing is dimmed to begin with', on() === '000000' && s.root.getAttribute('data-active') === null);

  f.toggle('A');
  check('picking A keeps all of A (ink, shared member and badge)', on() === '111000', on());
  check('picking A marks the root, which is what the CSS dims from', s.root.getAttribute('data-active') === 'A');
  f.toggle('B');
  check('picking B moves the focus off A', on() === '000110', on());
  f.toggle('B');
  check('picking the same route again shows every route', on() === '000000' && s.root.getAttribute('data-active') === null && f.active() === null);
  f.toggle('C'); f.clear(); f.clear();
  check('clear puts everything back, and twice does no harm', on() === '000000' && f.active() === null);

  check('a click on a badge names its route', f.badgeAt(s.nodes[2]) === 'A');
  check('a click on route ink names nothing', f.badgeAt(s.nodes[0]) === null);
  check('a click on nothing names nothing', f.badgeAt(null) === null);

  const old = sheet([]);
  const g = routeFocus(old.root);
  check('an older sheet with no tags offers no routes', g.keys.length === 0 && !old.root.classes.has('routes-live'));
}

check('the CSS dims the routes that are not the picked one', /svg\[data-active\] g\[data-route\]:not\(\.route-on\)\s*\{\s*opacity:\s*\.\d+/.test(css));
check('the CSS only offers a pointer on badges, never on ink', /svg\.routes-live g\[data-route\]:not\(\[data-kind\]\)\s*\{\s*cursor:\s*pointer/.test(css));
check('the viewer starts route focus when a sheet is shown', /startRoutes\(root\)/.test(src));
check('Escape clears the focus', /k === 'Escape'[^}]*clearRoute\(\)/.test(src) && /e\.key === 'Escape' && clearRoute\(\)/.test(src));
check('each route has a real button that says whether it is pressed', /aria-pressed/.test(src) && /createElement|el\('button'/.test(src));
check('the choice is announced', /Showing route/.test(src) && /All routes shown/.test(src));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall route-focus checks passed');
