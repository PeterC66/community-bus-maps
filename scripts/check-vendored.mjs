// check-vendored.mjs — does engine/ still match what it was vendored from?
// (technical-audit_2026-08-25 N14; the July 2026 engine-deduplication proposal
// asked for exactly this and only the skills half was ever built.)
//
//   node scripts/check-vendored.mjs                 (run from the repo root)
//   node scripts/check-vendored.mjs --skills "C:/u3a St Ives/.claude/skills"
//   node scripts/check-vendored.mjs --no-skills     (hash check only, as CI runs it)
//   node scripts/check-vendored.mjs --update        (after a deliberate re-vendor)
//   node scripts/check-vendored.mjs --json
//
// --skills points at the folder holding make-bus-leaflet/ and
// make-place-bus-leaflet/. **It comes from `SKILL_ROOT` in `.env`** (see
// `.env.example`), which this script loads; `--skills` overrides that. This
// header said the default was `skillRootDefault` in engine/vendored.json for a
// day after that key was REMOVED from the manifest on 2026-09-02 — it was one
// laptop's absolute path in a file that also ships to a VPS and to CI — and the
// 2026-09-03 review caught the header still describing it (portal-ops V4). The
// read at the bottom of the resolution chain is kept on purpose, as a legacy
// fallback for an old manifest, and `test-vendored.mjs` exercises it; nothing
// tracked here carries the key, and `test-portal-lib.mjs` asserts that.
//
// Where the skill tree is not present — CI, or a second developer's machine —
// the source half of the audit is SKIPPED and says so by name; it never silently
// passes.
//
// Three populations are enumerated, not one, and the third was added on
// 2026-08-26 because the first two between them could not see a real hand-off:
//   • the TREE      — a .js under engine/ the manifest does not name  (UNLISTED)
//   • the MANIFEST  — a row naming a file that is not on disk        (MISSING)
//   • what the CODE ASKS FOR — a module a vendored file requires through
//     SKILL_ASSETS that was never vendored at all                    (UNRESOLVED)
// A file in neither the tree nor the manifest is not a row in either direction.
// That is exactly the state `lane_normals.js` was in: `gen_internal.js` required
// it at load, the portal had never been given it, and the only red row was
// `place/gen_internal.js DRIFTED`, which looks like an ordinary stale vendor.
//
// Exit 1 on any row that is not OK. `process.exitCode` rather than
// `process.exit()`, because status.js aborted on Windows (UV_HANDLE_CLOSING)
// the first time a gate here tore its own process down mid-teardown.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditVendored, restampManifest } from './lib/vendored.mjs';
import { arg, has } from './lib/cli.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENGINE_DIR = path.join(ROOT, 'engine');
const MANIFEST = path.join(ENGINE_DIR, 'vendored.json');

const argv = process.argv.slice(2);
const flag = (name) => has(name, argv);
const opt = (name) => arg(name, null, argv);

if (!existsSync(MANIFEST)) {
  console.error(`✗ no manifest at ${MANIFEST} — engine/vendored.json is what this check reads.`);
  process.exit(1);
}
const manifestJson = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const skillRoot = flag('no-skills')
  ? null
  : (opt('skills') || process.env.SKILL_ROOT || manifestJson.skillRootDefault || null);

if (flag('update')) {
  const today = new Date().toISOString().slice(0, 10);
  const { manifest, changed } = restampManifest({ engineDir: ENGINE_DIR, manifestPath: MANIFEST, today });
  if (!changed.length) {
    console.log('· engine/vendored.json is already current — no hash moved.');
  } else {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    for (const c of changed) console.log(`· ${c.file}: ${c.from.slice(0, 12)} -> ${c.to.slice(0, 12)}`);
    console.log(`\n✓ restamped ${changed.length} entr${changed.length === 1 ? 'y' : 'ies'}. Commit engine/vendored.json WITH the file(s) it describes.`);
  }
  process.exitCode = 0;
} else {
  const result = auditVendored({ engineDir: ENGINE_DIR, manifestPath: MANIFEST, skillRoot });

  if (flag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('vendored engine (engine/vendored.json):\n');
    const w = Math.max(...result.rows.map((r) => r.file.length));
    for (const r of result.rows) {
      const mark = r.status === 'OK' ? '✓' : '✗';
      console.log(`  ${mark} ${r.file.padEnd(w)}  ${r.status.padEnd(9)} ${r.note || ''}`.trimEnd());
    }
    console.log('');
    if (result.sourceChecked) {
      console.log(`· compared against the skill sources in ${skillRoot}`);
    } else {
      console.log(`· SOURCE CHECK SKIPPED (${result.skipReason}) — hashes were verified, but nothing here can`);
      console.log('  tell you whether the skill has moved on. status.js on the laptop is what asks that.');
    }
  }

  if (result.ok) {
    console.log(`\n✓ ${result.rows.length} engine files accounted for.`);
    process.exitCode = 0;
  } else {
    const bad = result.rows.filter((r) => r.status !== 'OK');
    console.error(`\n✗ ${bad.length} of ${result.rows.length} engine files are not as vendored.`);
    console.error('  UNLISTED  → add it to engine/vendored.json as vendored or portal-owned');
    console.error('  EDITED    → the portal copy changed: revert it, or re-vendor and run --update');
    console.error('  DRIFTED   → the skill source moved: re-vendor (changing-the-engine.md §4) and run --update');
    console.error('  MISSING   → a vendored file is gone; a require() will throw, not a byte gate');
    console.error('  UNRESOLVED→ a vendored file requires a module the portal has NEVER been given:');
    console.error('              vendor it too, IN THE SAME COMMIT — the command is printed below');
    /*
     * THE EXACT COMMAND, not a procedure (OA-224 Tier 3.6). This used to end with
     * "add its manifest row by hand", and the row holds a SHA-256 — the one thing
     * in this repository nobody can check by eye. `--add` writes the row and lets
     * restampManifest() fill the hash in from the bytes that land.
     *
     * The SOURCE is a guess and is printed as one. Where a skill tree is at hand
     * it is resolved for real, by looking; where it is not — CI, the VPS — the
     * likely paths are offered and the caller picks. A guess presented as a fact
     * is how a wrong `source` gets committed, and a wrong `source` makes DRIFTED
     * mean nothing for that row for ever.
     */
    const unresolved = bad.filter((r) => r.status === 'UNRESOLVED');
    if (unresolved.length) {
      const SKILL_ASSET_DIRS = ['make-bus-leaflet/assets', 'make-place-bus-leaflet/assets'];
      console.error('\n  From the repository root, with no placeholders left in it:');
      for (const r of unresolved) {
        const found = skillRoot
          ? SKILL_ASSET_DIRS.map((d) => `${d}/${r.file}`).filter((s) => existsSync(path.join(skillRoot, s)))
          : [];
        const sources = found.length ? found : SKILL_ASSET_DIRS.map((d) => `${d}/${r.file}`);
        for (const s of sources) {
          const doubt = found.length ? '' : '   # source unverified — no skill tree here to look in';
          console.error(`    node scripts/vendor-engine.mjs --add ${r.file} --source ${s}${doubt}`);
        }
        if (found.length > 1) console.error(`              (${r.file} exists in both skills — pick the one the vendored copy came from)`);
      }
    }
    process.exitCode = 1;
  }
}
