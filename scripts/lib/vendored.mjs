// The vendored-engine audit (technical-audit_2026-08-25 N14).
//
// `engine/` holds byte-for-byte copies of files whose source of truth lives in
// the two map skills. Until now the ONLY thing that noticed a copy going stale
// was `status.js` in the skills repository, run from the laptop with both trees
// on disk. A developer working only in `community-bus-maps` — which is the
// natural way a second person onboards — had no way to find out that
// `engine/icons.js` had diverged from its source, and CI had no way either.
//
// This module answers two different questions, and it is worth being clear
// which is which, because only one of them can be asked in CI:
//
//   1. HAS THE PORTAL'S COPY BEEN EDITED SINCE IT WAS VENDORED?  Answered from
//      `engine/vendored.json` alone, so it runs anywhere, including CI. The
//      manifest records a hash per vendored file; re-vendoring means updating
//      it (`node scripts/check-vendored.mjs --update`), which puts the change
//      in the diff where a reviewer meets it. An edit made straight to the
//      portal's copy — the failure mode that produces a portal rendering
//      differently from the skill for months — fails this check immediately.
//
//   2. HAS THE SOURCE MOVED ON WITHOUT US?  Only answerable where the skill
//      trees are on disk, i.e. the laptop. Skipped, LOUDLY and by name, when
//      they are not: a check that cannot run must say so rather than pass.
//
// It also refuses to be an enumeration. Every `.js` file under `engine/` must
// appear in the manifest as either `vendored` (with a source and a hash) or
// `portal-owned` (with a reason), and a file on disk that the manifest does not
// name is a FAILURE, not a silence. That rule is the whole point: `status.js`
// listed eleven files and the tree held sixteen, so `engine/area/*` and
// `engine/place/gen_internal_place.js` were vendored copies no gate has ever
// looked at — and one of them, `gen_external_radial.js`, had been stale since
// 2026-08-21, missing the March X32 badge-overlap fix and the `sheetQr`
// default. Three files unwatched, one of them actually wrong. A list you have
// to remember to extend is not a control; enumerating the tree is.
//
// Hashes are taken over CRLF-normalised bytes, the same rule
// `sameIgnoringLineEndings()` uses in the skills' gate_lib.js, so a checkout
// under `core.autocrlf=true` does not report every file as drifted.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Bytes as they are compared: line endings normalised, nothing else touched. */
export function normalised(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

export function hashOf(file) {
  return createHash('sha256').update(normalised(file), 'utf8').digest('hex');
}

/** Every .js file under a directory, as paths relative to it, POSIX-separated. */
export function listEngineFiles(engineDir) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith('.js')) out.push(rel);
    }
  };
  walk(engineDir, '');
  return out;
}

/**
 * Audit the vendored engine.
 *
 * @param {object} opts
 * @param {string} opts.engineDir    the portal's engine/ folder
 * @param {string} opts.manifestPath engine/vendored.json
 * @param {string|null} opts.skillRoot  folder holding make-bus-leaflet/ and
 *        make-place-bus-leaflet/, or null/absent to skip question 2
 * @returns {{rows: Array, ok: boolean, sourceChecked: boolean, skipReason: string|null}}
 */
export function auditVendored({ engineDir, manifestPath, skillRoot }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = manifest.files || [];
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const onDisk = listEngineFiles(engineDir);

  // Question 2 is only asked when the source tree is actually there. Absent is
  // not the same as clean, so the caller is told which it got.
  let sourceChecked = false;
  let skipReason = null;
  if (!skillRoot) {
    skipReason = 'no --skills / SKILL_ROOT given';
  } else if (!existsSync(skillRoot)) {
    skipReason = `skill tree not on this machine: ${skillRoot}`;
  } else {
    sourceChecked = true;
  }

  const rows = [];

  for (const rel of onDisk) {
    const entry = byPath.get(rel);
    if (!entry) {
      rows.push({ file: rel, kind: '?', status: 'UNLISTED', note: 'on disk, not named in engine/vendored.json — classify it as vendored or portal-owned' });
      continue;
    }
    if (entry.kind === 'portal-owned') {
      rows.push({ file: rel, kind: 'portal-owned', status: entry.why ? 'OK' : 'NO-REASON', note: entry.why ? '' : 'a portal-owned entry must say why it is not vendored' });
      continue;
    }
    const full = path.join(engineDir, rel);
    const actual = hashOf(full);
    if (actual !== entry.sha256) {
      rows.push({
        file: rel, kind: 'vendored', status: 'EDITED',
        note: `hash ${actual.slice(0, 12)} ≠ manifest ${String(entry.sha256).slice(0, 12)} — re-vendor and run --update, or revert the edit`,
      });
      continue;
    }
    if (!sourceChecked) {
      rows.push({ file: rel, kind: 'vendored', status: 'OK', note: 'hash only' });
      continue;
    }
    const src = path.join(skillRoot, entry.source);
    if (!existsSync(src)) {
      rows.push({ file: rel, kind: 'vendored', status: 'NO-SOURCE', note: `source missing: ${entry.source}` });
      continue;
    }
    const same = hashOf(src) === actual;
    rows.push({
      file: rel, kind: 'vendored', status: same ? 'OK' : 'DRIFTED',
      note: same ? '' : `source ${entry.source} has moved on — re-vendor it`,
    });
  }

  // Listed but absent. A vendored file that DIFFERS is stale output; one that
  // is ABSENT is a require() that throws, which is worse — the same ordering
  // status.js had to be taught on 2026-08-18.
  for (const entry of entries) {
    if (!onDisk.includes(entry.path)) {
      rows.push({ file: entry.path, kind: entry.kind, status: 'MISSING', note: 'named in the manifest, absent from engine/' });
    }
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));
  const ok = rows.every((r) => r.status === 'OK');
  return { rows, ok, sourceChecked, skipReason };
}

/** Recompute every vendored hash from the portal's current copies. */
export function restampManifest({ engineDir, manifestPath, today }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const changed = [];
  for (const entry of manifest.files || []) {
    if (entry.kind !== 'vendored') continue;
    const full = path.join(engineDir, entry.path);
    if (!existsSync(full)) continue;
    const actual = hashOf(full);
    if (actual !== entry.sha256) {
      changed.push({ file: entry.path, from: entry.sha256, to: actual });
      entry.sha256 = actual;
      entry.vendoredOn = today;
    }
  }
  return { manifest, changed };
}
