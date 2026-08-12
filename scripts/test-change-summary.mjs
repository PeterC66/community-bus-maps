// changeSummary() — the diff both the customer's editor and the approver's review
// screen read to answer "what does publishing this change?".
//
//   node scripts/test-change-summary.mjs
//
// The case that matters (findings A1): a version created by ACCEPTING a data
// refresh carries no override changes at all, and for a long time this function
// therefore reported it as identical to the published version — so the editor
// advised "make an edit and save first" and the review screen told the approver
// there was "nothing to change" on a map whose timetable had moved. `unchanged`
// must mean BOTH halves are empty, never just the overrides half.

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { changeSummary, isEmptyDataChange } = await import('../src/publish/index.js');

const palette = { 9: '#66ccee', 300: '#228833' };
const opts = (extra) => ({ palette, hasBaseline: true, ...extra });

// A refresh that moved a stop and reworded a description — the shape written by
// src/refresh/index.js diffRouteData() and stored on map_version.data_change_json.
const realRefresh = {
  version: 'v2.0',
  createdAt: '2026-08-11 09:00:00',
  sourceNote: 'BODS August 2026 refresh',
  summary: {
    unchanged: false,
    routesAdded: [], routesRemoved: [],
    descChanged: [{ id: '32', from: ['March – Ramsey'], to: ['March – Ramsey · revised times'] }],
    stopsChanged: [{ id: '33A', added: 0, removed: 1 }],
    operatorsAdded: [], operatorsRemoved: [],
    validity: { from: 'June 2026', to: 'August 2026' },
  },
};

console.log('\nnothing changed at all');
{
  const s = changeSummary({}, {}, opts());
  check('unchanged', s.unchanged === true);
  check('overridesUnchanged', s.overridesUnchanged === true);
  check('dataChanged is false', s.dataChanged === false);
  eq('no data changes', s.dataChanges, []);
}

console.log('\nan accepted data refresh, and no edit of the customer\'s own');
{
  const s = changeSummary({}, {}, opts({ dataChanges: [realRefresh] }));
  check('NOT unchanged — this is the whole point', s.unchanged === false);
  check('overridesUnchanged is still true (nothing was edited here)', s.overridesUnchanged === true);
  check('dataChanged', s.dataChanged === true);
  check('the refresh is passed through for display', s.dataChanges.length === 1);
  eq('...with the exact old→new wording intact', s.dataChanges[0].summary.descChanged[0].to, ['March – Ramsey · revised times']);
}

console.log('\na refresh that moved nothing must not defeat "unchanged"');
{
  const noop = { version: 'v3.0', createdAt: '2026-08-11 09:00:00', sourceNote: '', summary: { unchanged: true, routesAdded: [], routesRemoved: [], descChanged: [], stopsChanged: [] } };
  const s = changeSummary({}, {}, opts({ dataChanges: [noop] }));
  check('unchanged', s.unchanged === true);
  eq('the no-op refresh is filtered out', s.dataChanges, []);
}

console.log('\nboth halves changed');
{
  const s = changeSummary(
    { routeColors: { 9: '#AA3377' } }, { routeColors: { 9: '#66CCEE' } },
    opts({ dataChanges: [realRefresh] }),
  );
  check('not unchanged', s.unchanged === false);
  check('overrides half reported', s.overridesUnchanged === false && s.routes.length === 1);
  check('data half reported', s.dataChanges.length === 1);
  eq('the colour change is still described', [s.routes[0].id, s.routes[0].to], ['9', '#aa3377']);
}

console.log('\nan overrides-only change still behaves exactly as before');
{
  const s = changeSummary(
    { internal: { pois: { 'library': { hide: true } } } }, {},
    opts(),
  );
  check('not unchanged', s.unchanged === false);
  check('dataChanged is false', s.dataChanged === false);
  eq('the hidden landmark is listed', s.poisHidden, ['library']);
}

console.log('\nmultiple accepted refreshes since the published version');
{
  const second = { ...realRefresh, version: 'v3.0', summary: { ...realRefresh.summary, routesAdded: ['46'] } };
  const s = changeSummary({}, {}, opts({ dataChanges: [realRefresh, second] }));
  check('both are carried, oldest first', s.dataChanges.length === 2 && s.dataChanges[0].version === 'v2.0');
}

console.log('\nisEmptyDataChange');
{
  check('missing summary is empty', isEmptyDataChange(undefined) === true);
  check('explicit unchanged:true is empty', isEmptyDataChange({ unchanged: true, routesAdded: ['9'] }) === true);
  check('explicit unchanged:false is not empty', isEmptyDataChange({ unchanged: false }) === false);
  check('no `unchanged` field: falls back to the fields', isEmptyDataChange({ stopsChanged: [{ id: '9', added: 1, removed: 0 }] }) === false);
  check('...and an all-empty one is empty', isEmptyDataChange({ routesAdded: [], descChanged: [] }) === true);
  check('an operator change alone counts', isEmptyDataChange({ operatorsRemoved: ['Dews Coaches'] }) === false);
}

console.log(failures ? `\n✗ ${failures} change-summary check(s) failed\n` : '\n✓ all change-summary checks passed\n');
process.exit(failures ? 1 : 0);
