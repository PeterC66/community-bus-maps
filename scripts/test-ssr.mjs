// Server-side rendering checks — does a public page arrive with its content in
// it? (technical-audit_2026-08-25 N1)
//
//   node scripts/test-ssr.mjs          (or: npm run test:ssr)
//
// THE BUG THIS EXISTS TO KEEP CLOSED. /maps and /m/<slug>/services were static
// shells whose bodies were filled entirely in the browser. Measured against
// production on 2026-08-25:
//
//   curl -s https://busmaps.uk/m/st-ives/services | wc -c        ->  4716
//   ...| grep -o '<h[12][^>]*>[^<]*'  ->  <h2 class="mt-0" id="headline">Loading…
//   curl -s https://busmaps.uk/maps   | grep -c '/m/'            ->  0
//
// Both pages are in sitemap.xml — nineteen /services URLs — and /m/<slug>/services
// is the accessible text alternative the accessibility statement points at. With
// JavaScript the pages were excellent; without it they were the word "Loading…".
// A fallback whose availability depends on the technology it is a fallback FROM
// is not a fallback.
//
// WHAT THIS TEST ACTUALLY ASSERTS, and why it is not a grep over the source.
// A regex over server.js would certify that the code CONTAINS a call to
// setInner. It would not notice a renamed id in the shell, a shell that lost the
// element, or a fill that ran and produced nothing — which are the three ways
// this comes back. So the checks below drive the real renderers over real shells
// and read the HTML that would go on the wire.
//
// It stops short of booting the server (server.js listens on import, so a test
// cannot import it) and instead exercises the same three pieces the routes
// compose: the shell helpers, the shared markup modules, and the actual files in
// public/. If a route stops CALLING them, test-p8a and the live page are the
// backstop; what is protected here is that calling them works.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const { setInner, setAttr, setClass, removeBooleanAttr } = await import('../src/public/shell.js');
const { grid, card, esc, whenGB } = await import('../public/js/shared/map-card.mjs');
const { servicesView } = await import('../public/js/shared/services-view.mjs');

const shell = (name) => readFileSync(path.join(PUBLIC_DIR, name), 'utf8');

// --- fixtures ---------------------------------------------------------------
// Shaped like publicMap() / publicServices() output, kept minimal on purpose:
// this test is about DELIVERY, not about the facts, which test-p8a covers.
const demoMap = {
  slug: 'st-ives',
  name: 'St Ives',
  subject: 'St Ives, Cambridgeshire',
  kind: 'area',
  url: '/m/st-ives',
  version: 'v5.0',
  publishedAt: '2026-08-19T10:24:13Z',
  outputs: [{ previewUrl: '/m/st-ives/preview/internal.jpg' }],
  org: { name: 'BusMaps.uk pilot', slug: 'busmaps-uk-pilot', badge: 'BP', accentHex: '#1f5f8b', url: '/o/busmaps-uk-pilot', isDemo: true },
  provenance: { dataAsAt: '3 August 2026', stale: false },
};
const staleMap = {
  ...demoMap,
  slug: 'march',
  name: 'March',
  url: '/m/march',
  provenance: { dataAsAt: '1 January 2026', stale: true, staleAfterMonths: 6, publishedAt: '2026-01-02T00:00:00Z' },
};
const demoServices = {
  kind: 'area',
  subject: 'St Ives',
  fareNote: '',
  operators: [{ name: 'Stagecoach East', routes: ['A', 'B'] }],
  routes: [
    {
      id: 'B', title: 'St Ives – Cambridge / Huntingdon', operator: 'Stagecoach East', days: 'daily',
      colour: '#0b6', textOn: '#fff', stopsInArea: ['Bus Station 4', 'St John\'s Road'],
      journeys: [{ label: 'Cambridge', days: 'daily', places: ['Swavesey', 'Oakington'], limited: false }],
      goesTo: [], terminus: 'Cambridge',
    },
    {
      id: 'A', title: 'St Ives – Trumpington P&R', operator: 'Stagecoach East', days: 'daily',
      colour: null, textOn: null, stopsInArea: ['Bus Station 4'],
      journeys: [], goesTo: [{ name: 'Addenbrooke\'s', sub: 'hospital', limited: false }], terminus: '',
    },
  ],
};

