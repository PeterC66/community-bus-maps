// The town's complexity band, carried and shown (buses-data OA-088).
//
//   node scripts/test-complexity-band.mjs        (or: npm run test:complexity-band)
//
// THE FINDING. The bus skill scores every town at the end of S2 and writes
// `complexity.json` — a band of GREEN, AMBER or RED and the measure that tripped
// it. RED is the one verdict in the pipeline that says "do not build the
// standard single sheet; choose a strategy first". S4 pulls S2's outputs, S5
// copies them on, and `import-map.mjs` keeps every `*.json` in a payload, so
// the file has ridden with every AREA delivery since the first one. On
// 2026-09-05 all eight area maps on the live host held theirs, one of them RED
// and published, and the string "complexity" appeared in this repository only
// inside the vendored engine. The same shape as `build-warnings.txt` (OA-046),
// five days later, for the other file the engine writes about its own work.
//
// THE ASSERTIONS THAT MATTER MOST are the two "nothing to say" states. An
// absent or unrecognised file reports `null`, never a guessed band. And a PLACE
// pack carries no score because the gate scores towns — so the screen must not
// call that a gap, while an AREA pack without one IS a gap and must be said.
//
// Runs against a throwaway DATA_DIR; no network, no email, no real portal data.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSES_DIR } from './lib/buses-dir.mjs';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-complexity-'));
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
const { readComplexity, COMPLEXITY, mapDataDir } = store;

const write = (dir, body) => { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, COMPLEXITY), typeof body === 'string' ? body : JSON.stringify(body)); return dir; };

// ===========================================================================
console.log('\nreadComplexity — absent is null, and so is anything it does not recognise');

eq('a folder with no score reports null', readComplexity(path.join(scratch, 'empty-dir')), null);
mkdirSync(path.join(scratch, 'really-empty'), { recursive: true });
eq('…and so does a folder that exists but holds none', readComplexity(path.join(scratch, 'really-empty')), null);
eq('a file that is not JSON reports null', readComplexity(write(path.join(scratch, 'garbage'), 'not json\n')), null);
eq('a band the gate never writes is unrecognised, not passed through',
  readComplexity(write(path.join(scratch, 'purple'), { band: 'PURPLE', metrics: {} })), null);
eq('a JSON file with no band at all reports null', readComplexity(write(path.join(scratch, 'noband'), { metrics: { R: 3 } })), null);

// The real shapes — the field set the gate writes, trimmed to what is read.
// A GREEN town with no remedy keys (every `applied` value is null, which is how
// the gate writes "none").
const green = readComplexity(write(path.join(scratch, 'green'), {
  scoredAt: '2026-07-28 09:32', band: 'GREEN', failedThresholds: [],
  metrics: { R: 8, S: 60, K5: 0, D5: 0, linesDrawn: 8 },
  applied: { internalCorridors: null, corridorPalette: null, coreBox: null, stopThinning: null },
}));
eq('a GREEN town reports its band', green && green.band, 'GREEN');
eq('…no failed thresholds', green && green.failed, []);
eq('…no remedy keys when every applied value is null', green && green.applied, []);
eq('…only the five named metrics, and only those present', green && green.metrics, { R: 8, S: 60, K5: 0, D5: 0 });
eq('…and when it was scored', green && green.scoredAt, '2026-07-28 09:32');

// A RED town built with the ladder — High Wycombe's own shape, values trimmed.
const red = readComplexity(write(path.join(scratch, 'red'), {
  scoredAt: '2026-09-01 23:07', band: 'RED', failedThresholds: ['P=145 > 110'],
  metrics: { R: 11, S: 91, K5: 0, D5: 0, P: 145 },
  applied: { internalCorridors: [['1', '1A']], corridorPalette: [['1', '41']], coreBox: { radius: 600 }, stopThinning: {} },
}));
eq('a RED town reports its band', red && red.band, 'RED');
eq('…the measure that tripped it', red && red.failed, ['P=145 > 110']);
eq('…and every remedy key the build carried, by name', red && red.applied, ['internalCorridors', 'corridorPalette', 'coreBox', 'stopThinning']);
eq('…with P read when it is present', red && red.metrics.P, 145);

// A file whose failedThresholds carries something other than strings, and no scoredAt.
const odd = readComplexity(write(path.join(scratch, 'odd'), { band: 'AMBER', failedThresholds: ['K5=0.54 > 0.5', 7, null] }));
eq('non-string thresholds are dropped rather than rendered', odd && odd.failed, ['K5=0.54 > 0.5']);
eq('a missing scoredAt is null, not undefined', odd && odd.scoredAt, null);

// Against the REAL corpus when it is present — the newest S2 run of each town.
// CI checks out only this repository, so this is skipped there rather than
// failed: a check that cannot run must not report a pass it did not make.
const TREE = path.join(BUSES_DIR, 'Areas');
if (existsSync(TREE)) {
  const found = [];
  for (const town of readdirSync(TREE, { withFileTypes: true })) {
    if (!town.isDirectory()) continue;
    const s2 = path.join(TREE, town.name, 'S2-geometry');
    let runs; try { runs = readdirSync(s2).sort(); } catch { continue; }
    const last = runs.length ? path.join(s2, runs[runs.length - 1]) : null;
    if (last && existsSync(path.join(last, COMPLEXITY))) found.push([town.name, last]);
  }
  check(`the real map tree supplied ${found.length} score(s) to parse`, found.length > 0);
  for (const [name, d] of found) {
    const r = readComplexity(d);
    check(`parses a real one: ${name} → ${r && r.band}${r && r.failed.length ? ' (' + r.failed.join(', ') + ')' : ''}`,
      r !== null && ['GREEN', 'AMBER', 'RED'].includes(r.band), JSON.stringify(r));
  }
} else {
  console.log('  · the Buses map tree is not on this machine — the real-corpus arm is SKIPPED, not passed');
}

