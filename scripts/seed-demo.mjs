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
import { existsSync, readdirSync, statSync, cpSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  getUserByEmail, insertUser, getCustomerByName, insertCustomer, setCustomerDemo, getMapBySlug,
  insertApplication, listApplications, insertMap,
  nextVersion, insertVersion, setCurrentVersion, getOpenRequestForMap, getOpenProposedForMap,
  insertPublishRequest, setVersionState, decidePublishRequest, setPublishedVersion,
  setMapStatus, recordAudit, getCustomer, setCustomerBranding, insertMessage, listMessages,
} from '../src/db/index.js';
import { sanitizeBranding } from '../src/branding/index.js';
import { renderVersion, defaultOutputs, readRoutesMeta } from '../src/maps/engine.js';
import { mapDataDir } from '../src/maps/store.js';
import { CHECKLIST, CHECKLIST_VERSION } from '../src/publish/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPORT = path.join(HERE, 'import-map.mjs');
const PROPOSE = path.join(HERE, 'propose-update.mjs');
const BUSES_DIR = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'peter@pcooper.me.uk';

// Both map kinds now render in the portal: AREA maps carry their generators
// per-map (staged from the town render dir); PLACE maps are staged with the
// vendored place engine (engine/place/). So the demo seeds a built place map
// (Beaconsfield Simpson Centre) alongside the two council area maps.
// `branding` seeds each demo organisation's PUBLIC identity (P6) so the public
// pages and gallery show credits in the right SHAPE out of the box.
//
// These organisations are INVENTED. They are named after real councils and a
// real health centre, none of which have any connection to this system, so
// every one of them is flagged is_demo (→ a "Sample" label on every public
// surface) and carries an explicit disclaimer in its blurb. Do not remove
// either without removing the seeded org.
const DEMO = [
  { customer: 'St Ives Town Council', type: 'council', editor: 'clerk@st-ives-tc.example',
    name: 'St Ives', slug: 'st-ives', kind: 'area', subject: 'St Ives, Cambridgeshire',
    renderParent: 'Areas/St Ives/S5-render',
    branding: { emoji: '🏛️', accent: 'blue', blurb: 'Sample organisation — invented for testing, not a real customer.', website: 'https://st-ives-tc.example' } },
  { customer: 'March Town Council', type: 'council', editor: 'clerk@march-tc.example',
    name: 'March', slug: 'march', kind: 'area', subject: 'March, Cambridgeshire',
    renderParent: 'Areas/March/S5-render',
    branding: { emoji: '🌾', accent: 'green', blurb: 'Sample organisation — invented for testing, not a real customer.', website: 'https://march-tc.example' } },
  { customer: 'Beaconsfield Health Centre', type: 'other', editor: 'manager@beaconsfield-health.example',
    name: 'Simpson Centre', slug: 'simpson-centre', kind: 'place', subject: 'The Simpson Centre, Beaconsfield',
    renderParent: 'Areas/Beaconsfield/Places/Beaconsfield Simpson Centre/S5-render',
    branding: { emoji: '🏥', accent: 'teal', blurb: 'Sample organisation — invented for testing, not a real customer.' } },
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
  // is_demo: everything this script creates is fictional (see DEMO above). Set
  // it on re-runs too, so instances seeded before the flag existed get labelled.
  if (existing) { setCustomerDemo(existing.id, true); return existing.id; }
  const id = insertCustomer({ name, type, is_demo: true });
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
  // P6 — public branding. Sanitised on the way in, exactly as the API does.
  if (d.branding) {
    const cust = getCustomer(customerId);
    if (!cust.branding_json || cust.branding_json === '{}') {
      const { branding } = sanitizeBranding(d.branding);
      setCustomerBranding(customerId, branding);
      console.log(`· seeded public branding for ${d.customer}`);
    }
  }
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
    message: 'Demo application — invented, not a real enquiry. We hand these out at the library and the GP surgery.',
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

// Publish a map's baseline v1.0 as its first official version — a real trip
// through the P4 gate (submit → sign-off → pointer + audit), so the demo has
// published maps and, with P6, live public pages for both map kinds.
function publishBaseline(slug, editorEmail) {
  const m = getMapBySlug(slug);
  if (!m || !m.current_version_id || m.published_version_id) {
    console.log(`· ${slug} already published (or not seeded)`);
    return;
  }
  const summary = { base: 'baseline', unchanged: true, routes: [], poisHidden: [], poisShown: [] };
  const reqId = insertPublishRequest({ map_id: m.id, version_id: m.current_version_id, requested_by: editors[slug], note: 'Demo: initial publication of the sample baseline.' });
  setVersionState(m.current_version_id, 'pending');
  recordAudit({ actorId: editors[slug], actorEmail: editorEmail, action: 'version.submit', mapId: m.id, versionId: m.current_version_id, detail: { version: 'v1.0' } });
  decidePublishRequest(reqId, {
    status: 'approved', reviewedBy: approverId, decisionNote: 'Demo: approved — baseline is accurate and legible.',
    evidence: { checklistVersion: CHECKLIST_VERSION, checklist: fullChecklist(), changeSummary: summary, decidedAt: new Date().toISOString() },
  });
  setVersionState(m.current_version_id, 'published');
  setPublishedVersion(m.id, m.current_version_id);
  setMapStatus(m.id, 'published');
  recordAudit({ actorId: approverId, actorEmail: APPROVER_EMAIL, action: 'version.publish', mapId: m.id, versionId: m.current_version_id, detail: { version: 'v1.0', changeSummary: summary } });
  console.log(`· published ${slug} v1.0 as its first official version (SAMPLE org — public page now live)`);
}

publishBaseline('march', 'clerk@march-tc.example');
// A PLACE map too, so /maps shows both kinds publicly (P6).
publishBaseline('simpson-centre', 'manager@beaconsfield-health.example');

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
    insertPublishRequest({ map_id: stMap.id, version_id: vid, requested_by: editors['st-ives'], note: `Demo: please publish the new route ${routeId} colour for the summer timetable.` });
    setVersionState(vid, 'pending');
    recordAudit({ actorId: editors['st-ives'], actorEmail: 'clerk@st-ives-tc.example', action: 'version.submit', mapId: stMap.id, versionId: vid, detail: { version: key } });
    console.log(`· St Ives ${key} submitted for publication (demo pending review)`);
  } catch (e) {
    console.warn('· ⚠ could not seed the St Ives pending sign-off:', e.message);
  }
} else console.log('· St Ives sign-off demo already present (or St Ives not seeded)');

