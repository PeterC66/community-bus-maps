// Cross-platform render parity probe.
//
// WHY THIS EXISTS, and why `npm run verify` does not cover it.
//
// verify-reproduce.mjs fails only when the regenerated SVG differs; its JPG
// comparison is printed but never reaches the exit code. SVG generation is pure
// JavaScript, so that gate is platform-independent by construction — it would
// pass on Linux even if libvips encoded every JPEG differently. The portal's
// promise ("the file we serve is the file that was approved") survives that,
// because published bytes are served from disk and never re-encoded. What does
// NOT survive is comparing a laptop-rendered sheet against a host-rendered one,
// which is exactly what the laptop->host delivery flow and push-status.mjs do.
//
// So this probe answers the real question: does THIS platform rasterise a known
// SVG to the same bytes as another? It uses SYNTHETIC SVGs built in code — no
// map data, no fixtures, nothing private — so it can run in public CI.
//
// Two probes, because two independent things can differ:
//   geometry — shapes/strokes/gradients only. Isolates libvips rasterisation
//              and the JPEG encoder.
//   text     — the same, plus Arial text. Isolates FONT AVAILABILITY, which is
//              the likelier failure on a slim container: every sheet uses Arial
//              (120 times in the St Ives internal sheet) and a bare Debian image
//              ships no fonts at all. sharp bundles its own fontconfig/pango,
//              but fontconfig still has to find a font file on disk.
//
// Both are rasterised through the PRODUCTION rasterise() so this tests the real
// code path, at the real sheet geometry (3508x2480, viewBox 0 0 297 210).
//
// Usage:
//   node scripts/render-parity-probe.mjs                  # print this platform's result
//   node scripts/render-parity-probe.mjs --write-baseline # record it as the baseline
//   node scripts/render-parity-probe.mjs --strict         # exit 1 if it differs from the baseline

import { sha256 } from '../src/hash.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { rasterise } from '../src/render/renderMap.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'render-parity-baseline.json');

const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write-baseline');
const STRICT = args.has('--strict');
// Separate from --strict on purpose. The baseline byte comparison is EXPECTED to
// differ between platforms (Windows real Arial vs Linux Liberation Sans has
// different glyph outlines by design -- GO-LIVE.md 2.5) so failing CI on that
// would be a permanent false positive with no fix available. Whether the
// resolved face is proportional at all is not comparative, has no legitimate
// "different but fine" outcome, and is exactly the class of bug this file exists
// to catch -- so it gets its own flag and can safely gate CI on its own.
const STRICT_FONTS = args.has('--strict-fonts') || STRICT;

const sha = sha256;   // the ONE sha256 (OA-224 Tier 3.3)

/*
 * BREADCRUMBS, AND WHY THIS SCRIPT NEEDED THEM (2026-08-29, OA-052 / OA-103).
 *
 * This probe hung in CI on SIX of its last forty runs -- about one in seven --
 * and every one of those six produced NO OUTPUT AT ALL before the job timed out
 * at twenty minutes. That is not bad luck about where it stopped: it is
 * structural. Every `console.log` in this file fires AFTER both rasterisations
 * have finished, so a hang anywhere in the work is GUARANTEED to leave an empty
 * log, and six occurrences have produced exactly zero evidence between them.
 * "Cause still unknown" was a property of the instrument, not of the fault.
 *
 * So: one line to STDERR as each phase begins, with a monotonic elapsed clock.
 * The next hang names the phase it died in, and the line before it says how long
 * the previous phase took. stdout -- which `tee` captures and the workflow's
 * Report step quotes -- is byte-identical to before, so the verdict, the
 * baseline comparison and every consumer of this script are untouched.
 *
 * The environment line matters as much as the phase lines. BOTH jobs in
 * render-parity.yml have now hung (the workflow header's claim that the image
 * job never has is out of date, measured 2026-08-29 over the last 40 runs), so
 * anything that could differ between a hung run and a passing one belongs on the
 * record BEFORE the work starts: the libvips build, the thread-pool size sharp
 * chose for itself, and how many CPUs it thinks it has.
 */
const T0 = process.hrtime.bigint();
const step = (msg) => {
  const s = Number(process.hrtime.bigint() - T0) / 1e9;
  process.stderr.write(`[probe +${s.toFixed(2)}s] ${msg}\n`);
};

// --- the synthetic sheets -----------------------------------------------------
// Same root attributes as a real sheet so the rasteriser does the same scaling
// work (297x210 user units painted into 3508x2480 px).
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 297 210">';