// --- 1. the shell helpers fail LOUDLY, which is what makes the rest safe -----
console.log('shell helpers:');
check('setInner replaces the contents of the right element',
  setInner('<div id="a">old</div><div id="b">keep</div>', 'a', 'new')
    === '<div id="a">new</div><div id="b">keep</div>');
check('setInner THROWS on a missing id', (() => {
  try { setInner('<div id="a"></div>', 'nope', 'x'); return false; } catch { return true; }
})(), 'a silent no-op is how an empty page ships unnoticed');
check('setAttr replaces an existing attribute rather than adding a second',
  setAttr('<a id="l" href="#">x</a>', 'l', 'href', '/m/st-ives') === '<a id="l" href="/m/st-ives">x</a>');
check('setAttr escapes the value',
  setAttr('<a id="l" href="#">x</a>', 'l', 'href', '"><script>').includes('&quot;&gt;&lt;script&gt;'));
check('setAttr THROWS on a missing id', (() => {
  try { setAttr('<div id="a"></div>', 'nope', 'href', 'x'); return false; } catch { return true; }
})());
check('removeBooleanAttr drops `hidden`',
  removeBooleanAttr('<div id="s" hidden></div>', 's', 'hidden') === '<div id="s"></div>');
check('removeBooleanAttr is a no-op when it is not there',
  removeBooleanAttr('<div id="s"></div>', 's', 'hidden') === '<div id="s"></div>');

// --- 2. the shells still carry every id the routes fill ---------------------
// This is the check that catches a renamed id in a hand-edited HTML file, which
// is the single most likely way this regresses.
console.log('\nthe shells expose the ids the server fills:');
const mapsShell = shell('maps.html');
const servicesShell = shell('services.html');
for (const id of ['grid', 'q']) {
  check(`maps.html has #${id}`, new RegExp(`id="${id}"`).test(mapsShell));
}
for (const id of ['headline', 'intro', 'pills', 'services', 'staleNote', 'mapLink', 'backToMap']) {
  check(`services.html has #${id}`, new RegExp(`id="${id}"`).test(servicesShell));
}
check('both shells load their script as a MODULE',
  /<script type="module" src="\/js\/public-maps\.js">/.test(mapsShell)
  && /<script type="module" src="\/js\/public-services\.js">/.test(servicesShell),
  'the shared markup modules are ES modules; a classic script cannot import them');

// --- 3. /maps renders real links, not "Loading…" ----------------------------
console.log('\n/maps carries the catalogue:');
const { className, html } = grid([demoMap, staleMap]);
let mapsPage = setClass(setInner(mapsShell, 'grid', html), 'grid', className);
check('the grid holds a link to every map',
  (mapsPage.match(/href="\/m\/st-ives"/g) || []).length >= 1
  && (mapsPage.match(/href="\/m\/march"/g) || []).length >= 1);
check('"Loading published maps…" is GONE', !mapsPage.includes('Loading published maps'),
  'the placeholder must be replaced, not appended to');
check('a demo organisation is labelled Sample', mapsPage.includes('badge sample'));
check('a stale map says so', mapsPage.includes('may be out of date'));
check('the grid container keeps its layout class', /id="grid"[^>]*class="grid cols-2"/.test(mapsPage)
  || /class="grid cols-2"[^>]*id="grid"/.test(mapsPage));

console.log('\n/maps with a query:');
const noHits = grid([], { query: 'Nowhereton' });
const emptyPage = setClass(setInner(mapsShell, 'grid', noHits.html), 'grid', noHits.className);
check('a miss renders the lead block, not an error', emptyPage.includes('No published map covers')
  && emptyPage.includes('Nowhereton'));
