// vendor-engine.mjs — copy every vendored engine file from its skill source,
// then restamp the manifest and audit the result.
//
//   node scripts/vendor-engine.mjs --dry-run      (say what would move)
//   node scripts/vendor-engine.mjs                (do it, then restamp + audit)
//   node scripts/vendor-engine.mjs --skills "C:/u3a St Ives/.claude/skills"
//
// Run from the repository root. `--skills` points at the folder holding
// make-bus-leaflet/ and make-place-bus-leaflet/; it defaults to
// `skillRootDefault` in engine/vendored.json, and SKILL_ROOT overrides that.
//
// WHY THIS EXISTS. The July 2026 engine-deduplication proposal recommended two
// things: a drift check that makes a stale copy loud (built 2026-08-25 as
// check-vendored.mjs, and in `npm test` since), and a vendor script so the
// copying itself is not done by hand. Only the first was built, and on
// 2026-08-26 the second's absence cost exactly what the proposal predicted: a
// generator was copied across and the new module it had started requiring at
// load, lane_normals.js, was not.
//
// WHAT IT CANNOT DO, said plainly because the limit is the interesting part.
// This script copies the files the manifest already NAMES. It cannot invent a
// row for a module that has just been added upstream — the manifest is the input,
// so a file nobody has listed is a file it will not fetch. That is not a gap this
// script can close by trying harder; it is why `requireScan()` in
// scripts/lib/vendored.mjs enumerates a third population, what the vendored CODE
// asks for, and fails when one of those is not here. The two are a pair: this
// one moves the bytes, that one notices when the set of bytes should have grown.
// Neither is sufficient alone.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditVendored, hashOf, restampManifest } from './lib/vendored.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENGINE_DIR = path.join(ROOT, 'engine');
const MANIFEST = path.join(ENGINE_DIR, 'vendored.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const dryRun = flag('dry-run');

if (!existsSync(MANIFEST)) {
  console.error(`✗ no manifest at ${MANIFEST} — engine/vendored.json is what this reads.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const skillRoot = opt('skills') || process.env.SKILL_ROOT || manifest.skillRootDefault || null;

// Absent is not the same as clean, here even more than in the audit: vendoring
// from a tree that is not there would rewrite nothing and report success.
if (!skillRoot || !existsSync(skillRoot)) {
  console.error(`✗ no skill tree to vendor FROM${skillRoot ? `: ${skillRoot}` : ''}.`);
  console.error('  Pass --skills <folder holding make-bus-leaflet/>, or set SKILL_ROOT.');
  console.error('  This needs the laptop; CI has only the portal, and runs check-vendored.mjs instead.');
  process.exit(1);
}

console.log(`vendoring engine/ from ${skillRoot}${dryRun ? '  (DRY RUN — nothing written)' : ''}\n`);

const moved = [];
const same = [];
const absent = [];

for (const entry of manifest.files || []) {
  if (entry.kind !== 'vendored') continue;
  const src = path.join(skillRoot, entry.source);
  const dest = path.join(ENGINE_DIR, entry.path);
  if (!existsSync(src)) {
    absent.push({ ...entry, src });
    continue;
  }
  const before = existsSync(dest) ? hashOf(dest) : null;
  const after = hashOf(src);
  if (before === after) {
    same.push(entry.path);
    continue;
  }
  moved.push({ path: entry.path, source: entry.source, from: before, to: after });
  if (!dryRun) {
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

for (const a of absent) {
  console.error(`  ✗ ${a.path.padEnd(30)} source missing: ${a.source}`);
}
for (const m of moved) {
  const from = m.from ? m.from.slice(0, 12) : 'ABSENT';
  console.log(`  ${dryRun ? '·' : '→'} ${m.path.padEnd(30)} ${from} -> ${m.to.slice(0, 12)}  (${m.source})`);
}
console.log(`\n  ${same.length} already current, ${moved.length} ${dryRun ? 'would move' : 'copied'}, ${absent.length} source missing.`);

if (absent.length) {
  console.error('\n✗ a manifest row names a source that is not in the skill tree — fix the row or the tree.');
  process.exitCode = 1;
}

if (dryRun) {
  console.log('\n· dry run: no file copied, no hash restamped. Re-run without --dry-run.');
  process.exit(process.exitCode || 0);
}

if (moved.length) {
  const today = new Date().toISOString().slice(0, 10);
  const { manifest: restamped, changed } = restampManifest({ engineDir: ENGINE_DIR, manifestPath: MANIFEST, today });
  if (changed.length) {
    writeFileSync(MANIFEST, JSON.stringify(restamped, null, 2) + '\n');
    console.log(`\n✓ restamped ${changed.length} manifest entr${changed.length === 1 ? 'y' : 'ies'}.`);
  }
}

// The audit is the point of running this rather than a shell loop: it asks the
// question the copy cannot, namely whether the files that are now here require
// anything that still is not.
const result = auditVendored({ engineDir: ENGINE_DIR, manifestPath: MANIFEST, skillRoot });
const bad = result.rows.filter((r) => r.status !== 'OK');
if (!bad.length) {
  console.log(`\n✓ ${result.rows.length} engine files accounted for, and every module they require is here.`);
  console.log('  Commit engine/vendored.json WITH the files it describes, then run: npm run verify:place');
} else {
  console.error('');
  for (const r of bad) console.error(`  ✗ ${r.file.padEnd(30)} ${r.status.padEnd(10)} ${r.note || ''}`.trimEnd());
  console.error('\n✗ the copy is done and the audit is not clean — see scripts/check-vendored.mjs for what each word means.');
  console.error('  UNRESOLVED in particular is the one this script cannot fix for you: a module that is required');
  console.error('  but has no manifest row has to be vendored and listed by hand, in this same commit.');
  process.exitCode = 1;
}
