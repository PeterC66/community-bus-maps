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
import { BUSES_DIR } from './lib/buses-dir.mjs';

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

// 3. A blocking build. This comment used to say no real one existed on the map
//    tree, because the rollout STOPS on a blocking warning; the sweep of
//    2026-09-14 found two, and `fixtures/build-warnings/blocking/` is one of
//    them. The synthetic case stays — it carries TWO blocking lines and a WARN
//    section under them, which no real file does.
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

// 5. AGAINST CAPTURED REAL OUTPUT, WHICH RUNS EVERYWHERE. Cases 1-4 are files
//    this test wrote, so between them they can only confirm what whoever wrote
//    the parser believed the engine emits — and on 2026-09-14 that belief was
//    fifteen days out of date. `build_log.js` gained `, and K measurement(s).`
//    on 2026-08-30 (buses-data OA-118) and the old regex required the full stop
//    straight after "blocking", so 595 of the 900 real files parsed as null,
//    including both of the only two in the estate's history that report a
//    BLOCKING warning. The arm that would have caught it is case 6 below, which
//    has never run in CI and which sampled three copies of one place's sheet on
//    the laptop. These five are verbatim engine output, committed — one per
//    shape the sweep found. See scripts/fixtures/README.md.
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures', 'build-warnings');
console.log('');
{
  const f = (name) => path.join(FIXTURES, name);

  const plain = readBuildWarnings(f('counted-plain'));
  eq('a real pre-measurement summary parses', plain && [plain.total, plain.blocking], [1, 0]);

  // THE ONE THAT WAS BROKEN. Every current town render carries this shape.
  const measured = readBuildWarnings(f('counted-with-measurements'));
  check('a real summary with a measurement clause parses at all', measured !== null,
    'null — the parser cannot read what the engine writes today');
  eq('…and counts the warnings apart from the measurements', measured && [measured.total, measured.blocking], [10, 0]);

  const blocked = readBuildWarnings(f('blocking'));
  check('a real BLOCKING build is readable', blocked !== null, 'null — the approver would see nothing');
  eq('…and reports the blocking count', blocked && blocked.blocking, 1);
  eq('…and names the one blocking line', blocked && blocked.blockingLines.length, 1);
  check('…and takes it from the BLOCKING section, not the 22 WARN lines under it',
    blocked && /Chiltern Main Line/.test(blocked.blockingLines[0] || ''), JSON.stringify(blocked && blocked.blockingLines));

  // A file that SAYS zero is a zero. Distinct from the absent file in case 1,
  // which is the one case that must stay null.
  const none = readBuildWarnings(f('no-warnings'));
  check('the zero-warning line is read as zero rather than as unreadable', none !== null, 'null');
  eq('…as a real zero, and no blocking lines', none && [none.total, none.blocking, none.blockingLines.length], [0, 0, 0]);

  // Five real files on the tree are raw entries with no summary at all. This is
  // case 4's assertion made against something the engine really wrote, rather
  // than against a string invented to be unrecognisable.
  eq('a real file with no summary line reports null, like the invented garbage above',
    readBuildWarnings(f('no-summary-line')), null);
}

// 6. Against the LIVE corpus when it is present. Only this arm can notice the
//    engine changing its format, which is exactly the change case 5 failed to
//    notice for fifteen days — a capture is frozen by construction. CI checks
//    out only this repository, so it skips there rather than failing.
//
//    ONE PER TOWN, NOT THE FIRST THREE IT MEETS. Until 2026-09-14 this walked
//    depth-first and stopped at three, which on this tree meant three versions
//    of ONE place's sheet, all three in the one shape that still parsed. A
//    sample that stops at the first branch is an anecdote; spread it across the
//    top-level folders so the shapes differ.
console.log('');
const TREE = path.join(BUSES_DIR, 'Areas');   // env first, one named default (OA-232 Tier 1.6)
if (existsSync(TREE)) {
  const newestIn = (town) => {
    let best = null;
    (function walk(d, depth) {
      if (depth > 5) return;
      let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name === BUILD_WARNINGS && (best === null || p > best)) best = p;
      }
    })(path.join(TREE, town), 0);
    return best && path.dirname(best);
  };
  const towns = readdirSync(TREE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const found = towns.map((t) => [t, newestIn(t)]).filter(([, d]) => d);
  check(`the real map tree supplied ${found.length} build report(s) to parse, one per town`, found.length > 0);
  for (const [town, d] of found) {
    const r = readBuildWarnings(d);
    check(`parses a real one: ${town} — ${readFileSync(path.join(d, BUILD_WARNINGS), 'utf8').split('\n')[0]}`,
      r !== null && Number.isFinite(r.total) && Number.isFinite(r.blocking), JSON.stringify(r));
  }
} else {
  console.log('  · the Buses map tree is not on this machine — the live-corpus arm is SKIPPED, not passed');
  console.log('    (the CAPTURED corpus above still ran; it is frozen, so only this arm sees a format change.)');
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
