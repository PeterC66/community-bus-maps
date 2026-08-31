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
const { buildWorklist, isUnreachableAddress } = await import('../src/worklist/index.js');
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
// An organisation waiting to be vetted. The address has to be a REACHABLE one:
// a pending application on a reserved domain is now seed data by definition and
// splits into its own demo item, so the old clerk@example.invalid here would
// have made every assertion below describe the demo path while reading as
// though it described the real one.
db.insertApplication({ org_name: 'Elsewhere Town Council', org_type: 'council', contact_name: 'A Clerk', email: 'clerk@elsewhere-tc.gov.uk' });

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

// --- the draft nobody sent (findings B5) ------------------------------------
// The blind spot this closes: every other item here exists because somebody is
// blocked, and a draft blocks nobody — so a map whose customer accepted an
// update and then closed the tab appeared in no list and no count. Eight live
// maps sat in exactly that state on 2026-08-11 while the worklist said
// "nothing waiting".
const draftId = db.insertMap({ customer_id: customerId, slug: 'draftown', name: 'Draftown', kind: 'area', status: 'published' });
const draftPub = db.insertVersion({ map_id: draftId, major: 1, minor: 0, storage_key: 'v1.0' });
db.setPublishedVersion(draftId, draftPub);
db.setCurrentVersion(draftId, draftPub);
check('a map whose head IS its published version raises nothing', !keys().includes(`draft-${draftId}`));

const draftHead = db.insertVersion({ map_id: draftId, major: 2, minor: 0, storage_key: 'v2.0', note: 'Accepted update' });
db.setCurrentVersion(draftId, draftHead);
check('an accepted-but-unsent draft becomes an item', keys().includes(`draft-${draftId}`));
eq('… ranked below everything the operator is blocking', byKey(`draft-${draftId}`).rank, 9);
eq('… in the waiting-on-others band', byKey(`draft-${draftId}`).band, 'Waiting on others');
check('… naming both versions, so the gap is the point', /v2\.0/.test(byKey(`draft-${draftId}`).title) && /v1\.0/.test(byKey(`draft-${draftId}`).title),
  byKey(`draft-${draftId}`).title);

backdate('map_version', draftHead, 10);
eq('one left 10 days is promoted to the operator\'s own move', byKey(`draft-${draftId}`).rank, 8);
eq('… into the your-move band', byKey(`draft-${draftId}`).band, 'Your move');

// Sending it for review hands it to the review queue — one item, not two.
const draftReq = db.insertPublishRequest({ map_id: draftId, version_id: draftHead });
check('sending it for review closes the draft item', !keys().includes(`draft-${draftId}`));
check('… and it is now a review item instead', keys().includes(`review-${draftReq}`));

// Sent back, and never resubmitted: still nobody's queue, still worth saying.
db.decidePublishRequest(draftReq, { status: 'rejected', decisionNote: 'terminus wrong on the external sheet', evidence: {} });
db.setVersionState(draftHead, 'rejected');
check('a version sent back and left there re-appears', keys().includes(`draft-${draftId}`));
check('… and the wording says it was sent back', /sent back/.test(byKey(`draft-${draftId}`).why), byKey(`draft-${draftId}`).why);

// A map that has never published anything is in the same blind spot.
const neverId = db.insertMap({ customer_id: customerId, slug: 'nevertown', name: 'Nevertown', kind: 'area', status: 'draft' });
const neverVer = db.insertVersion({ map_id: neverId, major: 1, minor: 0, storage_key: 'v1.0' });
db.setCurrentVersion(neverId, neverVer);
check('a built map that was never published is listed too', keys().includes(`draft-${neverId}`));
check('… and says so rather than naming a published version', /never been published/.test(byKey(`draft-${neverId}`).title),
  byKey(`draft-${neverId}`).title);

// An update waiting on the customer is already an item (rank 6/9); the draft
// item must not double it up while that decision is outstanding.
db.insertProposedUpdate({ map_id: neverId, source_note: 'BODS 2026-09 refresh' });
check('a map with a pending update is not also listed as a draft', !keys().includes(`draft-${neverId}`));

// --- seeded applications never share a row with real ones -------------------
//
// The case this exists for: seed-demo.mjs creates a pending application called
// "Ramsey Town Council" at clerk@ramsey-tc.example, which reads like a real
// council and is not one. While every pending application shared a single
// rollup row, that row could only be reported as wholly real or wholly seeded,
// and on 2026-08-31 it was read as real and an operator was told a council was
// waiting on him. The name is not the evidence and never was; the address is.
check('a reserved-domain applicant is not counted as real', isUnreachableAddress('clerk@ramsey-tc.example'));
check('… nor is the seed data\'s shared address', isUnreachableAddress('t@example.com'));
check('a real council IS reachable, so it stays real', !isUnreachableAddress('clerk@ramsey-tc.gov.uk'));
check('a lookalike domain is not reserved', !isUnreachableAddress('clerk@notexample.com'));
check('… and neither is example.co.uk, which is registrable', !isUnreachableAddress('a@example.co.uk'));

// One real applicant is already staged above (Elsewhere Town Council). Add the
// exact seeded shape beside it and the two must not merge.
db.insertApplication({ org_name: 'Ramsey Town Council', org_type: 'council', contact_name: 'Jo Clark', email: 'clerk@ramsey-tc.example' });
db.insertApplication({ org_name: 'Test council', org_type: 'council', contact_name: 'T', email: 't@example.com' });
const realApps = byKey('applications');
const demoApps = byKey('applications-demo');
check('the real applicant keeps the plain key', !!realApps);
check('the seeded ones split into their own item', !!demoApps);
// Optional chaining throughout, deliberately: when the split regresses, one of
// these items is undefined, and a suite that CRASHES on the next line reports
// one failure and hides the rest. Breaking the split on purpose is how that was
// found — it printed a single ✗ and stopped.
check('… flagged demo, so a reader cannot mistake them', demoApps?.demo === true);
check('… and the real item is NOT flagged demo', realApps?.demo === false);
eq('the real row counts only the real applicant', realApps?.count, 1);
eq('the seeded row counts only the seeded ones', demoApps?.count, 2);
check('the real row does not name a seeded applicant', !/Ramsey Town Council/.test(realApps?.why || ''), realApps?.why);
check('the seeded row says why nobody is waiting', /nobody is waiting/.test(demoApps?.why || ''), demoApps?.why);

// And the shape that matters most: with the real one withdrawn, the queue must
// go QUIET rather than fall back to one mixed row.
const theRealOne = db.listApplications({ status: 'pending' }).find((a) => a.email === 'clerk@elsewhere-tc.gov.uk');
check('the real applicant is findable before we reject it', !!theRealOne);
db.setApplicationReviewed(theRealOne.id, 'rejected');
check('with no real applicant left, there is no real applications row', !byKey('applications'));
check('… and the seeded row is still there, still demo', byKey('applications-demo')?.demo === true);

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all worklist checks passed'}\n`);
process.exit(failures ? 1 : 0);
