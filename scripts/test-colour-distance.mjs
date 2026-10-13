#!/usr/bin/env node
// THE ROUTE COLOUR PICKER MEASURES HOW CLOSE TWO ROUTES ARE (buses-data OA-619).
//
//   node scripts/test-colour-distance.mjs     (or: npm run test:colour-distance)
//
// Run it from the repository root (`C:\Buses\community-bus-maps`); no arguments.
//
// WHY IT EXISTS. The map editor's route swatch was the browser's native colour
// dialog, which covers the other routes and cannot be moved; March's ZIP2 was
// recoloured to sit beside the 33A. The in-page picker that replaced it flags a
// pair of routes closer than CLOSE_DE in CIEDE2000, and that flag is only as good
// as the arithmetic under it. editor.js is too large to load whole, so this runs
// the "colour distance" block alone, cut from the source between its section
// comment and the next, in a vm. It checks the formula against Sharma, Wu and
// Dalal's published test pairs (which exercise the hue wrap and the blue-region
// rotation term), the sRGB→Lab conversion against known values, the HSL round
// trip the sliders depend on, and closePairs on a real clash. Then it breaks the
// formula on purpose in copies of the block, and each copy must fail.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(path.join(ROOT, 'public', 'app', 'editor.js'), 'utf8');
const START = '// ---- colour distance (buses-data OA-619)';
const END = '// ---- overrides <-> staged';
const a = SRC.indexOf(START), b = SRC.indexOf(END);
if (a < 0 || b < a) { console.error('✗ could not find the colour distance block in public/app/editor.js'); process.exit(2); }
const BLOCK = SRC.slice(a, b);

const load = (code) => {
  const ctx = vm.createContext({});
  vm.runInContext(`${code}\nthis.api = { CLOSE_DE, hexToRgb, rgbToHex, rgbToLab, deltaE2000, colourDistance, closePairs, hexToHsl, hslToHex };`, ctx);
  return ctx.api;
};

// Sharma, Wu & Dalal (2005), table 1: [lab1, lab2, ΔE00].
const SHARMA = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [56, -27, -3], 31.9030],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
  [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
];

function behaviour(api) {
  const fails = [];
  for (const [p, q, want] of SHARMA) {
    const got = api.deltaE2000(p, q), back = api.deltaE2000(q, p);
    if (Math.abs(got - want) > 1e-4) fails.push(`ΔE00 ${JSON.stringify(p)} vs ${JSON.stringify(q)} = ${got.toFixed(4)}, want ${want}`);
    if (Math.abs(got - back) > 1e-9) fails.push(`ΔE00 not symmetric for ${JSON.stringify(p)}`);
  }
  const lab = (h) => api.rgbToLab(api.hexToRgb(h));
  const near = (x, y, tol) => x.every((v, i) => Math.abs(v - y[i]) <= tol);
  if (!near(lab('#ffffff'), [100, 0, 0], 0.01)) fails.push(`Lab of white is ${lab('#ffffff')}`);
  if (!near(lab('#000000'), [0, 0, 0], 0.01)) fails.push(`Lab of black is ${lab('#000000')}`);
  if (!near(lab('#ff0000'), [53.24, 80.09, 67.20], 0.05)) fails.push(`Lab of red is ${lab('#ff0000')}`);
  // A mid-tone, because 0 and 255 pass straight through a missing gamma curve.
  if (!near(lab('#808080'), [53.59, 0, 0], 0.05)) fails.push(`Lab of mid grey is ${lab('#808080')}`);
  for (const h of ['#1a6fb0', '#e69f00', '#009e73', '#cc79a7', '#000000', '#ffffff', '#777777']) {
    const back = api.hslToHex(...api.hexToHsl(h));
    if (back !== h) fails.push(`HSL round trip ${h} → ${back}`);
  }
  if (api.colourDistance('#1a6fb0', '#1a6fb0') !== 0) fails.push('a colour is not zero from itself');
  if (api.colourDistance('#1a6fb0', 'nonsense') !== null) fails.push('an unreadable colour was measured');
  // Two blues a reader would confuse; a yellow they would not.
  const pairs = api.closePairs([{ id: 'ZIP2', colour: '#1a6fb0' }, { id: '33A', colour: '#2070b8' }, { id: '9', colour: '#e69f00' }]);
  if (pairs.length !== 1 || pairs[0].a !== 'ZIP2' || pairs[0].b !== '33A') fails.push(`closePairs found ${JSON.stringify(pairs)}`);
  if (api.closePairs([{ id: 'A', colour: '#0072b2' }, { id: 'B', colour: '#d55e00' }, { id: 'C', colour: '#009e73' }]).length)
    fails.push('three well-separated Okabe–Ito colours were flagged as close');
  return fails;
}

let failures = 0;
console.log('colour distance — the real block');
const real = behaviour(load(BLOCK));
if (real.length) { failures += real.length; real.forEach((f) => console.error(`  ✗ ${f}`)); } else console.log(`  ✓ ${SHARMA.length} published CIEDE2000 pairs, Lab anchors, HSL round trip, closePairs`);

// Each mutation removes one part of the formula; every copy must be caught.
const MUTANTS = [
  ['no rotation term', 'const RT = -Math.sin(2 * dTheta * rad) * RC;', 'const RT = 0;'],
  ['no hue wrap', 'if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;', ''],
  ['no chroma correction G', 'const a1p = (1 + G) * a1, a2p = (1 + G) * a2;', 'const a1p = a1, a2p = a2;'],
  ['no lightness weighting', 'const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);', 'const SL = 1;'],
  ['gamma left in', "return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;", 'return v;'],
  ['threshold ignored', 'if (de !== null && de < CLOSE_DE)', 'if (de !== null && de < 0)'],
];
console.log('colour distance — each mutation must be caught');
for (const [name, from, to] of MUTANTS) {
  if (!BLOCK.includes(from)) { failures++; console.error(`  ✗ mutation "${name}" no longer applies — its text is gone from the block`); continue; }
  let caught;
  try { caught = behaviour(load(BLOCK.replace(from, to))).length > 0; } catch { caught = true; }
  if (caught) console.log(`  ✓ caught: ${name}`);
  else { failures++; console.error(`  ✗ NOT caught: ${name}`); }
}

if (failures) { console.error(`\n${failures} failure(s).`); process.exit(1); }
console.log('\nall colour-distance checks passed.');
