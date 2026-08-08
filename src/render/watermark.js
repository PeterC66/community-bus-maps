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

/** Tile "BusMaps.uk" diagonally across a width×height page as translucent grey text. */
function watermarkSvg(width, height, text = 'BusMaps.uk') {
  const fontSize = Math.round(Math.min(width, height) * 0.075);
  const stepX = fontSize * 6.5;
  const stepY = fontSize * 4.5;
  const tiles = [];
  // Overshoot well past the edges so rotation never leaves a corner bare.
  for (let y = -height * 0.5; y < height * 1.5; y += stepY) {
    for (let x = -width * 0.5; x < width * 1.5; x += stepX) {
      tiles.push(
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial, Helvetica, sans-serif" `
        + `font-size="${fontSize}" font-weight="bold" fill="#808080" fill-opacity="0.32">${esc(text)}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<g transform="rotate(-30 ${(width / 2).toFixed(1)} ${(height / 2).toFixed(1)})">${tiles.join('')}</g>`
    + `</svg>`;
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
