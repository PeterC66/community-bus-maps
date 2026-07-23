// Seed a multi-customer demo: an admin (you), a few demo organisations each with
// an editor user, and their maps imported from the separate Buses repo. Safe to
// re-run — existing customers/users/maps are reused, not duplicated.
//
//   node scripts/seed-demo.mjs            (stop the dev server first — one SQLite writer)
//   BUSES_DIR="/path/to/Buses" node scripts/seed-demo.mjs   (override the data location)
//
// Sign in (magic link printed to the server console) as:
//   admin  : peter@pcooper.me.uk               (sees every customer's maps)
//   editor : clerk@st-ives-tc.example  etc.    (sees only their own org's maps)

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getUserByEmail, insertUser, getCustomerByName, insertCustomer, getMapBySlug,
  insertApplication, listApplications, insertMap,
  nextVersion, insertVersion, setCurrentVersion, getOpenRequestForMap,
  insertPublishRequest, setVersionState, decidePublishRequest, setPublishedVersion,
  setMapStatus, recordAudit,
} from '../src/db/index.js';
import { renderVersion, defaultOutputs, readRoutesMeta } from '../src/maps/engine.js';
import { CHECKLIST, CHECKLIST_VERSION } from '../src/publish/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPORT = path.join(HERE, 'import-map.mjs');
const BUSES_DIR = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'peter@pcooper.me.uk';

// AREA maps only for now: the portal vendors the area engine (generators travel
// per-map). PLACE maps (make-place-bus-leaflet) use a separate engine kept in the
// skill, not vendored in the portal yet — so e.g. Beaconsfield Simpson Centre is
// intentionally left out until that engine is re-homed (a follow-up).
const DEMO = [
  { customer: 'St Ives Town Council', type: 'council', editor: 'clerk@st-ives-tc.example',
    name: 'St Ives', slug: 'st-ives', kind: 'area', subject: 'St Ives, Cambridgeshire',
    renderParent: 'St Ives/S5-render' },
  { customer: 'March Town Council', type: 'council', editor: 'clerk@march-tc.example',
    name: 'March', slug: 'march', kind: 'area', subject: 'March, Cambridgeshire',
    renderParent: 'March/S5-render' },
];

function ensureUser(email, role, customerId, name) {
  const existing = getUserByEmail(email);
  if (existing) { console.log(`· user exists: ${email} (${existing.role})`); return existing.id; }
  const id = insertUser({ email, role, customer_id: customerId, name });
  console.log(`· created ${role}: ${email}${customerId ? ' → customer #' + customerId : ''}`);
  return id;
}

function ensureCustomer(name, type) {
  const existing = getCustomerByName(name);
  if (existing) return existing.id;
  const id = insertCustomer({ name, type });
  console.log(`· created customer: ${name} (#${id}, ${type})`);
  return id;
}

// Newest (by mtime) subdirectory of a town's S5-render folder.
function newestRenderDir(renderParent) {
  const parent = path.join(BUSES_DIR, renderParent);
  if (!existsSync(parent)) return null;
  const dirs = readdirSync(parent)
    .map((n) => path.join(parent, n))
    .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  if (!dirs.length) return null;
  dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs[0];
}

// --- admin + a platform approver (P4: signs off publications, separate from the
//     editors who make the edits) ---
const adminId = ensureUser(ADMIN_EMAIL, 'admin', null, 'Peter (admin)');
const APPROVER_EMAIL = process.env.APPROVER_EMAIL || 'approver@community-bus-maps.example';
const approverId = ensureUser(APPROVER_EMAIL, 'approver', null, 'Central approver');

// --- demo customers + editors + maps ---
let imported = 0, skipped = 0;
let stIves = null;
const editors = {}; // slug -> editor user id
for (const d of DEMO) {
  const customerId = ensureCustomer(d.customer, d.type);
  const editorId = ensureUser(d.editor, 'editor', customerId, `${d.customer} editor`);
  editors[d.slug] = editorId;
  if (d.slug === 'st-ives') stIves = { customerId, editorId };

  if (getMapBySlug(d.slug)) { console.log(`· map exists: ${d.slug} (leaving as-is)`); skipped++; continue; }
  const src = newestRenderDir(d.renderParent);
  if (!src) { console.warn(`· ⚠ no render data for ${d.name} under ${d.renderParent} — skipping import`); skipped++; continue; }
  console.log(`· importing ${d.name} from ${path.basename(src)} …`);
  try {
    execFileSync(process.execPath, [
      IMPORT, '--src', src, '--name', d.name, '--slug', d.slug,
      '--kind', d.kind, '--subject', d.subject, '--customer', d.customer, '--customer-type', d.type,
    ], { stdio: 'inherit' });
    imported++;
  } catch (e) {
    console.error(`· ✗ import failed for ${d.name}: ${e.message}`);
  }
}

