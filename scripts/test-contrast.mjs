// WCAG AA contrast gate for the tinted badges and pills in public/css/styles.css.
//
// Why this exists: several chips paint text in a colour ON A LOW-OPACITY WASH OF
// THAT SAME COLOUR. That reads fine to the author, because the hue is obviously
// "the right one", and it fails AA because the two are only a lightness apart.
// The impeccable round-2 review found two of them live (.badge.place 2.32:1,
// .badge.extra 2.36:1); --accent-tint-ink fixed those, and .org-badge still had
// the same fault for two of the seven organisation accents.
//
// The gate reads the REAL declarations out of styles.css rather than a copy of
// the numbers, so editing the CSS moves the test with it. If a selector or token
// it names disappears, that is a FAILURE, not a pass -- a check that cannot find
// its subject must never report "clear".
//
//   node scripts/test-contrast.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENTS } from '../src/branding/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(ROOT, 'public/css/styles.css'), 'utf8');

const AA = 4.5; // every one of these is small bold text; none reaches the 14pt/18.66px large-text threshold

/* ---------- colour maths ---------- */

const rgb = (hex) => {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const luminance = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// color-mix(in srgb, C pct%, other) -- and the same maths composites a
// pct-alpha wash of C over an opaque backdrop.
const mix = (c, pct, other) => c.map((v, i) => Math.round(pct * v + (1 - pct) * other[i]));
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

/* ---------- read what the stylesheet actually says ---------- */

// Token values, per theme. The dark block is the one inside the
// prefers-color-scheme media query; :root above it carries light.
const darkBlock = CSS.slice(CSS.indexOf('@media (prefers-color-scheme: dark)'));
const lightBlock = CSS.slice(0, CSS.indexOf('@media (prefers-color-scheme: dark)'));

function token(name, theme) {
  const block = theme === 'dark' ? darkBlock : lightBlock;
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  // A dark-mode token that is not redefined inherits the light value.
  if (!m && theme === 'dark') return token(name, 'light');
  if (!m) throw new Error(`token --${name} not found for ${theme} theme`);
  return rgb(m[1]);
}

// The percentage in `background: color-mix(in srgb, var(--X) N%, ...)` for one selector.
function washPct(selector, varName) {
  const rule = ruleFor(selector);
  const m = rule.match(new RegExp(`background:\\s*color-mix\\(in srgb,\\s*var\\(--${varName}\\)\\s*(\\d+)%`));
  if (!m) throw new Error(`no ${varName} wash found in ${selector}`);
  return Number(m[1]) / 100;
}

function ruleFor(selector) {
  const i = CSS.indexOf(selector + ' ');
  const j = CSS.indexOf(selector + '{');
  const at = i === -1 ? j : (j === -1 ? i : Math.min(i, j));
  if (at === -1) throw new Error(`selector ${selector} not found in styles.css`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  if (open === -1 || close === -1) throw new Error(`malformed rule for ${selector}`);
  return CSS.slice(open, close);
}

// Does this selector ink itself with the given token / darkened accent?
function inkOf(selector) {
  const rule = ruleFor(selector);
  const tok = rule.match(/color:\s*var\(--([a-z-]+)\)/);
  if (tok) return { kind: 'token', name: tok[1] };
  const dark = rule.match(/color:\s*color-mix\(in srgb,\s*var\(--([a-z-]+)\)\s*(\d+)%,\s*black\)/);
  if (dark) return { kind: 'darkened', name: dark[1], pct: Number(dark[2]) / 100 };
  throw new Error(`no readable color declaration in ${selector}`);
}

/* ---------- the cases ---------- */

const results = [];
const check = (label, fg, bg) => {
  const r = contrast(fg, bg);
  results.push({ label, ratio: r, pass: r >= AA });
};

for (const theme of ['light', 'dark']) {
  const pageBg = token('bg', theme);         // .card and .pub-card both sit on --bg
  const surface = token('surface', theme);   // the darker backdrop some strips use
  const accent = token('accent', theme);
  const err = token('err', theme);

  // The three amber chips the round-2 P0s were about, plus the pill that shares
  // their token. Locks in the --accent-tint-ink fix so it cannot silently regress.
  for (const sel of ['.badge.place', '.badge.extra', '.pill.amber']) {
    const ink = inkOf(sel);
    if (ink.kind !== 'token') throw new Error(`${sel} no longer inks from a token`);
    const inkRgb = token(ink.name, theme);
    const pct = washPct(sel, 'accent');
    for (const [bgName, bg] of [['bg', pageBg], ['surface', surface]]) {
      check(`${theme} ${sel} on --${bgName}`, inkRgb, mix(accent, pct, bg));
    }
  }

  // The demo-organisation chip: --err text on an --err wash.
  {
    const ink = inkOf('.badge.sample');
    const inkRgb = ink.kind === 'token' ? token(ink.name, theme) : mix(err, ink.pct, BLACK);
    const pct = washPct('.badge.sample', 'err');
    check(`${theme} .badge.sample on --bg`, inkRgb, mix(err, pct, pageBg));
  }

  // The organisation badge, for EVERY accent a customer can choose. Importing
  // ACCENTS rather than listing hexes means a newly added accent is covered the
  // day it is added, which is when it would otherwise slip through.
  if (theme === 'light') {
    const ink = inkOf('.org-badge');
    const pct = washPct('.org-badge', 'org-accent');
    for (const [key, { hex }] of Object.entries(ACCENTS)) {
      const c = rgb(hex);
      const inkRgb = ink.kind === 'darkened' ? mix(c, ink.pct, BLACK) : c;
      for (const [bgName, bg] of [['bg', pageBg], ['surface', surface]]) {
        check(`light .org-badge accent=${key} on --${bgName}`, inkRgb, mix(c, pct, bg));
      }
    }
  } else {
    // Dark mode overrides .org-badge inside its own media query: the ink is
    // lifted towards white and the wash is heavier.
    const dm = darkBlock.slice(darkBlock.indexOf('.org-badge'));
    const inkPct = Number(dm.match(/color:\s*color-mix\(in srgb,\s*var\(--org-accent\)\s*(\d+)%,\s*white\)/)?.[1]);
    const bgPct = Number(dm.match(/background:\s*color-mix\(in srgb,\s*var\(--org-accent\)\s*(\d+)%/)?.[1]);
    if (!inkPct || !bgPct) throw new Error('dark-mode .org-badge overrides not found');
    for (const [key, { hex }] of Object.entries(ACCENTS)) {
      const c = rgb(hex);
      check(`dark .org-badge accent=${key}`, mix(c, inkPct / 100, WHITE), mix(c, bgPct / 100, pageBg));
    }
  }
}

/* ---------- report ---------- */

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass || process.argv.includes('--verbose')) {
    console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2)}:1  ${r.label}`);
  }
}
if (results.length < 30) {
  console.error(`contrast: only ${results.length} cases ran — the stylesheet or ACCENTS changed shape`);
  process.exit(1);
}
if (failed.length) {
  console.error(`\ncontrast: ${failed.length} of ${results.length} below AA ${AA}:1`);
  process.exit(1);
}
console.log(`contrast: ${results.length} tinted-chip cases all >= AA ${AA}:1`);
