// diffLandmarks() and dataChangeSummary()'s landmark half (OA-253) — the answer
// to "which places has OpenStreetMap gained or lost since the last build?".
//
//   node scripts/test-landmark-arrivals.mjs
//
// WHY THIS EXISTS. A place OSM gains between two builds enters the candidate list
// answered by neither tier layer, takes the default *show if there is room*, and
// can print on the refreshed sheet without anybody deciding it should. Nothing in
// the update flow said so: changeSummary() compares two versions' OVERRIDES, so it
// reports a landmark a PERSON promoted and cannot report one that simply arrived.
//
// The two properties that matter most are not the happy path:
//
//   1. SILENCE WHEN UNSURE. enumerateCandidatesFromDir() returns [] for a folder
//      with no osm.json, for a payload whose selector will not load, and for a
//      place pack that carries neither. An empty list on ONE side would report the
//      whole of the other side as arrivals — "145 new places" on a refresh that
//      changed nothing. That is worse than the silence it replaced, so a side with
//      no candidates suppresses the comparison and says so in `landmarksKnown`.
//   2. `unchanged` HAS TO MOVE. isEmptyDataChange() returns `unchanged` verbatim
//      when it is present, so a refresh whose only change is a new landmark would
//      go on reporting itself as identical if the fold were missed.

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const keys = (list) => (list || []).map((p) => p.key);
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { diffLandmarks, dataChangeSummary } = await import('../src/refresh/index.js');
const { isEmptyDataChange } = await import('../src/publish/index.js');

const p = (key, name, cat) => ({ key, name, cat: cat || key.split(':')[0] });

console.log('\ndiffLandmarks() — the pure half');

{
  const from = [p('shop:Tesco', 'Tesco'), p('health:The Surgery', 'The Surgery')];
  const to = [p('shop:Tesco', 'Tesco'), p('health:The Surgery', 'The Surgery')];
  const d = diffLandmarks(from, to);
  eq('an identical pair reports nothing added', keys(d.added), []);
  eq('…and nothing removed', keys(d.removed), []);
}

{
  const from = [p('shop:Tesco', 'Tesco')];
  const to = [p('shop:Tesco', 'Tesco'), p('shop:Aldi', 'Aldi'), p('leisure:The Hive', 'The Hive')];
  const d = diffLandmarks(from, to);
  eq('two arrivals, sorted by key', keys(d.added), ['leisure:The Hive', 'shop:Aldi']);
  eq('nothing removed', keys(d.removed), []);
  check('an arrival carries its name and category for the sentence',
    d.added[1].name === 'Aldi' && d.added[1].cat === 'shop', JSON.stringify(d.added[1]));
}

{
  const from = [p('shop:Tesco', 'Tesco'), p('health:Old Clinic', 'Old Clinic')];
  const to = [p('shop:Tesco', 'Tesco')];
  const d = diffLandmarks(from, to);
  eq('a departure is reported', keys(d.removed), ['health:Old Clinic']);
  eq('…and is not also an arrival', keys(d.added), []);
}

{
  // The rename case. The key IS the identity a tier answer is written against, so
  // one of each is the truthful answer, not a limitation: the answer really is
  // orphaned and the place really does need answering again.
  const from = [p('shop:Co-op', 'Co-op')];
  const to = [p('shop:Co-operative Food', 'Co-operative Food')];
  const d = diffLandmarks(from, to);
  eq('a rename reads as one arrival', keys(d.added), ['shop:Co-operative Food']);
  eq('…and one departure', keys(d.removed), ['shop:Co-op']);
}

{
  // Two candidates can share one key since OA-234 (two unnamed pharmacies). One
  // arrival should be reported once.
  const from = [];
  const to = [p('health:', '', 'health'), p('health:', '', 'health')];
  const d = diffLandmarks(from, to);
  eq('two candidates sharing a key are one arrival', keys(d.added), ['health:']);
}

{
  const d = diffLandmarks(null, undefined);
  check('null inputs are empty rather than a throw', d.added.length === 0 && d.removed.length === 0);
}

console.log('\ndataChangeSummary() — the folder half');