check('a miss drops the grid layout class', noHits.className === '');
check('nothing published at all is its own message',
  grid([]).html.includes('No maps are published yet'));
check('the search box reads back the query',
  setAttr(mapsShell, 'q', 'value', 'Swavesey').includes('value="Swavesey"'));

// --- 4. /m/<slug>/services carries the services -----------------------------
console.log('\n/m/<slug>/services carries the text alternative:');
const v = servicesView(demoMap, demoServices);
let servicesPage = setInner(servicesShell, 'headline', v.headline);
servicesPage = setInner(servicesPage, 'intro', v.intro);
servicesPage = setInner(servicesPage, 'pills', v.pills);
servicesPage = setInner(servicesPage, 'services', v.services);
servicesPage = setAttr(servicesPage, 'mapLink', 'href', v.mapUrl);
servicesPage = setAttr(servicesPage, 'backToMap', 'href', v.mapUrl);

check('"Loading…" is GONE', !servicesPage.includes('>Loading…<'),
  'this is the exact string production served for every one of these URLs');
check('the headline names the place', servicesPage.includes('Bus services in St Ives'));
check('every route has a section', demoServices.routes.every((r) => servicesPage.includes(`id="route-${r.id}"`)));
check('a route\'s operator is in the HTML', servicesPage.includes('Stagecoach East'));
check('stops in the area are listed', servicesPage.includes('Bus Station 4'));
check('journey destinations are listed', servicesPage.includes('Swavesey'));
check('the operators panel is rendered', servicesPage.includes('<h3>Operators</h3>'));
check('the back-links point at the map', (servicesPage.match(/href="\/m\/st-ives"/g) || []).length >= 2);
check('provenance pills are rendered', servicesPage.includes('Services as at 3 August 2026')
  && servicesPage.includes('Version v5.0'));
check('NaPTAN is credited in the source line', servicesPage.includes('NaPTAN'));

console.log('\nthe stale notice:');
const staleView = servicesView(staleMap, demoServices);
let stalePage = setInner(servicesShell, 'staleNote', staleView.stale);
stalePage = setClass(stalePage, 'staleNote', 'notice notice-warn');
stalePage = removeBooleanAttr(stalePage, 'staleNote', 'hidden');
check('a stale map warns, visibly', stalePage.includes('This information may be out of date')
  && /id="staleNote"(?![^>]*\shidden)/.test(stalePage));
check('a current map produces no notice', servicesView(demoMap, demoServices).stale === '');

// --- 5. escaping, because this markup is now written as HTML by two callers --
console.log('\nescaping:');
check('esc neutralises tags', esc('<script>x</script>') === '&lt;script&gt;x&lt;/script&gt;');
const nasty = { ...demoMap, name: '<img src=x onerror=alert(1)>', subject: '"><b>' };
const nastyCard = card(nasty);
check('a hostile map name cannot inject markup', !nastyCard.includes('<img src=x')
  && nastyCard.includes('&lt;img src=x'));
check('a hostile subject cannot break out of an attribute', !nastyCard.includes('"><b>'));
check('the intro escapes its subject',
  servicesView(nasty, { ...demoServices, subject: '<b>bad</b>' }).intro.includes('&lt;b&gt;bad&lt;/b&gt;'));

// --- 6. server and browser must format a date identically -------------------
// They run in different processes with different locale and timezone defaults,
// and if they disagreed the visible date would change under the reader on load.
console.log('\ndates:');
check('whenGB is UTC-anchored and en-GB', whenGB('2026-08-19T23:30:00Z') === '19 August 2026',
  'a local-time render would say 20 August in BST and rewrite the page on hydration');
check('whenGB tolerates a SQLite datetime', whenGB('2026-08-19 10:24:13') === '19 August 2026');
check('whenGB is empty for nothing', whenGB(null) === '' && whenGB('') === '');

if (failures) {
  console.error(`\n✗ ${failures} SSR check(s) failed`);
  process.exit(1);
}
console.log('\n✓ all SSR checks passed');
