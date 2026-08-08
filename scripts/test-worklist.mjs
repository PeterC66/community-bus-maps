// Worklist checks — the ranked To-do list behind /api/admin/worklist and the
// admin console's landing tab.
//
//   node scripts/test-worklist.mjs        (or: npm run test:worklist)
//
// What is worth testing here is not "does it list rows" — it is the three
// judgements the module makes that a reader would otherwise have to trust:
//
//   1. RANK. The order is "who is blocked", not "which queue". A publish
//      request outranks a build, which outranks a refresh, which outranks a
//      proposed update nobody has touched.
//   2. WHEN AN ITEM DISAPPEARS. A refresh flag has no read/unread state
//      (nothing in the codebase ever updates message.status), so "still open"
//      is derived from a proposed update staged SINCE the flag. Get that wrong
//      and the list either nags forever or goes quiet while work is undone.
//   3. THE COMMANDS IT HANDS OUT. The verify step must be emitted in
//      PowerShell form: `npm run verify` skips silently without a fixture dir,
//      and bash's `VAR=x cmd` prefix does not set one on Windows — so the bash
//      form yields a check that never runs and looks like it passed.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-worklist-'));
process.env.DATA_DIR = scratch;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const db = await import('../src/db/index.js');
const { buildWorklist } = await import('../src/worklist/index.js');
const { saveStatusSnapshot } = await import('../src/status-snapshot.js');

const keys = () => buildWorklist().items.map((i) => i.key);
const byKey = (k) => buildWorklist().items.find((i) => i.key === k);
const backdate = (table, id, days) =>
  db.db.prepare(`UPDATE ${table} SET created_at = datetime('now', '-${Number(days)} days') WHERE id = ?`).run(id);

console.log('\nWorklist\n');

// --- empty ------------------------------------------------------------------
const empty = buildWorklist();
eq('empty portal ⇒ no items', empty.items.length, 0);
eq('empty portal ⇒ nothing actionable', empty.meta.actionable, 0);

// --- fixtures ---------------------------------------------------------------
const customerId = db.insertCustomer({ name: 'Testshire Parish Council', type: 'council' });

// A built + published-ready map, with a pending publish request against it.
const liveId = db.insertMap({ customer_id: customerId, slug: 'teston', name: 'Teston', kind: 'area', status: 'draft' });
const versionId = db.insertVersion({ map_id: liveId, major: 1, minor: 1, storage_key: 'v1.1' });
db.setCurrentVersion(liveId, versionId);
db.insertPublishRequest({ map_id: liveId, version_id: versionId, note: 'recoloured route 5' });

// An approved request with no data yet — the build queue.
const buildId = db.insertMap({ customer_id: customerId, slug: 'testbury', name: 'Testbury', kind: 'area', subject: 'Testbury', status: 'approved' });
// A place request still awaiting an approval decision.
db.insertMap({ customer_id: customerId, slug: 'testco', name: 'Testco', kind: 'place', subject: 'Testco, Teston', status: 'requested' });
// An organisation waiting to be vetted.
db.insertApplication({ org_name: 'Elsewhere Town Council', org_type: 'council', contact_name: 'A Clerk', email: 'clerk@example.invalid' });

const all = keys();
eq('every queue appears exactly once', all.length, 4);

// --- rank order -------------------------------------------------------------
const order = buildWorklist().items.map((i) => `${i.rank}:${i.type}`);
eq('rank order is review → application → request-decision → build', order, [
  '1:review', '2:application', '3:request-decision', '4:build',
]);
check('bands are labelled', buildWorklist().items.every((i) => typeof i.band === 'string' && i.band.length > 0));
eq('all four are the operator\'s move', buildWorklist().meta.actionable, 4);

// --- the build item's commands ---------------------------------------------
const build = byKey(`build-${buildId}`);
const shell = build.do.filter((d) => d.kind === 'shell').map((d) => d.cmd);
check('build offers the in-place importer command', shell.some((c) => c.includes(`--request ${buildId}`)));
check(
  'verify is emitted in PowerShell form, not bash',
  shell.some((c) => c.startsWith('$env:FIXTURE_DIR = ') && c.includes('npm run verify:area')),
  shell.join(' | '),
);
check('no bash env-var prefix anywhere in the commands', !shell.some((c) => /^[A-Z_]+=/.test(c)), shell.join(' | '));

// A place build must ask for the place fixture var and the place verify script.
const placeBuildId = db.insertMap({ customer_id: customerId, slug: 'testco-built', name: 'Testco', kind: 'place', subject: 'Testco, Teston', status: 'approved' });
const placeShell = byKey(`build-${placeBuildId}`).do.filter((d) => d.kind === 'shell').map((d) => d.cmd);
check('place build uses PLACE_FIXTURE_DIR + verify:place', placeShell.some((c) => c.includes('$env:PLACE_FIXTURE_DIR') && c.includes('verify:place')), placeShell.join(' | '));