// Two data folders that differ only in their OSM payload. routes.json is the same
// file both sides, so every service fact is identical and the landmark diff is the
// only thing that can move the verdict.
const OSM = (names) => ({
  version: 0.6,
  elements: names.map((n, i) => ({
    type: 'node', id: 1000 + i, lat: 52.32 + i * 0.001, lon: -0.07 + i * 0.001,
    tags: { amenity: 'pharmacy', name: n },
  })),
});
const ROUTES = { palette: { 1: '#66ccee' }, poi: {} };

function folder(osmNames) {
  const d = mkdtempSync(path.join(tmpdir(), 'lm-'));
  writeFileSync(path.join(d, 'routes.json'), JSON.stringify(ROUTES));
  if (osmNames) writeFileSync(path.join(d, 'osm.json'), JSON.stringify(OSM(osmNames)));
  return d;
}
const tmp = [];
const mk = (n) => { const d = folder(n); tmp.push(d); return d; };

{
  const a = mk(['Boots', 'Lloyds']);
  const b = mk(['Boots', 'Lloyds', 'Well']);
  const s = dataChangeSummary(a, b);
  check('the selector found candidates on both sides', s.landmarksKnown === true, JSON.stringify(s.landmarksKnown));
  eq('the new pharmacy is reported', keys(s.landmarksAdded), ['pharmacy:Well']);
  eq('nothing is reported gone', keys(s.landmarksRemoved), []);
  check('a landmark-only refresh is NOT unchanged', s.unchanged === false, `unchanged=${s.unchanged}`);
  check('…so isEmptyDataChange agrees it changed', isEmptyDataChange(s) === false);
}

{
  const a = mk(['Boots', 'Lloyds']);
  const b = mk(['Boots', 'Lloyds']);
  const s = dataChangeSummary(a, b);
  check('an identical pair is still unchanged', s.unchanged === true, `unchanged=${s.unchanged}`);
  check('…and isEmptyDataChange agrees', isEmptyDataChange(s) === true);
  eq('with no arrivals', keys(s.landmarksAdded), []);
}

{
  // THE FAULT THIS GUARD EXISTS FOR: one side has no osm.json, so it enumerates
  // nothing, and a naive diff would call the entire other side an arrival.
  const a = mk(null);
  const b = mk(['Boots', 'Lloyds']);
  const s = dataChangeSummary(a, b);
  check('a side with no candidates suppresses the comparison', s.landmarksKnown === false, JSON.stringify(s.landmarksKnown));
  eq('…reporting no arrivals rather than two', keys(s.landmarksAdded), []);
  eq('…and no departures', keys(s.landmarksRemoved), []);
  check('…and the refresh reads as unchanged, exactly as it did before OA-253', s.unchanged === true);
}

{
  const s = dataChangeSummary(mk(['Boots']), 'C:/no/such/folder/at/all');
  check('a missing folder still sets `missing`', s.missing === true);
  check('…and says the landmarks were not compared', s.landmarksKnown === false);
}

console.log('\nisEmptyDataChange() — the fallback for a summary with no verdict');

{
  const partial = { landmarksAdded: [p('shop:Aldi', 'Aldi')], landmarksRemoved: [] };
  check('a verdict-less summary carrying an arrival is not empty', isEmptyDataChange(partial) === false);
  check('…and one carrying neither is', isEmptyDataChange({ landmarksAdded: [], landmarksRemoved: [] }) === true);
  // A summary written before OA-253 keeps its own verdict and is read as it always
  // was: nothing is retro-computed from fields it does not carry.
  check('an old summary with unchanged:true is still empty', isEmptyDataChange({ unchanged: true, routesAdded: [] }) === true);
}

console.log('\nchanges.js — the sentence the reader actually sees');