// --- P3: a pending application, so the approval flow is demoable out of the box ---
const DEMO_APP_EMAIL = 'clerk@ramsey-tc.example';
if (!listApplications().some((a) => a.email === DEMO_APP_EMAIL)) {
  insertApplication({
    org_name: 'Ramsey Town Council', org_type: 'council',
    contact_name: 'Jo Clark', email: DEMO_APP_EMAIL, website: 'https://ramsey-tc.example',
    wants: 'An area map of Ramsey, plus a place map for the Great Whyte shops.',
    message: 'We hand these out at the library and the GP surgery.',
  });
  console.log(`· seeded a pending application: Ramsey Town Council (${DEMO_APP_EMAIL})`);
} else console.log('· pending demo application already present');

// --- P3: a requested map, so the map-request queue is demoable ---
if (stIves && !getMapBySlug('st-ives-waitrose')) {
  insertMap({
    customer_id: stIves.customerId, slug: 'st-ives-waitrose', name: 'St Ives Waitrose', kind: 'place',
    subject: 'Waitrose, St Ives', request_note: 'Centred on the Waitrose car park; please show the guided busway stop.',
    requested_by: stIves.editorId, status: 'requested',
  });
  console.log('· seeded a requested place map: St Ives Waitrose (awaiting admin approval)');
} else console.log('· demo map request already present (or St Ives not seeded)');

// --- P4: publish gate — a published example + a real pending sign-off ---
function fullChecklist() { const c = {}; for (const item of CHECKLIST) c[item.id] = true; return c; }

// March: publish its baseline v1.0 as the first official version (shows a
// "Published" map + a publish audit entry out of the box).
const march = getMapBySlug('march');
if (march && march.current_version_id && !march.published_version_id) {
  const summary = { base: 'baseline', unchanged: true, routes: [], poisHidden: [], poisShown: [] };
  const reqId = insertPublishRequest({ map_id: march.id, version_id: march.current_version_id, requested_by: editors['march'], note: 'Initial publication for launch.' });
  setVersionState(march.current_version_id, 'pending');
  recordAudit({ actorId: editors['march'], actorEmail: 'clerk@march-tc.example', action: 'version.submit', mapId: march.id, versionId: march.current_version_id, detail: { version: 'v1.0' } });
  decidePublishRequest(reqId, {
    status: 'approved', reviewedBy: approverId, decisionNote: 'Approved — baseline is accurate and legible.',
    evidence: { checklistVersion: CHECKLIST_VERSION, checklist: fullChecklist(), changeSummary: summary, decidedAt: new Date().toISOString() },
  });
  setVersionState(march.current_version_id, 'published');
  setPublishedVersion(march.id, march.current_version_id);
  setMapStatus(march.id, 'published');
  recordAudit({ actorId: approverId, actorEmail: APPROVER_EMAIL, action: 'version.publish', mapId: march.id, versionId: march.current_version_id, detail: { version: 'v1.0', changeSummary: summary } });
  console.log('· published March v1.0 as the first official version (demo published example)');
} else console.log('· March already published (or not seeded)');

// St Ives: a real customer edit (recolour a route) saved as v1.1 and submitted
// for sign-off, so the review queue is non-empty with a genuine change.
const stMap = getMapBySlug('st-ives');
const stFresh = stMap && stMap.current_version_id && !getOpenRequestForMap(stMap.id)
  && nextVersion(stMap.id).major === 1 && nextVersion(stMap.id).minor === 1; // only the baseline exists
if (stFresh) {
  try {
    const meta = readRoutesMeta(stMap.id);
    const routeId = meta.palette['9'] ? '9' : Object.keys(meta.palette)[0];
    const def = String(meta.palette[routeId] || '').toLowerCase();
    const newColor = def === '#000000' ? '#e6194b' : '#000000';
    const overrides = { routeColors: { [routeId]: newColor } };
    const { major, minor } = nextVersion(stMap.id);
    const key = `v${major}.${minor}`;
    console.log(`· rendering St Ives ${key} (recolour route ${routeId}) for a demo sign-off…`);
    await renderVersion(stMap.id, overrides, key, defaultOutputs());
    const vid = insertVersion({ map_id: stMap.id, major, minor, note: `Recoloured route ${routeId} (demo)`, overrides, storage_key: key });
    setCurrentVersion(stMap.id, vid);
    insertPublishRequest({ map_id: stMap.id, version_id: vid, requested_by: editors['st-ives'], note: `Please publish the new route ${routeId} colour for the summer timetable.` });
    setVersionState(vid, 'pending');
    recordAudit({ actorId: editors['st-ives'], actorEmail: 'clerk@st-ives-tc.example', action: 'version.submit', mapId: stMap.id, versionId: vid, detail: { version: key } });
    console.log(`· St Ives ${key} submitted for publication (demo pending review)`);
  } catch (e) {
    console.warn('· ⚠ could not seed the St Ives pending sign-off:', e.message);
  }
} else console.log('· St Ives sign-off demo already present (or St Ives not seeded)');

console.log(`\n✓ demo seed complete — ${imported} map(s) imported, ${skipped} skipped.`);
console.log('  Start the server (npm run dev) and sign in at /app/login.html:');
console.log(`    admin    : ${ADMIN_EMAIL}`);
console.log(`    approver : ${APPROVER_EMAIL}   (reviews + publishes at /app/review)`);
for (const d of DEMO) console.log(`    editor   : ${d.editor}   (${d.customer})`);
console.log('  The sign-in link is printed to the SERVER console.');
process.exit(0);
