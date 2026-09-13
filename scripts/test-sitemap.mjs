// Sitemap checks — of the URLs this site OFFERS a crawler, does each one answer,
// and does each one say which URL it is? (buses-data OA-284)
//
//   node scripts/test-sitemap.mjs        (or: npm run test:sitemap)
//
// THE BUG THIS EXISTS TO KEEP CLOSED, measured against the live site by hand on
// 2026-09-08:
//
//   sitemap.xml advertises 48 URL(s)
//     200 https://busmaps.uk/o/busmaps-uk-pilot   NO CANONICAL
//   non-200: 0   missing canonical: 1   canonical != loc: 0
//
// `/o/:slug` ended in a bare `reply.sendFile('org.html')`, so it served the raw
// shell: a title and a description identical for every organisation that will
// ever have a page, and no canonical to tell two of them apart. The sitemap
// advertised it anyway.
//
// AND THE RULE WAS ALREADY HALF-ENFORCED, which is the part worth remembering.
// `org.html` has been in `SERVER_FILLED_SHELLS` since 2026-08-31, and
// `test-indexing.mjs` asserts that those three shells carry NO canonical of
// their own — on the stated grounds that the server injects one. Two things are
// true of those shells; one was checked and the other was remembered. The
// checked half is the one that makes the page worse on its own.
//
// WHY THIS IS NOT A GREP OVER THE ROUTE FILE. A regex would certify that the
// source contains a call to `sendShell`. It would not notice a head built with
// the wrong base, a shell whose own `<title>` survived the splice, or two pages
// that both render perfectly and are identical to each other. So this boots the
// real app over a seeded database and reads the HTML that would go on the wire.
//
// TWO ORGANISATIONS ARE SEEDED ON PURPOSE. The fault is silent with one — there
// is nothing to be a duplicate OF — which is exactly why it sat in the sitemap
// unnoticed. A live check against a one-organisation site cannot make this half
// of the claim; the laptop can, by seeding the second one.
//
// The population is the SITEMAP's own, not a list written here, so a thirteenth
// static page or a second published map joins it without anybody remembering to.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-sitemap-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
// The hand-written pages carry a hard-coded canonical on the live host, so the
// app under test must believe it is that host — otherwise every static page
// would report `canonical != loc` and the run would be red about the fixture.
// That agreement is itself worth asserting, and this is where it gets asserted.
const BASE = 'https://busmaps.uk';
process.env.PUBLIC_BASE_URL = BASE;
delete process.env.OPERATOR_TOKEN;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

const {
  locsIn, judgeAdvertisedUrl, titleIn, descriptionIn, canonicalsIn, duplicateIdentities,
} = await import('./lib/sitemap-heads.mjs');

const db = await import('../src/db/index.js');
const { versionDir } = await import('../src/maps/store.js');

// --- seed: two organisations, each with one published map --------------------
// A published map is what gives an organisation a public page at all (the same
// condition the API applies), so the orgs cannot be seeded on their own.
function publish({ org, isDemo, mapSlug, mapName }) {
  const custId = db.insertCustomer({ name: org, type: 'authority-council', is_demo: isDemo ? 1 : 0 });
  const mapId = db.insertMap({ customer_id: custId, slug: mapSlug, name: mapName, kind: 'area' });
  const versionId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, storage_key: 'v1.0', overrides: {} });
  db.setPublishedVersion(mapId, versionId);
  // publicMaps() drops a map with no file to show, so the version folder needs
  // one drawn output. The bytes are never rendered here — only their existence
  // is read — but it must be a real file in the real place.
  const dir = versionDir(mapId, 'v1.0');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'internal.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
  return { custId, mapId };
}

publish({ org: 'Testbury Town Council', isDemo: false, mapSlug: 'testbury', mapName: 'Testbury' });
publish({ org: 'Sample Parish Council', isDemo: true, mapSlug: 'sampleton', mapName: 'Sampleton' });

const { app } = await import('../src/server.js');
await app.ready();

