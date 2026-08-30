// The engine's build verdict, carried and shown (OA-046).
//
//   node scripts/test-build-warnings.mjs        (or: npm run test:build-warnings)
//
// THE FINDING. The bus skill writes `build-warnings.txt` beside every S4 and S5
// run — a count line, then the warnings, where BLOCKING means the engine refused
// to draw something or drew a label that names nothing. There were 161 of them
// on the map tree and the string "build-warnings" appeared NOWHERE in this
// repository: not in src/, not in scripts/, not in engine/. The verdict was
// computed, was correct, was acted on once by whoever watched the rollout
// terminal, and was then thrown away by two mechanisms that each look reasonable
// on their own.
//
// THE ONE ASSERTION THAT MATTERS MOST is that an absent file reports `null` and
// never a zero. A false zero would tell an approver the engine was happy with a
// sheet it had refused to draw — strictly worse than saying nothing, because it
// is the answer they would act on. Every pack delivered before 2026-08-30
// carries no file, so this is the common case, not the edge one.
//
// Runs against a throwaway DATA_DIR; no network, no email, no real portal data.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-buildwarn-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const store = await import('../src/maps/store.js');
const { readBuildWarnings, BUILD_WARNINGS, mapDataDir } = store;

const write = (dir, body) => { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, BUILD_WARNINGS), body); return dir; };

// ===========================================================================
console.log('\nreadBuildWarnings — the three states');

// 1. ABSENT is null, not zero. The whole point.
eq('a folder with no build report reports null', readBuildWarnings(path.join(scratch, 'empty-dir')), null);
mkdirSync(path.join(scratch, 'really-empty'), { recursive: true });
eq('…and so does a folder that exists but holds no report', readBuildWarnings(path.join(scratch, 'really-empty')), null);

// 2. The real shape, copied verbatim from a file the bus skill actually wrote.
//    Written out here rather than read from the map tree, because that tree is a
//    different repository that CI does not check out — but it IS that file's
//    bytes, and the harness re-reads a real one when the tree is present (below).
const clean = write(path.join(scratch, 'clean'), [
  '1 warning, 0 blocking.',
  '',
  'BLOCKING means the engine refused to draw something, or drew a label that names',
  'nothing — the sheet is wrong and the reader cannot tell. Fix the config it names.',
  '',
  '--- WARN (1) ---',
  '[internal] northArrow: the configured spot is blocked — placed automatically at 191,179 (nearest clear corner).',
  '',
].join('\n'));
const cw = readBuildWarnings(clean);
eq('a clean build reports its warning count', cw && cw.total, 1);
eq('…and zero blocking', cw && cw.blocking, 0);
eq('…and lists no blocking lines', cw && cw.blockingLines, []);

// 3. A blocking build. No real one exists on the map tree — the rollout STOPS on
//    a blocking warning, which is the plan's step 3 and works — so this is the
//    case the screen must handle and the corpus cannot supply.
const bad = write(path.join(scratch, 'bad'), [
  '4 warnings, 2 blocking.',
  '',
  'BLOCKING means the engine refused to draw something, or drew a label that names',
  'nothing — the sheet is wrong and the reader cannot tell. Fix the config it names.',
  '',
  '--- BLOCKING (2) ---',
  '[internal] poi "hive": no coordinate resolved — the symbol was not drawn.',
  '[external] mapNotes[1]: buried under the Key plate — the note is on the sheet and unreadable.',
  '',
  '--- WARN (2) ---',
  '[internal] northArrow: the configured spot is blocked — placed automatically.',
  '[external] label "Chatteris": placed 3mm from its anchor.',
  '',
].join('\n'));
const bw = readBuildWarnings(bad);
eq('a blocking build reports its total', bw && bw.total, 4);
eq('…and its blocking count', bw && bw.blocking, 2);
eq('…and names both blocking lines', bw && bw.blockingLines.length, 2);
check('…and only the BLOCKING ones, not the WARN section beneath it',
  bw && bw.blockingLines.every((l) => !/northArrow|Chatteris/.test(l)), JSON.stringify(bw && bw.blockingLines));