// --- P5: stage a demo monthly refresh so the accept/decline flow is demoable ---
// Build a lightly-mutated copy of a built map's data (as if the central pipeline
// re-ran for the new month): bump the timetable validity, reword one route's
// description, and drop one stop from a busy route. March is published with no
// pending publish request, so its editor can accept the update cleanly.
function makeDemoRefreshSrc(srcDataDir) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-demo-refresh-'));
  for (const f of readdirSync(srcDataDir)) {
    const keep = /^gen_.*\.js$/.test(f) || (f.endsWith('.json') && f !== 'package.json' && !f.endsWith('.bak'));
    if (keep) cpSync(path.join(srcDataDir, f), path.join(tmp, f));
  }
  // routes.json: new validity + one reworded description.
  const rjPath = path.join(tmp, 'routes.json');
  const rj = JSON.parse(readFileSync(rjPath, 'utf8'));
  rj.validFrom = 'August 2026';
  const descKey = rj.internalDesc ? Object.keys(rj.internalDesc)[0] : null;
  if (descKey && Array.isArray(rj.internalDesc[descKey])) {
    const d = rj.internalDesc[descKey].slice();
    d[d.length - 1] = `${d[d.length - 1] || ''} · revised times`.trim();
    rj.internalDesc[descKey] = d;
  }
  writeFileSync(rjPath, JSON.stringify(rj, null, 2));
  // Drop one stop from the busiest route (a visible stop change). Area maps use
  // routes_atco.json; place maps use routes_intown_atco.json (same flat-array shape).
  const atcoPath = [path.join(tmp, 'routes_atco.json'), path.join(tmp, 'routes_intown_atco.json')].find(existsSync);
  if (atcoPath) {
    const atco = JSON.parse(readFileSync(atcoPath, 'utf8'));
    const k = Object.keys(atco)
      .filter((r) => Array.isArray(atco[r]))
      .sort((a, b) => atco[b].length - atco[a].length)[0];
    if (k && atco[k].length >= 4) {
      atco[k] = atco[k].slice(0, -1);
      writeFileSync(atcoPath, JSON.stringify(atco, null, 2));
    }
  }
  return tmp;
}

