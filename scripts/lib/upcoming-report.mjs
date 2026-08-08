// Shared parsing for the Buses side's monthly "get ahead" GTFS scan
// (upcoming-report_<date>.md), used by both scripts/check-upcoming-refreshes.mjs
// (flags already-built maps) and scripts/import-map.mjs (seeds a new map's
// banner at build time if we already know of a change it doesn't reflect yet).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const BUSES_DIR = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
export const UPCOMING_DIR = path.join(BUSES_DIR, '_gtfs', 'upcoming');

export function newestReportPath() {
  if (!existsSync(UPCOMING_DIR)) return null;
  const files = readdirSync(UPCOMING_DIR).filter((f) => /^upcoming-report_\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  return files.length ? path.join(UPCOMING_DIR, files[files.length - 1]) : null;
}

export function reportDateOf(reportPath) {
  return (path.basename(reportPath).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || path.basename(reportPath);
}

/**
 * One section per town: "## <Town> — N upcoming[, M to verify]" followed by its
 * "_region ..._" line and bullet items, up to the next "## " or EOF. Split on the
 * heading marker rather than a lookahead-bounded regex — CRLF line endings make
 * `$`/`\n?$` match at every line end in multiline mode, not just EOF, so a
 * lookahead-based "stop before the next heading or EOF" silently stopped after
 * the section's FIRST line every time.
 * @returns {Array<{town:string, upcoming:string, toVerify:string|null, bullets:string[]}>}
 */
export function parseSections(md) {
  return md.split(/^## /m).slice(1).map((part) => {
    const m = part.match(/^(.+?) — (\d+) upcoming(?:, (\d+) to verify)?\r?\n([\s\S]*)$/);
    if (!m) return null;
    const bullets = m[4].split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().startsWith('- '));
    return { town: m[1].trim(), upcoming: m[2], toVerify: m[3] || null, bullets };
  }).filter(Boolean);
}

/**
 * A short, public-facing sentence for a map's "changes coming" banner — plain
 * text (no markdown), capped to the DB column's 500 chars. Just the first (most
 * relevant) bullet plus a count of any others.
 */
export function summariseBullet(line) {
  return line.replace(/^- /, '').replace(/\*\*/g, '').trim();
}
export function bannerNoteFor(bullets) {
  if (!bullets || !bullets.length) return null;
  const first = summariseBullet(bullets[0]);
  const more = bullets.length > 1 ? ` (+${bullets.length - 1} more change${bullets.length > 2 ? 's' : ''} expected)` : '';
  return `${first}${more}`.slice(0, 500);
}

/** Sections whose town matches by exact name (area) or substring (place subject). */
export function sectionsForTown(sections, townOrSubject) {
  const lower = String(townOrSubject || '').toLowerCase();
  if (!lower) return [];
  return sections.filter((s) => lower === s.town.toLowerCase() || lower.includes(s.town.toLowerCase()));
}
