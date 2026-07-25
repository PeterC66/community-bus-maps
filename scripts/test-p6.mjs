// P6 checks — the pure logic and the SQL gate behind the public front.
//
//   node scripts/test-p6.mjs          (or: npm run test:p6)
//
// Two things are worth an automated test here:
//   1. sanitizeBranding() — it is the whitelist that stops a customer putting
//      markup, a javascript: URL or an arbitrary colour on a public page.
//   2. listPublicMaps()/getPublicMapBySlug() — the three conditions that make a
//      map public (published + listed + active customer) live in SQL, so a
//      synthetic DB proves drafts, un-listed maps and suspended organisations
//      really are unreachable, plus the migration is idempotent.
//
// Runs against a throwaway DATA_DIR — it never touches the real portal data.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-p6-'));
process.env.DATA_DIR = scratch;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// --- 1. branding whitelist ---------------------------------------------------
const { sanitizeBranding, brandingForPublic, cleanUrl, initialsFor } = await import('../src/branding/index.js');

console.log('\nbranding whitelist');
{
  const hostile = {
    publicName: '  St Ives   Town Council  ',
    website: 'javascript:alert(1)',
    blurb: 'Nice  town',
    emoji: '<img src=x onerror=alert(1)>',
    accent: '#ff0000',
    routeColors: { 9: '#000000' },   // an expert/other-domain key
    logoUrl: 'http://evil.example/x.png',
  };
  const { branding, rejected } = sanitizeBranding(hostile);
  eq('name trimmed + whitespace collapsed', branding.publicName, 'St Ives Town Council');
  eq('angle brackets stripped from a name', sanitizeBranding({ publicName: '<script>alert(1)</script>Evil' }).branding.publicName, 'scriptalert(1)/scriptEvil');
  eq('blurb kept', branding.blurb, 'Nice town');
  check('javascript: URL dropped', branding.website === undefined);
  check('markup emoji dropped', branding.emoji === undefined);
  check('free-form hex accent dropped', branding.accent === undefined);
  check('unknown keys dropped', !('routeColors' in branding) && !('logoUrl' in branding));
  eq('everything dropped is reported', rejected.sort(), ['accent', 'emoji', 'logoUrl', 'routeColors', 'website'].sort());
}
{
  const { branding, rejected } = sanitizeBranding({ website: 'st-ives-tc.example/buses', emoji: '🏛️', accent: 'teal' });
  eq('bare host gets https://', branding.website, 'https://st-ives-tc.example/buses');
  eq('emoji kept', branding.emoji, '🏛️');
  eq('known accent kept', branding.accent, 'teal');
  eq('nothing rejected', rejected, []);
}
check('data: URL rejected', cleanUrl('data:text/html,<script>') === '');
check('scheme-less nonsense rejected', cleanUrl('not a url') === '');
eq('initials fallback', initialsFor('Beaconsfield Health Centre'), 'BH');
{
  const pub = brandingForPublic({ name: 'March Town Council', slug: 'march-tc', branding_json: '{"accent":"green"}' });
  eq('accent hex resolved', pub.accentHex, '#2c6e2f');
  eq('badge falls back to initials', pub.badge, 'MT');
}
eq('garbage json → empty branding', brandingForPublic({ name: 'X', branding_json: 'not json' }).accent, 'blue');

// --- 2. the public SQL gate --------------------------------------------------
const db = await import('../src/db/index.js');

console.log('\npublic query gate');
const activeId = db.insertCustomer({ name: 'Active Council', type: 'council' });
const suspendedId = db.insertCustomer({ name: 'Suspended Council', type: 'council' });
db.updateCustomerAdmin(suspendedId, { status: 'suspended' });