// ===========================================================================
console.log('\nthe delivery carries it, the review screen shows it, the decision records it');

// Nothing in the importers had to learn this filename: they keep every *.json
// in a payload, and the score IS one. Pin that, because a future "copy only the
// inputs we know" tidy-up would silently stop the band travelling.
for (const f of ['scripts/import-map.mjs', 'scripts/propose-update.mjs']) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  check(`${f} still keeps every *.json in a payload, which is how the score travels`, src.includes("f.endsWith('.json')"));
}

const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');
const { CHECKLIST } = await import('../src/publish/index.js');
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

const custId = db.insertCustomer({ name: 'Test Council', type: 'council' });
const approverId = db.insertUser({ email: 'approver@example.com', name: 'Approver', role: 'admin', customer_id: custId });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: custId });
const tok = `tok-${Math.random().toString(36).slice(2)}`;
db.insertSession(tok, approverId, sqlPlus(7 * 86_400_000));   // fresh, so step-up is satisfied
const CSRF = 'test-csrf-token-value';
const headers = { cookie: `cbm_session=${tok}; cbm_csrf=${CSRF}`, 'x-csrf-token': CSRF, 'content-type': 'application/json' };

const mapId = db.insertMap({ customer_id: custId, slug: 'red-town', name: 'Red Town', kind: 'area', status: 'draft' });
const verId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
const reqId = db.insertPublishRequest({ map_id: mapId, version_id: verId, requested_by: editorId });
store.ensureMapDirs(mapId);

const review = async () => (await app.inject({ method: 'GET', url: `/api/review/${reqId}`, headers })).json();

// A pack that carries no score — the common case for a place, the gap case for an area.
eq('a version whose pack carried no score says null, not a band', (await review()).complexity, null);

// Now the map's data dir holds one, exactly as a delivery leaves it.
write(mapDataDir(mapId), readFileSync(path.join(scratch, 'red', COMPLEXITY), 'utf8'));
const shown = (await review()).complexity;
eq('once the pack carries one, the review screen is told the band', shown && shown.band, 'RED');
eq('…and the measure that tripped it', shown && shown.failed, ['P=145 > 110']);

// The decision records what the approver was told. Approve it and read the
// evidence back off the request row, not off the response.
const ticked = { checklist: Object.fromEntries(CHECKLIST.map((c) => [c.id, true])) };
const approved = await app.inject({ method: 'POST', url: `/api/review/${reqId}/approve`, headers, payload: ticked });
eq('the approval goes through (a different user from the submitter)', approved.statusCode, 200);
const pr = db.getPublishRequest(reqId);
const evidence = JSON.parse(pr.evidence_json || '{}');
eq('…and the decision evidence carries the band', evidence.complexity && evidence.complexity.band, 'RED');
eq('…the threshold', evidence.complexity && evidence.complexity.failed, ['P=145 > 110']);
eq('…and when it was scored', evidence.complexity && evidence.complexity.scoredAt, '2026-09-01 23:07');
check('…while the checklist is still there beside it', evidence.checklist && Object.keys(evidence.checklist).length === CHECKLIST.length);
const decided = await review();
eq('the decided request hands the evidence band back to the screen', decided.request.evidence.complexity.band, 'RED');

// A second map with no score: the evidence must NOT carry a complexity key at all,
// so a later reader cannot mistake "not recorded" for a band.
const map2 = db.insertMap({ customer_id: custId, slug: 'plain-place', name: 'Plain Place', kind: 'place', status: 'draft' });
const ver2 = db.insertVersion({ map_id: map2, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
const req2 = db.insertPublishRequest({ map_id: map2, version_id: ver2, requested_by: editorId });
store.ensureMapDirs(map2);
const approved2 = await app.inject({ method: 'POST', url: `/api/review/${req2}/approve`, headers, payload: ticked });
eq('a scoreless pack still publishes', approved2.statusCode, 200);
eq('…and its evidence has no complexity key rather than a null one', 'complexity' in JSON.parse(db.getPublishRequest(req2).evidence_json || '{}'), false);

// The screen's own renderer must tell the states apart, and the two silent
// ones are the ones worth asserting.
const ui = readFileSync(path.join(ROOT, 'public', 'app', 'review.js'), 'utf8');
check('the review screen has a renderer for the band', ui.includes('function complexityHtml'));
check('…which says so when an AREA pack carried none', /c === null/.test(ui) && /did not travel/.test(ui));
check('…and stays silent for a place, whose pack never carries one', /kind === 'place'\) return ''/.test(ui));
check('…and warns on RED in the same register as a blocking build', /c\.band === 'RED'/.test(ui) && /rd-warn/.test(ui));
check('…and the screen actually calls it, with the kind', ui.includes('complexityHtml(body.complexity, r.map.kind)'));
check('…and the decided view shows the band on record', ui.includes('r.evidence.complexity'));

const adminHtml = readFileSync(path.join(ROOT, 'views', 'app', 'admin.html'), 'utf8');
check('the map-requests screen tells the admin to score an area before approving it', /Score an area before you approve it/.test(adminHtml));

// ===========================================================================
console.log(failures ? `\n${failures} FAILED\n` : '\nAll complexity-band assertions pass.\n');
process.exit(failures ? 1 : 0);