// Deterministic pseudo-random, so the shapes are elaborate but reproducible
// everywhere without shipping a data file.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function geometryBody() {
  const rnd = lcg(20260809);
  const out = ['<rect width="297" height="210" fill="#ffffff"/>'];
  // A colour ramp in the spirit of the route palette.
  const palette = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'];
  // Long stroked polylines — the dominant primitive on a real sheet.
  for (let r = 0; r < 6; r++) {
    const pts = [];
    let x = 10 + r * 3, y = 20 + r * 8;
    for (let i = 0; i < 120; i++) {
      x += rnd() * 2.4;
      y += (rnd() - 0.5) * 3.2;
      pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    out.push(
      `<path d="M${pts.join(' L')}" fill="none" stroke="${palette[r]}" ` +
        `stroke-width="${(1.2 + r * 0.15).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`,
    );
  }
  // Stop dots — antialiasing over curves.
  for (let i = 0; i < 160; i++) {
    out.push(
      `<circle cx="${(10 + rnd() * 270).toFixed(2)}" cy="${(20 + rnd() * 180).toFixed(2)}" ` +
        `r="${(0.4 + rnd() * 0.9).toFixed(2)}" fill="#ffffff" stroke="#333333" stroke-width="0.25"/>`,
    );
  }
  // A gradient — exercises the interpolation path.
  out.push(
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#0072B2"/>' +
      '</linearGradient></defs>',
    '<rect x="200" y="8" width="90" height="18" fill="url(#g)"/>',
  );
  return out.join('\n');
}

function textBody() {
  const out = [];
  // The sizes a real sheet actually uses, including the 2.8 footer credit where
  // hinting differences would show up first.
  const sizes = [2.8, 3.2, 4, 5.5, 8, 12];
  sizes.forEach((size, i) => {
    out.push(
      `<text x="12" y="${(30 + i * 14).toFixed(1)}" font-family="Arial" font-size="${size}" fill="#111111">` +
        `Buses within St Ives — ABCDEFGHIJ abcdefghij 0123456789 ©</text>`,
    );
  });
  // Right-anchored, like the real credit line: exposes advance-width differences
  // because the whole run shifts if the glyph metrics change.
  out.push(
    '<text x="294" y="206" font-family="Arial" font-size="2.8" fill="#999999" text-anchor="end">' +
      'Map design © BusMaps.uk</text>',
  );
  // Bold and italic pull in different faces of the family.
  out.push(
    '<text x="12" y="130" font-family="Arial" font-size="9" font-weight="bold" fill="#0072B2">Service 300</text>',
    '<text x="12" y="145" font-family="Arial" font-size="7" font-style="italic" fill="#333333">Mondays to Saturdays</text>',
  );
  return out.join('\n');
}

const PROBES = {
  geometry: `${OPEN}\n${geometryBody()}\n</svg>\n`,
  text: `${OPEN}\n${geometryBody()}\n${textBody()}\n</svg>\n`,
};

// --- run ----------------------------------------------------------------------
step(`start — node ${process.version}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}, `
  + `concurrency ${sharp.concurrency()}, cpus ${os.cpus().length}, simd ${sharp.simd()}`);
const scratch = mkdtempSync(path.join(os.tmpdir(), 'parity-'));
const result = {
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  sharp: sharp.versions.sharp,
  vips: sharp.versions.vips,
  probes: {},
};

for (const [name, svg] of Object.entries(PROBES)) {
  const svgBuf = Buffer.from(svg, 'utf8');
  const outJpg = path.join(scratch, `${name}.jpg`);
  step(`probe "${name}": rasterising ${svgBuf.length} B of SVG`);
  const meta = await rasterise(svgBuf, outJpg);
  step(`probe "${name}": rasterised, reading back`);
  const jpg = readFileSync(outJpg);
  // Raw pixels as well as encoded bytes: if the pixels match but the file does
  // not, the difference is encoder metadata and harmless. If the pixels differ,
  // it is the rasteriser (or a missing font) and it is not.
  const raw = await sharp(jpg).raw().toBuffer();
  result.probes[name] = {
    svgSha: sha(svgBuf),
    svgBytes: svgBuf.length,
    jpgSha: sha(jpg),
    jpgBytes: jpg.length,
    pixelSha: sha(raw),
    dims: `${meta.width}x${meta.height}`,
    density: meta.density,
  };
}
// --- did "Arial" resolve to a PROPORTIONAL face? ------------------------------
//
// The probes above compare byte counts against a baseline, and a byte count
// cannot say WHICH face was chosen. That gap cost us: on 2026-08-09 the text
// probe moved 670,430 -> 676,537 B after fonts-liberation was installed, which
// was read as "Arial now resolves to Liberation Sans". It did not. The image had
// the font FILES but not fontconfig's Arial->Liberation Sans metric alias, so
// fontconfig fell back to the first family it could see -- Liberation MONO --
// and every live sheet was set in monospace for four days until the Beaconsfield
// Simpson Centre title visibly overran its Services panel by 16.5mm.
//
// So measure the thing that actually matters, with no baseline involved. In any
// proportional face a run of 'W' is several times wider than the same number of
// 'i'; in a monospace face the two are identical by definition. The ratio needs
// no threshold tuning and no reference platform -- it is ~4 for Arial and its
// metric twins, ~1 for anything monospace.
async function inkWidthMM(text) {
  const svg = `${OPEN}\n<rect width="297" height="210" fill="#ffffff"/>\n`
    + `<text x="10" y="100" font-family="Arial" font-size="12" fill="#000000">${text}</text>\n</svg>\n`;
  const out = path.join(scratch, `ink-${text[0]}.jpg`);
  await rasterise(Buffer.from(svg, 'utf8'), out);
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  let min = Infinity, max = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  return max < 0 ? null : (max - min + 1) / (info.width / 297);
}

