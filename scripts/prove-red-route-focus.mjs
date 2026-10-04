// prove-red-route-focus.mjs — falsify test-route-focus.mjs (buses-data OA-551).
//
//   node scripts/prove-red-route-focus.mjs   (or: npm run test:prove-red-route-focus)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`); no arguments.
//
// A test that has never been seen to fail proves nothing. Each arm removes one
// behaviour from a SCRATCH COPY of map-viewer.js or styles.css and requires the
// shipped test to exit 1 on the assertion that behaviour belongs to. It mutates
// copies and never the repository.
//
//   0  control — the files as shipped                        -> exit 0
//   1  the dimming removed from the CSS                      -> exit 1, "CSS dims"
//   2  clear() no longer drops the route-on marks            -> exit 1, "clear puts"
//   3  a badge click no longer reads its route               -> exit 1, "click on a badge"
//   4  route ink counted as a badge                          -> exit 1, "route ink"
//   5  Escape no longer clears                               -> exit 1, "Escape clears"

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-route-focus.mjs');
const JS = readFileSync(path.join(ROOT, 'public', 'js', 'map-viewer.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'route-focus-'));
let failures = 0;

function arm(name, js, css, wantExit, wantText) {
  writeFileSync(path.join(scratch, 'map-viewer.js'), js);
  writeFileSync(path.join(scratch, 'styles.css'), css);
  const r = spawnSync(process.execPath, [TEST, path.join(scratch, 'map-viewer.js'), path.join(scratch, 'styles.css')], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === wantExit && (!wantText || out.split('\n').some((l) => l.includes('✗') && l.includes(wantText)));
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} — exit ${r.status}, wanted ${wantExit}${wantText ? ` on "${wantText}"` : ''}\n${out}`); }
}

// A mutation that changes nothing is a control pretending to be an arm.
function mutate(text, from, to) {
  if (!text.includes(from)) { console.error(`  ✗ arm cannot apply: ${JSON.stringify(from)} is not in the source`); failures++; return text; }
  return text.replace(from, to);
}

try {
  arm('control: the shipped files pass', JS, CSS, 0);
  arm('dimming removed from the CSS', JS, mutate(CSS, '{ opacity: .15; }', '{ opacity: 1; }'), 1, 'CSS dims');
  arm('clear() leaves the marks behind', mutate(JS, "each(all, function (n) { n.classList.remove('route-on'); });", ''), CSS, 1, 'clear puts');
  arm('a badge click reads no route', mutate(JS, "return b ? b.getAttribute('data-route') : null;", 'return null;'), CSS, 1, 'click on a badge');
  arm('route ink counted as a badge', mutate(JS, "var b = target && target.closest ? target.closest(BADGE) : null;", "var b = target && target.closest ? target : null;"), CSS, 1, 'route ink');
  arm('Escape no longer clears', mutate(JS, "else if (k === 'Escape') { if (!clearRoute()) return; }", ''), CSS, 1, 'Escape clears');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} arm(s) failed`); process.exit(1); }
console.log('\nevery arm went red as required');