// 4. Garbage is null, not a guess. A file whose first line we do not recognise is
//    a file we cannot report on honestly.
eq('an unrecognised file reports null rather than guessing',
  readBuildWarnings(write(path.join(scratch, 'garbage'), 'something else entirely\n')), null);

// 5. Against the REAL corpus when it is present. CI checks out only this
//    repository, so this is skipped there rather than failed — a check that
//    cannot run must not report a pass it did not make.
const TREE = 'C:/u3a St Ives/Using AI/Buses/Areas';
if (existsSync(TREE)) {
  const found = [];
  (function walk(d, depth) {
    if (depth > 6 || found.length >= 3) return;
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= 3) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === BUILD_WARNINGS) found.push(d);
    }
  })(TREE, 0);
  check(`the real map tree supplied ${found.length} build report(s) to parse`, found.length > 0);
  for (const d of found) {
    const r = readBuildWarnings(d);
    check(`parses a real one: ${path.basename(d)}`, r !== null && Number.isFinite(r.total) && Number.isFinite(r.blocking),
      `${JSON.stringify(r)} from ${readFileSync(path.join(d, BUILD_WARNINGS), 'utf8').split('\n')[0]}`);
  }
} else {
  console.log('  · the Buses map tree is not on this machine — the real-corpus arm is SKIPPED, not passed');
}

// ===========================================================================
console.log('\nthe delivery carries it, and the review screen shows it');

// The importer's and the stager's copy filters both had to learn the filename;
// everything else they copy is an INPUT and this one is a finding.
for (const f of ['scripts/import-map.mjs', 'scripts/propose-update.mjs']) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  check(`${f} carries ${BUILD_WARNINGS} with the payload`, src.includes('f === BUILD_WARNINGS'));
}

const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

const custId = db.insertCustomer({ name: 'Test Council', type: 'council' });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'admin', customer_id: custId });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: custId });
const tok = `tok-${Math.random().toString(36).slice(2)}`;
db.insertSession(tok, approverId, sqlPlus(7 * 86_400_000));

const mapId = db.insertMap({ customer_id: custId, slug: 'warn-town', name: 'Warn Town', kind: 'area', status: 'draft' });
const verId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
const reqId = db.insertPublishRequest({ map_id: mapId, version_id: verId, requested_by: editorId });
store.ensureMapDirs(mapId);

const review = async () => {
  const r = await app.inject({ method: 'GET', url: `/api/review/${reqId}`, headers: { cookie: `cbm_session=${tok}` } });
  return r.json();
};

// A pack delivered before this change carries no file — the common case, and the
// one the screen must not report as clean.
eq('a version whose pack carried no report says null, not zero', (await review()).buildWarnings, null);

// Now the map's data dir holds one, exactly as a delivery would leave it.
write(mapDataDir(mapId), readFileSync(path.join(bad, BUILD_WARNINGS), 'utf8'));
const shown = (await review()).buildWarnings;
eq('once the pack carries one, the review screen is told the blocking count', shown && shown.blocking, 2);
eq('…and the lines, so the approver knows what to look at', shown && shown.blockingLines.length, 2);

// The screen's own renderer must distinguish all three, and the absent case is
// the one worth asserting: "no warnings" and "we do not know" look identical
// when the answer is simply missing.
const ui = readFileSync(path.join(ROOT, 'public', 'app', 'review.js'), 'utf8');
check('the review screen has a renderer for the verdict', ui.includes('function buildWarningsHtml'));
check('…which says so when the report did not travel', /bw === null/.test(ui) && /did not travel/.test(ui));
check('…and shows the blocking lines when there are any', ui.includes('bw.blockingLines.map'));
check('…and the screen actually calls it', ui.includes('buildWarningsHtml(body.buildWarnings)'));

// ===========================================================================
console.log(failures ? `\n${failures} FAILED\n` : '\nAll build-warning assertions pass.\n');
process.exit(failures ? 1 : 0);