{
  // public/app/changes.js is a browser IIFE that hangs its exports on `window`,
  // so it loads here with a fake one. This is the shared renderer — the
  // approver's screen and the customer's compare dialog both include it — and
  // testing the STRING is the point: the data half can be perfect while the
  // bullet that carries it says nothing.
  const src = readFileSync(new URL('../public/app/changes.js', import.meta.url), 'utf8');
  const w = {};
  new Function('window', src)(w);
  const html = (summary) => w.PortalChanges.dataChangeHtml([{ version: 'v2.0', createdAt: '2026-09-06 09:00:00', summary }]);

  const one = html({ landmarksAdded: [p('shop:Aldi', 'Aldi')], landmarksRemoved: [] });
  check('one arrival reads in the singular', one.includes('1 new place') && !one.includes('1 new places'), one.slice(0, 400));
  check('…and names it', one.includes('Aldi'));

  const two = html({ landmarksAdded: [], landmarksRemoved: [p('health:Old Clinic', 'Old Clinic'), p('shop:Spar', 'Spar')] });
  check('two departures read in the plural', two.includes('2 places gone'), two.slice(0, 400));

  const many = html({ landmarksAdded: Array.from({ length: 9 }, (_, i) => p(`shop:S${i}`, `Shop ${i}`)), landmarksRemoved: [] });
  check('nine arrivals are a count plus six names', many.includes('9 new places') && many.includes('and 3 more'), many.slice(0, 500));
  check('…and the seventh name is not printed', !many.includes('Shop 6'), many.slice(0, 500));

  const nameless = html({ landmarksAdded: [p('pharmacy:', '')], landmarksRemoved: [] });
  check('a nameless arrival is counted and not printed as an empty bracket',
    nameless.includes('1 new place') && !nameless.includes('()'), nameless.slice(0, 400));

  const none = html({ routesAdded: ['9'], landmarksAdded: [], landmarksRemoved: [] });
  check('no landmark line when nothing moved', !none.includes('new place') && !none.includes('gone'), none.slice(0, 400));

  // THE CUSTOMER'S VARIANT of the same bullet, which the editor page renders
  // through this helper rather than through a copy of its own. It is the half
  // that has to say what happens if they do nothing.
  const lb = (s, opts) => w.PortalChanges.landmarkBullets(s, opts).join('');
  const approver = lb({ landmarksAdded: [p('shop:Aldi', 'Aldi')] });
  check('the approver is told the fact and not what to do', !approver.includes('<a href'), approver);
  const customer = lb({ landmarksAdded: [p('shop:Aldi', 'Aldi')] }, { chooserHref: '/app/maps/7/landmarks' });
  check('the customer gets the chooser link', customer.includes('href="/app/maps/7/landmarks"'), customer);
  check('…and is told what happens if they do nothing', customer.includes('shown if there is room'), customer);
  check('…in the singular', customer.includes('it is shown') && customer.includes('It is</em>') === false, customer);
  const customerMany = lb({ landmarksAdded: [p('shop:Aldi', 'Aldi'), p('shop:Lidl', 'Lidl')] }, { chooserHref: '/x' });
  check('…and in the plural for two', customerMany.includes('each is shown') && customerMany.includes('They are'), customerMany);
  const goneOne = lb({ landmarksRemoved: [p('shop:Spar', 'Spar')] }, { chooserHref: '/x' });
  check('a single departure keeps the answer, in the singular', goneOne.includes('any answer you gave it is kept') && goneOne.includes('it comes back'), goneOne);
  // An href is written into an attribute, so it goes through esc() like any other
  // untrusted string — it is built from MAP_ID today, and that is not a reason for
  // the one renderer both screens share to trust its caller.
  const nasty = lb({ landmarksAdded: [p('shop:X', 'X')] }, { chooserHref: '/a"onmouseover="alert(1)' });
  check('the chooser link is escaped', !nasty.includes('onmouseover="alert'), nasty);

  // THE JOIN, which is the one thing every assertion above takes on trust: this
  // helper is only the customer's bullet if the customer's page calls it and
  // loads the file that defines it. Everything else here tests a function that
  // might reach nobody.
  const editorJs = readFileSync(new URL('../public/app/editor.js', import.meta.url), 'utf8');
  const editorHtml = readFileSync(new URL('../views/app/editor.html', import.meta.url), 'utf8');
  check('the editor page loads changes.js', editorHtml.includes('/app/changes.js'));
  check('…and its data summary renders through landmarkBullets', /PC\(\)\.landmarkBullets\(sum/.test(editorJs));
  check('…passing the map\'s own chooser link', /chooserHref: `\/app\/maps\/\$\{MAP_ID\}\/landmarks`/.test(editorJs));
  check('…and keeps no second copy of the wording', !editorJs.includes('shown if there is room until you say otherwise'), 'editor.js still carries its own landmark sentence');
}

for (const d of tmp) { try { rmSync(d, { recursive: true, force: true }); } catch { /* leave it */ } }

console.log(failures ? `\n${failures} failed` : '\nAll landmark-arrival checks passed');
process.exit(failures ? 1 : 0);
