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
} from '../src/db/index.js';

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

// --- admin ---
ensureUser(ADMIN_EMAIL, 'admin', null, 'Peter (admin)');

// --- demo customers + editors + maps ---
let imported = 0, skipped = 0;
for (const d of DEMO) {
  const customerId = ensureCustomer(d.customer, d.type);
  ensureUser(d.editor, 'editor', customerId, `${d.customer} editor`);

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

console.log(`\n✓ demo seed complete — ${imported} map(s) imported, ${skipped} skipped.`);
console.log('  Start the server (npm run dev) and sign in at /app/login.html:');
console.log(`    admin  : ${ADMIN_EMAIL}`);
for (const d of DEMO) console.log(`    editor : ${d.editor}   (${d.customer})`);
console.log('  The sign-in link is printed to the SERVER console.');
process.exit(0);
