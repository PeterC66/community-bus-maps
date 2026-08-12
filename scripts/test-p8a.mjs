// P8a checks — the online map page: facts, provenance and the inline SVG.
//
//   node scripts/test-p8a.mjs          (or: npm run test:p8a)
//
// Three things here are worth an automated test:
//   1. buildFacts() — the map's text alternative. If this drops a service or
//      invents one, a screen-reader user gets a different map from everyone
//      else. It must work for BOTH payload shapes (area and place).
//   2. provenanceFor() — "correct as at" and the staleness threshold, which is
//      the whole answer to "a web page implies currency".
//   3. inlineSvg() — the only place a published SVG is transformed before it
//      reaches a browser as live DOM. It must keep the artwork, add the
//      accessibility hooks, and strip anything executable.
//
// Runs against a throwaway DATA_DIR and synthetic payloads — it never touches
// the real portal data, and it needs no rendered map.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-p8a-'));
process.env.DATA_DIR = scratch;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { buildFacts, parseValidFrom, stripLeadingId } = await import('../src/maps/facts.js');
const { provenanceFor, publicServices, STALE_AFTER_MONTHS } = await import('../src/public/services.js');
const { inlineSvg, FONT_STACK } = await import('../src/public/inlineSvg.js');

// --- payload fixtures --------------------------------------------------------
function payload(name, files) {
  const dir = path.join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, v] of Object.entries(files)) writeFileSync(path.join(dir, f), JSON.stringify(v));
  return dir;
}

const areaDir = payload('area', {
  'routes.json': {
    town: 'Testbury', validFrom: 'June 2026', version: '1.0',
    palette: { 9: '#66CCEE', A: '#AA3377' },
    textOn: { 9: '#111', A: '#fff' },
    routeOrder: ['A', '9'],
    operators: [{ name: 'Test Coaches', routes: ['9'] }, { name: 'Bigbus', routes: ['A'] }],
    serviceDesc: { 9: ['Testbury – Elsewhere', 'Mon & Fri'], A: ['Testbury – City', 'daily'] },
    terminiLabels: { 9: 'Elsewhere' },
    fareNote: 'Maximum £3 single fare.',
    external: [
      { route: '9', label: 'Elsewhere', days: 'Mon & Fri', stops: ['Testbury', 'Midville', 'Elsewhere'] },
      { route: '9', label: 'Elsewhere (via Backwater)', days: 'Fri only', limited: true, stops: ['Testbury', 'Backwater', 'Elsewhere'] },
    ],
  },
  'routes_intown_atco.json': { 9: ['S1', 'S2', 'S2', 'S3'], A: ['S1'] },
  'atco2name.json': { S1: 'Bus Station', S2: 'High Street', S3: 'The Green' },
});

const placeDir = payload('place', {
  'routes.json': {
    place: 'The Test Centre', town: 'Testbury', validFrom: '2026-07', version: '1.0',
    anchorLabel: 'Centre Road',
    palette: { 102: '#228833' },
    routeOrder: ['102'],
    operators: [{ name: 'Carousel', routes: ['102'] }],
    internalDesc: { 102: ['102  Testbury – Airport', 'Daily · via Midville'] },
    note: 'Spokes show where you can get to.',
    destinations: [
      { name: 'Airport', sub: 'via Midville', routes: ['102'], bearing: 90 },
      { name: 'Backwater', sub: 'Tue & Fri', routes: ['102'], limited: true },
    ],
  },
  'routes_atco.json': { 102: ['P1', 'P2'] },
  'atco2name.json': { P1: 'Centre Road', P2: 'The Parade' },
});

// --- 1. the facts an AREA map states ----------------------------------------
console.log('\nfacts — area payload');
{
  const f = buildFacts(areaDir);
  eq('kind inferred', f.kind, 'area');
  eq('subject is the town', f.subject, 'Testbury');
  eq('validFrom carried through verbatim', f.validFrom, 'June 2026');
  eq('routes in the payload’s own order', f.routes.map((r) => r.id), ['A', '9']);
  const r9 = f.routes.find((r) => r.id === '9');
  eq('title + days split out of serviceDesc', [r9.title, r9.days], ['Testbury – Elsewhere', 'Mon & Fri']);
  eq('operator resolved from the operators list', r9.operator, 'Test Coaches');
  eq('colour + contrasting ink kept', [r9.colour, r9.textOn], ['#66CCEE', '#111']);
  eq('ATCO ids become stop names, consecutive repeats dropped', r9.stopsInArea, ['Bus Station', 'High Street', 'The Green']);
  eq('both journeys of one route are kept', r9.journeys.length, 2);
  eq('a limited working is flagged', r9.journeys[1].limited, true);
  eq('journey places in order', r9.journeys[0].places, ['Testbury', 'Midville', 'Elsewhere']);
  check('a route with no journeys still appears', f.routes.some((r) => r.id === 'A' && !r.journeys.length));
  eq('fare note carried', f.fareNote, 'Maximum £3 single fare.');
}