const get = async (url) => {
  const r = await app.inject({ method: 'GET', url });
  return { status: r.statusCode, contentType: r.headers['content-type'] || '', body: r.payload };
};
// From the advertised URL, never by trimming a prefix: a base that did not match
// would otherwise turn into a path like `/0/faq.html` and report itself as
// fourteen 404s rather than as the one fault it is.
const pathOf = (loc) => { const u = new URL(loc); return u.pathname + u.search; };

// --- the population ----------------------------------------------------------
const sm = await get('/sitemap.xml');
check('/sitemap.xml is served', sm.status === 200, String(sm.status));
const locs = locsIn(sm.body);
console.log(`\nthe sitemap advertises ${locs.length} URL(s)`);

// A check that cannot find its subject must never report clear — this
// repository's oldest convention. With an unseeded database the sitemap holds
// the static pages alone, every one of which carries its canonical in the file,
// and the whole of OA-284 would pass untested.
const orgLocs = locs.filter((l) => l.startsWith(`${BASE}/o/`));
const mapLocs = locs.filter((l) => /\/m\/[^/]+$/.test(l));
check('…and the ORGANISATION pages are among them', orgLocs.length === 2,
  `${orgLocs.length} /o/ URL(s): ${orgLocs.join(', ')} — the seed did not reach the sitemap, so nothing below is about OA-284`);
check('…and the MAP pages are among them', mapLocs.length === 2,
  `${mapLocs.length} /m/ URL(s) — the other shell whose head the server completes`);
check('…and every one of them is on the canonical host', locs.every((l) => l.startsWith(BASE + '/')),
  locs.filter((l) => !l.startsWith(BASE + '/')).join(', '));

// --- every advertised URL answers, and says which URL it is ------------------
console.log('\nevery URL the sitemap offers a crawler:');
const pages = [];
for (const loc of locs) {
  const r = await get(pathOf(loc));
  const fault = judgeAdvertisedUrl({ loc, status: r.status, contentType: r.contentType, html: r.body });
  check(loc.slice(BASE.length) || '/', !fault, fault || '');
  if (/html/i.test(r.contentType)) {
    pages.push({ loc, title: titleIn(r.body), description: descriptionIn(r.body) });
  }
}

// --- the fault one organisation cannot show ----------------------------------
console.log('\nno two advertised pages arrive as the same document:');
const dupes = duplicateIdentities(pages);
check('every advertised page has a title and description of its own', dupes.length === 0, dupes.join(' | '));

// --- and the organisation page specifically ----------------------------------
console.log('\nthe organisation page, which is the one that had none of this:');
// BY SLUG, never by position: the sitemap orders organisations by NAME, so
// `orgLocs[0]` is the demo one and an assertion about "the real one" would have
// been reading the wrong page while saying the right sentence.
const locFor = (slug) => orgLocs.find((l) => pathOf(l) === `/o/${slug}`);
const real = locFor('testbury-town-council');
const demo = locFor('sample-parish-council');
check('both seeded organisations are advertised by the slug they were given',
  !!real && !!demo, `found ${orgLocs.map(pathOf).join(', ')}`);

const org = await get(pathOf(real));
check('it names the organisation in its title', titleIn(org.body).includes('Testbury Town Council'),
  `title was "${titleIn(org.body)}"`);
check('it says how many maps that organisation has published', /\bOne bus map\b/.test(descriptionIn(org.body)),
  `description was "${descriptionIn(org.body)}"`);
check('it carries exactly one canonical, and it is its own URL',
  canonicalsIn(org.body).length === 1 && canonicalsIn(org.body)[0] === real,
  canonicalsIn(org.body).join(', '));
check('the shell’s generic title did not survive the splice',
  !org.body.includes('An organisation’s bus maps'), 'sendShell must strip the shell’s own <title>');
check('the demo organisation’s page says it is a demonstration',
  /demonstrate BusMaps\.uk/.test(descriptionIn((await get(pathOf(demo))).body)));

await app.close();
try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows holds the sqlite file briefly */ }

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll sitemap checks passed.');
process.exit(failures ? 1 : 0);