const RUN = 20;
step('font check: rasterising the narrow run');
const wNarrow = await inkWidthMM('i'.repeat(RUN));
step('font check: rasterising the wide run');
const wWide = await inkWidthMM('W'.repeat(RUN));
step('font check: measured');
const ratio = wNarrow && wWide ? wWide / wNarrow : null;
result.fontResolution = {
  narrowMM: wNarrow == null ? null : Number(wNarrow.toFixed(2)),
  wideMM: wWide == null ? null : Number(wWide.toFixed(2)),
  ratio: ratio == null ? null : Number(ratio.toFixed(3)),
  // Arial's 'W' advance is 0.944em against 'i' at 0.222em.
  proportional: ratio != null && ratio > 2,
};

rmSync(scratch, { recursive: true, force: true });

console.log(JSON.stringify(result, null, 2));

if (result.fontResolution.ratio == null) {
  console.log('\nFONT CHECK: INCONCLUSIVE — no text rendered at all. No usable font on this platform.');
} else if (result.fontResolution.proportional) {
  console.log(`\nFONT CHECK: PASS ✓ — "Arial" resolved to a proportional face `
    + `(W/i ink ratio ${result.fontResolution.ratio}).`);
} else {
  console.log(`\nFONT CHECK: FAIL ✗ — "Arial" resolved to a MONOSPACE face `
    + `(W/i ink ratio ${result.fontResolution.ratio}, expected >2).\n`
    + '  Every sheet will be mis-set and long titles will overrun their panels.\n'
    + '  Install fontconfig alongside fonts-liberation: the font files alone do not\n'
    + '  create the Arial -> Liberation Sans alias (/etc/fonts/conf.d/30-metric-aliases.conf).');
}

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nBaseline written: ${path.relative(process.cwd(), BASELINE)} (${result.platform})`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log('\nNo baseline recorded — run with --write-baseline on the reference platform.');
  process.exit(0);
}

// --- compare ------------------------------------------------------------------
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
console.log(`\nComparing ${result.platform} against baseline ${base.platform}`);
console.log(`  sharp ${base.sharp} / libvips ${base.vips}  ->  sharp ${result.sharp} / libvips ${result.vips}`);

let worst = 'identical';
for (const name of Object.keys(PROBES)) {
  const a = base.probes[name], b = result.probes[name];
  if (!a) { console.log(`— ${name}: not in baseline, skipped`); continue; }
  if (a.svgSha !== b.svgSha) {
    // Both sides must have rasterised the same input for the rest to mean anything.
    console.log(`— ${name}: PROBE SVG DIFFERS — the probe itself is not reproducible, results are meaningless`);
    worst = 'broken';
    continue;
  }
  if (a.jpgSha === b.jpgSha) {
    console.log(`— ${name}: BYTE-IDENTICAL ✓  (${b.jpgBytes} B)`);
  } else if (a.pixelSha === b.pixelSha) {
    console.log(`— ${name}: pixel-identical, encoded bytes differ ✓  (${a.jpgBytes} vs ${b.jpgBytes} B)`);
    if (worst === 'identical') worst = 'metadata';
  } else {
    console.log(`— ${name}: PIXELS DIFFER ✗  (${a.jpgBytes} vs ${b.jpgBytes} B)`);
    worst = 'pixels';
  }
}

const verdict = {
  identical: 'RESULT: PASS — this platform reproduces the baseline byte-for-byte.',
  metadata: 'RESULT: PASS (with a caveat) — pixels match; only encoder metadata differs.',
  pixels: 'RESULT: DIFFERS — pixels do not match. If only the "text" probe differs, it is fonts, not libvips: install fonts in the image (fonts-liberation covers Arial metrics).',
  broken: 'RESULT: INCONCLUSIVE — the probe SVG differed between platforms.',
}[worst];
console.log(`\n${verdict}`);

// The baseline comparison is advisory (Linux legitimately differs from the
// Windows reference) and only --strict fails on it. The font check has no
// legitimate "differs but fine" outcome, so --strict-fonts alone is enough to
// gate CI on it without also gating on the platform difference that can never
// close.
const fontsOK = result.fontResolution.proportional;
const code = (STRICT && worst !== 'identical') || (STRICT_FONTS && !fontsOK) ? 1 : 0;

/*
 * THE HANG IS IN TEARDOWN, NOT IN THE RASTERISATION (measured 2026-08-29).
 *
 * For eight months' worth of runs the standing diagnosis -- written into
 * render-parity.yml's own header -- was "it hangs in the rasterisation step
 * itself, after npm ci has succeeded". The breadcrumbs added earlier the same
 * day disproved it on their FIRST hung run (33233095649): the probe did all its
 * work in 1.65 seconds, printed the complete JSON, the font verdict, the
 * baseline comparison and the final RESULT line at 04:08:57.489 -- and then the
 * step sat silent until the 5-minute cap killed it at 04:14:08. Everything above
 * this line had already finished. The rasterisation was never involved.
 *
 * So what hangs is the exit: `process.exit()` here, the container's teardown, or
 * `docker run`/`tee` closing the pipe. Rather than guess between them, this
 * arms a watchdog that reports WHICH by dumping the handles and requests still
 * holding the loop open, then leaves by a route that cannot be blocked.
 *
 * IS THIS MUTING A CHECK? No, and the distinction matters. The watchdog can only
 * fire after the verdict above has been computed AND printed, so the probe's
 * answer is already complete and on the record; what is being cut short is a
 * teardown deadlock that has nothing to say about render parity. It shouts on
 * every occurrence -- an Actions ::warning:: with the handle dump -- so the
 * frequency stays visible and the cause stays chaseable. Failing the build here
 * instead would turn one run in seven red for a reason unrelated to what this
 * workflow measures, which is how a check gets muted for real.
 */
const GRACE_MS = Number(process.env.PROBE_EXIT_GRACE_MS || 20000);
const watchdog = setTimeout(() => {
  const names = (list) => (list || []).map((h) => h?.constructor?.name || typeof h);
  step(`EXIT DID NOT COMPLETE within ${GRACE_MS} ms — this is the render-parity hang, caught in the act.`);
  // Three views, because none alone is enough: getActiveResourcesInfo names
  // timers and the libuv resource TYPES, while the two underscore APIs name the
  // concrete handle objects. Measured 2026-08-29 on a fixture that hangs on an
  // open interval: _getActiveHandles reported only ["Socket"] and never the
  // timer, so the modern API is the one that would have identified it.
  step(`  active resources: ${JSON.stringify(process.getActiveResourcesInfo?.() ?? 'unavailable')}`);
  step(`  active handles  : ${JSON.stringify(names(process._getActiveHandles?.()))}`);
  step(`  active requests : ${JSON.stringify(names(process._getActiveRequests?.()))}`);
  console.log(`::warning::render-parity probe: the work finished and the verdict is valid, but the process `
    + `did not exit within ${GRACE_MS} ms. This is the intermittent hang (buses-data OA-052/OA-103); `
    + `the handle dump is on stderr. Killed to preserve exit code ${code}.`);
  // SIGKILL rather than a second process.exit(): if the first one is what is
  // stuck, calling it again cannot help. The exit code the probe DECIDED is
  // preserved above in the warning, and the signal death is what the log shows.
  process.kill(process.pid, 'SIGKILL');
}, GRACE_MS);
// Unref'd: on every healthy run this timer must not itself be the thing keeping
// the process alive. A watchdog that prevents the exit it is watching for would
// be the fault it exists to find.
watchdog.unref?.();

/*
 * THE WATCHDOG CANNOT FIRE IN EVERY CASE, AND THAT IS ITSELF THE DIAGNOSIS.
 * A timer needs the event loop, so if `process.exit()` blocks synchronously in a
 * native atexit handler the loop is already dead and nothing below runs. Three
 * distinguishable states in the next hung log, which is the point:
 *
 *   no "work complete" line ................ it hung in the work after all;
 *                                            the phase breadcrumbs say where.
 *   "work complete" but no "exit event" .... process.exit() blocked before
 *                                            running exit handlers -- native,
 *                                            almost certainly libvips/sharp.
 *   "exit event" and then the watchdog ..... Node is alive with handles open;
 *                                            the dump names them.
 *   all three lines and STILL silent ....... Node died and `docker run` (or the
 *                                            `tee` pipe) did not return, which
 *                                            puts it outside this script.
 */
process.on('exit', (c) => step(`process 'exit' event reached, code ${c}`));
step(`work complete, exiting ${code}`);
process.exit(code);