const marchForRefresh = getMapBySlug('march');
if (marchForRefresh && marchForRefresh.current_version_id && marchForRefresh.data_dir && !getOpenProposedForMap(marchForRefresh.id)) {
  try {
    const src = makeDemoRefreshSrc(mapDataDir(marchForRefresh.id));
    execFileSync(process.execPath, [
      PROPOSE, '--map', 'march', '--src', src, '--note', 'Demo: August 2026 timetable refresh (BODS)',
    ], { stdio: 'inherit' });
    console.log('· staged a demo monthly update for March (its editor can accept/decline it)');
  } catch (e) {
    console.warn('· ⚠ could not stage the demo refresh for March:', e.message);
  }
} else console.log('· demo refresh already staged for March (or March not seeded)');

// P5 for a PLACE map: stage the same kind of demo refresh for the Simpson Centre,
// so the accept flow (re-applying overrides + preserving the base framing) is
// demoable for a place too. makeDemoRefreshSrc derives the "fresh" payload from the
// live data (which for a place carries the vendored engine + base-overrides.json).
const simpsonForRefresh = getMapBySlug('simpson-centre');
if (simpsonForRefresh && simpsonForRefresh.current_version_id && simpsonForRefresh.data_dir && !getOpenProposedForMap(simpsonForRefresh.id)) {
  try {
    const src = makeDemoRefreshSrc(mapDataDir(simpsonForRefresh.id));
    execFileSync(process.execPath, [
      PROPOSE, '--map', 'simpson-centre', '--src', src, '--note', 'Demo: August 2026 timetable refresh (place)',
    ], { stdio: 'inherit' });
    console.log('· staged a demo monthly update for the Simpson Centre (place — its editor can accept/decline it)');
  } catch (e) {
    console.warn('· ⚠ could not stage the demo refresh for the Simpson Centre:', e.message);
  }
} else console.log('· demo place refresh already staged (or Simpson Centre not seeded)');

// --- P6: a piece of feedback from a public map page, so the admin Messages tab
//     shows the "About" (which map) column with something in it ---
const marchPublic = getMapBySlug('march');
if (marchPublic && !listMessages().some((m) => m.map_id === marchPublic.id)) {
  insertMessage({
    kind: 'feedback', name: 'A passenger (demo)', email: 'passenger@example.com',
    body: 'Demo feedback, not a real report. The 33 no longer runs along Station Road on Saturdays — worth checking on the next refresh.',
    map_id: marchPublic.id,
  });
  console.log('· seeded a piece of public feedback about the March map');
} else console.log('· public feedback already seeded (or March not seeded)');

console.log(`\n✓ demo seed complete — ${imported} map(s) imported, ${skipped} skipped.`);
console.log('  Start the server (npm run dev) and sign in at /app/login.html:');
console.log(`    admin    : ${ADMIN_EMAIL}`);
console.log(`    approver : ${APPROVER_EMAIL}   (reviews + publishes at /app/review)`);
for (const d of DEMO) console.log(`    editor   : ${d.editor}   (${d.customer})`);
console.log('  The sign-in link is printed to the SERVER console.');
// P7: the expert styles are opt-in per map, so point at them rather than switching
// them on behind the demo user's back.
const stForHint = getMapBySlug('st-ives');
if (stForHint) {
  console.log(`\n  Expert side (admin only): the schematic + diagram outputs are OFF by default.`);
  console.log(`    · switch them on in the editor's Outputs panel (St Ives carries both configs), and`);
  console.log(`    · hand-tune the diagram's junctions at /app/maps/${stForHint.id}/diagram`);
}
process.exit(0);
