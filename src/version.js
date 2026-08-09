// Single source of truth for the app build identity (GO-LIVE.md §5). Distinct
// from map versions (v1.1, on the public page), document versions (the
// docstamp hook) and engine/template versions (S6) — this is the ONE that
// answers "which build of the app produced what I'm looking at".
//
// APP_VERSION always comes from package.json — never hardcode it elsewhere.
// GIT_SHA prefers GIT_SHA/SOURCE_COMMIT set at Docker build time (see
// Dockerfile ARG); falling back to reading .git/HEAD directly (no `git`
// binary needed, and none is assumed present in the production image).
// BUILT_AT prefers a build-time env var too, falling back to process start —
// good enough locally, where "build" and "boot" are the same moment anyway.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch { return '0.0.0'; }
}

function readGitShaFromDotGit() {
  try {
    const gitDir = path.join(ROOT, '.git');
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5).trim() : null;
    const sha = ref ? readFileSync(path.join(gitDir, ref), 'utf8').trim() : head;
    return sha.slice(0, 7) || null;
  } catch { return null; }
}

export const APP_VERSION = readPackageVersion();
export const GIT_SHA = process.env.GIT_SHA || process.env.SOURCE_COMMIT || readGitShaFromDotGit() || 'unknown';
export const BUILT_AT = process.env.BUILT_AT || new Date().toISOString();