// --- refresh flags open and close ------------------------------------------
// Backdated a day: a flag and the staging that answers it are never the same
// second in life (the flag comes from the monthly scan, the staging from a
// human), and SQLite timestamps are second-resolution — so an equal-timestamp
// pair would test an ambiguity rather than the rule. Where it IS ambiguous the
// module keeps the item open, which is the safe direction to err.
const flagId = db.insertMessage({ kind: 'refresh-flag', body: 'Upcoming bus changes for Teston (report 2026-08-01): 3 upcoming.\n\n- route 5 withdrawn', map_id: liveId });
backdate('message', flagId, 1);
check('an unactioned refresh flag becomes a refresh item', keys().includes('refresh-teston'));
eq('refresh sits below the build queue', byKey('refresh-teston').rank, 5);
check('the flag\'s bullet list is carried as detail', /route 5 withdrawn/.test(byKey('refresh-teston').detail || ''));

const proposedId = db.insertProposedUpdate({ map_id: liveId, source_note: 'BODS 2026-08 refresh' });
check('staging a proposed update closes the refresh item', !keys().includes('refresh-teston'));

// --- proposed updates: waiting vs nagging -----------------------------------
eq('a fresh proposed update is somebody else\'s move', byKey(`proposed-${proposedId}`).rank, 9);
check('… and is not counted as actionable', buildWorklist().meta.actionable === 5, String(buildWorklist().meta.actionable));
backdate('proposed_update', proposedId, 20);
eq('one left 20 days becomes a nudge', byKey(`proposed-${proposedId}`).rank, 6);
check('… and the wording changes to say why', /going stale/.test(byKey(`proposed-${proposedId}`).why));

// A flag raised AFTER the last proposed update is open again — the town moved on.
db.insertMessage({ kind: 'refresh-flag', body: 'Upcoming bus changes for Teston (report 2026-09-01): 1 upcoming.', map_id: liveId });
check('a flag raised after the last staging re-opens', keys().includes('refresh-teston'));

// --- links ------------------------------------------------------------------
const linked = buildWorklist({ baseUrl: 'https://busmaps.uk/' });
check('baseUrl is applied without doubling the slash', linked.items.every((i) => !i.where || /^https:\/\/busmaps\.uk\/[a-z]/.test(i.where)),
  linked.items.map((i) => i.where).join(' '));

// --- pushed status snapshot (item 3: ranks 0 / 8) ---------------------------
// Nobody has pushed yet ⇒ no rank 0/8 items — the server guesses nothing.
check('no snapshot ⇒ no gate items', !keys().some((k) => k.startsWith('gate-')));
check('no snapshot ⇒ no housekeeping items', !keys().some((k) => ['nobuild', 'engine-stale', 's6-stale'].includes(k)));

saveStatusSnapshot({
  engine: 'e-current',
  towns: [
    { name: 'Broken Town', version: '6.1', engine: 'e-current', engineCurrent: true, internal: 'DIFF', external: 'PASS' },
    { name: 'Old Engine Town', version: '6.0', engine: 'e-old', engineCurrent: false, internal: 'PASS', external: 'PASS' },
    { name: 'Stale S6 Town', version: '6.1', engine: 'e-current', engineCurrent: true, internal: 'PASS', external: 'PASS', s6: 'run-1', s6Age: 40, s6Stale: true },
    { name: 'Unbuilt Town', internal: 'NO-BUILD', external: '-' },
    { name: 'Healthy Town', version: '6.1', engine: 'e-current', engineCurrent: true, internal: 'PASS', external: 'PASS', s6: 'run-2', s6Stale: false },
  ],
  places: [{ name: 'Broken Place', town: 'Broken Town', internal: 'FAIL', external: 'PASS' }],
  portalDrift: [{ file: 'render.js -> engine/render.js', same: false }, { file: 'icons.js -> engine/icons.js', same: true }],
});

check('a DIFF town becomes a rank-0 gate item', byKey('gate-town Broken Town')?.rank === 0);
check('a FAIL place becomes a rank-0 gate item', byKey('gate-place Broken Place')?.rank === 0);
check('drifted vendoring becomes a rank-0 gate item', byKey('gate-portal vendoring render.js -> engine/render.js')?.rank === 0);
check('in-sync vendoring is not flagged', !keys().includes('gate-portal vendoring icons.js -> engine/icons.js'));
check('a town that only differs in engine version is not a gate item', !keys().includes('gate-town Old Engine Town'));

check('an unbuilt town becomes its own rank-8 housekeeping item', byKey('nobuild-Unbuilt Town')?.rank === 8);
check('… naming the town in the title', /Unbuilt Town/.test(byKey('nobuild-Unbuilt Town')?.title || ''));
check('an engine-stale town becomes rank-8 housekeeping', byKey('engine-stale')?.rank === 8);
check('… naming the live template', /e-current/.test(byKey('engine-stale')?.why || ''));
check('an S6-stale town becomes rank-8 housekeeping', byKey('s6-stale')?.rank === 8);
check('a healthy, current town raises no housekeeping item for itself',
  !keys().includes('nobuild-Healthy Town') && !['engine-stale', 's6-stale'].some((k) => (byKey(k)?.towns || []).includes('Healthy Town')));

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all worklist checks passed'}\n`);
process.exit(failures ? 1 : 0);
