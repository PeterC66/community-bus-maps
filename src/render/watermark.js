// Diagonal "BusMaps.uk" watermark applied to a published map's JPG at download
// time for anyone who is not the owning customer (or an admin) — see
// customer.watermark_enabled and the /api/public/maps/:slug/:file route in
// server.js. The point is simple: a forwarded or shared copy should still say
// who to contact for an unmarked one.
//
// The source render (renders/v<ver>/<base>.jpg) is never touched — this writes
// a sibling <base>-watermarked.jpg beside it and reuses that file on later
// requests, regenerating only when the source is newer (a re-render, e.g. after
// publishing a new version, invalidates the cached stamp automatically).

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Tile `text` diagonally across a width×height page as translucent grey text.
 *  Returns the `<g>` alone, so it can be composited onto a raster (below) or
 *  appended to a vector document (watermarkSvgDocument). */
export function watermarkLayer(width, height, text = 'BusMaps.uk', { opacity = 0.32 } = {}) {
  const fontSize = Math.round(Math.min(width, height) * 0.075);
  const stepX = fontSize * 6.5;
  const stepY = fontSize * 4.5;
  const tiles = [];
  // Overshoot well past the edges so rotation never leaves a corner bare.
  for (let y = -height * 0.5; y < height * 1.5; y += stepY) {
    for (let x = -width * 0.5; x < width * 1.5; x += stepX) {
      tiles.push(
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial, Helvetica, sans-serif" `
        + `font-size="${fontSize}" font-weight="bold" fill="#808080" fill-opacity="${opacity}">${esc(text)}</text>`,
      );
    }
  }
  return `<g transform="rotate(-30 ${(width / 2).toFixed(1)} ${(height / 2).toFixed(1)})" `
    + `aria-hidden="true" pointer-events="none">${tiles.join('')}</g>`;
}

/** The raster overlay: the same layer, wrapped as a standalone document for sharp. */
function watermarkSvg(width, height, text = 'BusMaps.uk') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + watermarkLayer(width, height, text) + `</svg>`;
}

/** The user-space box of an SVG root, whatever units the generator chose. */
function viewBoxOf(svg) {
  const m = svg.match(/<svg\b[^>]*\bviewBox\s*=\s*"([^"]+)"/i);
  if (!m) return null;
  const p = m[1].trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) return null;
  return { x: p[0], y: p[1], w: p[2], h: p[3] };
}

/**
 * Watermark a VECTOR document — the same diagonal tiling, appended to an SVG
 * string as its last child so it sits over the artwork (OA-154 D1).
 *
 * WHY A SECOND MEDIUM AT ALL. The JPG path above exists because a downloaded file
 * gets forwarded. The adviser's screen is the mirror case: there is no file, and
 * the thing that gets forwarded is a SCREENSHOT of an unpublished draft — which is
 * exactly how an unverified sheet reaches a Facebook group. Marking the pixels the
 * adviser is looking at is the only marking a screenshot carries.
 *
 * NOTHING IS WRITTEN TO DISK. The draft-marked source is already cached beside the
 * render by draftStamp.js; this is a string transform on the way out, because the
 * text depends on who is looking and a cached file would not.
 *
 * Returns the input unchanged when it cannot read a viewBox, which is the same
 * fall-back every other marker here takes: a sheet we cannot measure is served
 * plain rather than not served.
 */
export function watermarkSvgDocument(svgText, text) {
  const box = viewBoxOf(svgText);
  const close = svgText.lastIndexOf('</svg>');
  if (!box || close < 0) return svgText;
  const layer = watermarkLayer(box.w, box.h, text)
    .replace('<g transform="rotate(', `<g transform="translate(${box.x} ${box.y}) rotate(`);
  return svgText.slice(0, close) + layer + svgText.slice(close);
}

/** Where the cached watermarked variant of a <base>.jpg source file lives. */
export function watermarkedPathFor(sourceJpgPath) {
  const dir = path.dirname(sourceJpgPath);
  const base = path.basename(sourceJpgPath, '.jpg');
  return path.join(dir, `${base}-watermarked.jpg`);
}

/**
 * Return a path to a watermarked copy of `sourceJpgPath`, generating (or
 * regenerating, if the source is newer) it first if needed. Returns null if
 * the source doesn't exist. Never throws for bad/odd images — callers should
 * fall back to the original file on error.
 */
export async function ensureWatermarked(sourceJpgPath) {
  if (!existsSync(sourceJpgPath)) return null;
  const outPath = watermarkedPathFor(sourceJpgPath);
  const srcStat = statSync(sourceJpgPath);
  if (existsSync(outPath) && statSync(outPath).mtimeMs >= srcStat.mtimeMs) {
    return outPath;
  }
  const meta = await sharp(sourceJpgPath).metadata();
  const overlay = Buffer.from(watermarkSvg(meta.width, meta.height));
  await sharp(sourceJpgPath)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: meta.density || 300 })
    .toFile(outPath);
  return outPath;
}