function seedMap(customerId, slug, { publish = true, listed = true, status = 'published' } = {}) {
  const id = db.insertMap({ customer_id: customerId, slug, name: slug, kind: 'area', data_dir: `maps/${slug}`, status });
  const vid = db.insertVersion({ map_id: id, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
  db.setCurrentVersion(id, vid);
  if (publish) { db.setVersionState(vid, 'published'); db.setPublishedVersion(id, vid); }
  if (!listed) db.setMapPublicListed(id, false);
  return id;
}

seedMap(activeId, 'published-map');
seedMap(activeId, 'draft-only', { publish: false, status: 'draft' });
seedMap(activeId, 'unlisted-map', { listed: false });
seedMap(activeId, 'archived-map', { status: 'archived' });
seedMap(suspendedId, 'suspended-org-map');

const slugs = db.listPublicMaps().map((r) => r.slug);
eq('only the published, listed map of an active customer is public', slugs, ['published-map']);
check('a draft is unreachable by slug', !db.getPublicMapBySlug('draft-only'));
check('an un-listed map is unreachable by slug', !db.getPublicMapBySlug('unlisted-map'));
check('an archived map is unreachable by slug', !db.getPublicMapBySlug('archived-map'));
check('a suspended org\'s map is unreachable by slug', !db.getPublicMapBySlug('suspended-org-map'));
check('the published map IS reachable by slug', !!db.getPublicMapBySlug('published-map'));
eq('public counts agree', db.publicCounts(), { publicMaps: 1, publicOrgs: 1 });
eq('one public organisation is listed', db.listPublicOrgs().map((o) => o.slug), ['active-council']);

console.log('\nslugs + branding round-trip');
eq('customer slug derived from the name', db.getCustomer(activeId).slug, 'active-council');
const dupe = db.insertCustomer({ name: 'Active Council' });
eq('duplicate names get a distinct slug', db.getCustomer(dupe).slug, 'active-council-2');
db.setCustomerBranding(activeId, sanitizeBranding({ emoji: '🏛️', accent: 'amber' }).branding);
eq('branding stored and read back', brandingForPublic(db.getCustomer(activeId)).accent, 'amber');
eq('un-listing is reversible', (db.setMapPublicListed(db.getMapBySlug('unlisted-map').id, true),
  db.listPublicMaps().map((r) => r.slug).sort()), ['published-map', 'unlisted-map']);

// --- 3. migration idempotency (reopen the same DB) ---------------------------
console.log('\nmigration');
{
  const { DatabaseSync } = await import('node:sqlite');
  const p = path.join(scratch, 'portal.sqlite');
  const raw = new DatabaseSync(p);
  const cols = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  check('customer.slug exists', cols('customer').includes('slug'));
  check('customer.branding_json exists', cols('customer').includes('branding_json'));
  check('map.public_listed exists', cols('map').includes('public_listed'));
  check('message.map_id exists', cols('message').includes('map_id'));
  raw.close();
  // Re-running the schema + migrations over an existing DB must not throw.
  const again = await import(`../src/db/index.js?reopen=${Date.now()}`);
  check('reopening the DB re-runs the migration cleanly', again.listPublicMaps().length === 2);
}

// --- 4. a PRE-P6 database picks up the new columns (the real upgrade path) ----
// The local demo DBs predate P6, so the ALTER branch matters more than the fresh
// one. Build an old-shaped DB in a second scratch dir and open it in a CHILD
// process (DATA_DIR is read once, at import time).
console.log('\nupgrade from a pre-P6 database');
{
  const { DatabaseSync } = await import('node:sqlite');
  const { execFileSync } = await import('node:child_process');
  const old = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-p6-old-'));
  const raw = new DatabaseSync(path.join(old, 'portal.sqlite'));
  raw.exec(`
    CREATE TABLE customer (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL DEFAULT 'active',
      plan TEXT NOT NULL DEFAULT 'free', quota_areas INTEGER NOT NULL DEFAULT 1, quota_places INTEGER NOT NULL DEFAULT 3);
    CREATE TABLE map (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      customer_id INTEGER, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'area',
      subject TEXT, data_dir TEXT NOT NULL DEFAULT '', outputs TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft', current_version_id INTEGER, published_version_id INTEGER);
    CREATE TABLE message (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL DEFAULT 'enquiry', name TEXT, email TEXT, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new');
    INSERT INTO customer (name) VALUES ('Legacy Parish Council');
    INSERT INTO map (customer_id, slug, name) VALUES (1, 'legacy-map', 'Legacy');
  `);
  raw.close();
  const { pathToFileURL } = await import('node:url');
  const dbUrl = pathToFileURL(path.resolve(import.meta.dirname, '../src/db/index.js')).href;
  const probe = `
    const db = await import('${dbUrl}');
    const c = db.getCustomer(1);
    console.log(JSON.stringify({ slug: c.slug, branding: c.branding_json,
      listed: db.getMapBySlug('legacy-map').public_listed, msgOk: db.listMessages().length === 0 }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, DATA_DIR: old }, encoding: 'utf8',
  });
  const got = JSON.parse(out.trim().split('\n').pop());
  eq('an existing customer is back-filled with a slug', got.slug, 'legacy-parish-council');
  eq('branding_json is added with a default', got.branding, '{}');
  eq('an existing map defaults to listed', got.listed, 1);
  check('message.map_id was added without loss', got.msgOk === true);
  try { rmSync(old, { recursive: true, force: true }); } catch { /* windows file locks */ }
}

try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all P6 checks passed');
process.exit(failures ? 1 : 0);