// --- 2. the facts a PLACE map states ----------------------------------------
console.log('\nfacts — place payload');
{
  const f = buildFacts(placeDir);
  eq('kind inferred from the payload shape', f.kind, 'place');
  eq('subject is the place, not the town', f.subject, 'The Test Centre');
  eq('description read from internalDesc', f.routes[0].title, '102  Testbury – Airport');
  eq('destinations hang off the route', f.routes[0].goesTo.map((d) => d.name), ['Airport', 'Backwater']);
  eq('a limited destination is flagged', f.routes[0].goesTo[1].limited, true);
  eq('the place-level destination list survives too', f.destinations.length, 2);
  eq('falls back to routes_atco when there is no in-town file', f.routes[0].stopsInArea, ['Centre Road', 'The Parade']);
  eq('an explicit kind overrides the guess', buildFacts(placeDir, { kind: 'area' }).kind, 'area');
}

// --- 3. shaping for the public page -----------------------------------------
console.log('\npublic shaping');
{
  const row = { id: 1, slug: 'x', name: 'The Test Centre', kind: 'place', subject: '', pub_key: 'v1.0', published_at: '2026-07-20 09:00:00' };
  const s = publicServices(row, buildFacts(placeDir));
  eq('the route number is not repeated in its own title', s.routes[0].title, 'Testbury – Airport');
  eq('a title that does not start with the number is untouched', stripLeadingId('March Town Service', '33A'), 'March Town Service');
  eq('a longer number is not mistaken for the route', stripLeadingId('1020 Something', '102'), '1020 Something');
  eq('no payload ⇒ no services', publicServices(row, null), null);
}

// --- 4. provenance and staleness --------------------------------------------
console.log('\nprovenance');
{
  const row = { id: 1, slug: 'x', name: 'Testbury', kind: 'area', pub_key: 'v1.0', published_at: '2026-06-20 09:00:00' };
  const facts = buildFacts(areaDir);
  const fresh = provenanceFor(row, facts, new Date('2026-07-26T00:00:00Z'));
  eq('the payload’s own words are shown', fresh.dataAsAt, 'June 2026');
  eq('…and a machine date derived from them', fresh.dataAsAtDate, '2026-06-01');
  eq('a month-old map is not stale', fresh.stale, false);

  const old = provenanceFor(row, facts, new Date(`202${6 + 1}-06-01T00:00:00Z`));
  check('a year-old map is stale', old.stale === true, JSON.stringify(old));
  eq('the threshold is reported so the page can say it', old.staleAfterMonths, STALE_AFTER_MONTHS);

  const noFacts = provenanceFor(row, null, new Date('2026-07-26T00:00:00Z'));
  eq('with no payload it falls back to the publication date', noFacts.dataAsAtDate, '2026-06-20');

  eq('"June 2026" parses', parseValidFrom('June 2026').toISOString().slice(0, 10), '2026-06-01');
  eq('"2026-06" parses', parseValidFrom('2026-06').toISOString().slice(0, 10), '2026-06-01');
  eq('nonsense is null, not a crash', parseValidFrom('sometime soon'), null);
  eq('empty is null', parseValidFrom(''), null);
}

// --- 5. the inline SVG -------------------------------------------------------
console.log('\ninline SVG');
{
  const src = path.join(scratch, 'in.svg');
  writeFileSync(src, '<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 297 210">'
    + '<rect width="297" height="210" fill="#fff"/>'
    + '<text x="1" y="2" font-family="Arial" font-size="3.0">High Street</text>'
    + '<script>alert(1)</script><g onclick="alert(2)"><a href="javascript:alert(3)">x</a></g>'
    + '</svg>');
  const out = inlineSvg(src, { title: 'Testbury — Within the area', desc: 'See /m/x/services.' });

  check('the print size is dropped so it scales to its box', !/<svg[^>]*\swidth=/.test(out) && !/<svg[^>]*\sheight=/.test(out));
  check('the viewBox is kept', /<svg[^>]*viewBox="0 0 297 210"/.test(out));
  check('it announces itself as an image', /<svg[^>]*role="img"/.test(out));
  check('…labelled by its own title and desc', /aria-labelledby="cbm-t cbm-d"/.test(out));
  check('the title is present', out.includes('<title id="cbm-t">Testbury — Within the area</title>'));
  check('the desc points at the text alternative', out.includes('See /m/x/services.'));
  eq('Arial becomes a metric-compatible stack', out.includes(`font-family="${FONT_STACK}"`), true);
  check('no bare Arial is left', !/font-family="Arial"/.test(out));
  check('scripts are stripped', !/<script/i.test(out));
  check('inline handlers are stripped', !/onclick/i.test(out));
  check('javascript: URLs are stripped', !/javascript:/i.test(out));
  check('the artwork itself is untouched', out.includes('<rect width="297" height="210" fill="#fff"/>'));
  check('running it twice is stable', inlineSvg(src, { title: 'a', desc: 'b' }).length > 0);
}

try { rmSync(scratch, { recursive: true, force: true }); } catch { /* windows file locks */ }
console.log(failures ? `\n✗ ${failures} P8a check(s) failed` : '\n✓ all P8a checks passed');
process.exit(failures ? 1 : 0);
