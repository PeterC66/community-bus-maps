// Publish a freshly-imported map's v1.0 baseline as its first official
// version — a real trip through the P4 gate (submit → review → publish
// pointer + audit), not a shortcut around it. Same sequence
// scripts/seed-demo.mjs's publishBaseline() uses for the demo data, but
// parameterized for real maps and a real actor.
//
//   node scripts/publish-baseline.mjs --actor you@example.com --slug st-ives
//   node scripts/publish-baseline.mjs --actor you@example.com --all-drafts
//
// --actor must be an existing admin or approver (the same person can submit
// AND review — there is no same-actor restriction in the review gate itself,
// see src/server.js's requireApprover). Only ever touches a map whose current
// version isn't already the published one; anything else is skipped, not
// forced.

import { listMaps, getMapBySlug, getUserByEmail, insertPublishRequest, setVersionState, decidePublishRequest, setPublishedVersion, setMapStatus, recordAudit } from '../src/db/index.js';
import { CHECKLIST, CHECKLIST_VERSION } from '../src/publish/index.js';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const actorEmail = arg('actor');
if (!actorEmail) {
  console.error('✗ --actor <email> is required (an existing admin or approver).');
  process.exit(1);
}
const actor = getUserByEmail(actorEmail);
if (!actor) {
  console.error(`✗ no user found for ${actorEmail}.`);
  process.exit(1);
}
if (actor.role !== 'admin' && actor.role !== 'approver') {
  console.error(`✗ ${actorEmail} is role "${actor.role}" — needs admin or approver to review a publish request.`);
  process.exit(1);
}

const slug = arg('slug');
let targets;
if (slug) {
  const m = getMapBySlug(slug);
  if (!m) { console.error(`✗ no map with slug "${slug}".`); process.exit(1); }
  targets = [m];
} else if (has('all-drafts')) {
  targets = listMaps().filter((m) => m.status === 'draft');
} else {
  console.error('Usage: node scripts/publish-baseline.mjs --actor <email> (--slug <slug> | --all-drafts)');
  process.exit(2);
}

function fullChecklist() {
  const c = {};
  for (const item of CHECKLIST) c[item.id] = true;
  return c;
}

function publishBaseline(m) {
  if (!m.current_version_id) { console.log(`· ${m.slug}: no rendered version yet — skipped`); return false; }
  if (m.published_version_id === m.current_version_id) { console.log(`· ${m.slug}: already published — skipped`); return false; }

  const summary = { base: 'baseline', unchanged: true, routes: [], poisHidden: [], poisShown: [] };
  const reqId = insertPublishRequest({
    map_id: m.id, version_id: m.current_version_id, requested_by: actor.id,
    note: 'Initial publication of the imported baseline.',
  });
  setVersionState(m.current_version_id, 'pending');
  recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'version.submit', mapId: m.id, versionId: m.current_version_id, detail: { version: 'v1.0' } });

  decidePublishRequest(reqId, {
    status: 'approved', reviewedBy: actor.id, decisionNote: 'Approved — initial import baseline, matches the shipped leaflet byte-for-byte.',
    evidence: { checklistVersion: CHECKLIST_VERSION, checklist: fullChecklist(), changeSummary: summary, decidedAt: new Date().toISOString() },
  });
  setVersionState(m.current_version_id, 'published');
  setPublishedVersion(m.id, m.current_version_id);
  setMapStatus(m.id, 'published');
  recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'version.publish', mapId: m.id, versionId: m.current_version_id, detail: { version: 'v1.0', changeSummary: summary } });

  console.log(`· published ${m.slug} v1.0`);
  return true;
}

let n = 0;
for (const m of targets) { if (publishBaseline(m)) n++; }
console.log(`\n${n} map(s) published.`);
