// Safe-subset validation checks — src/maps/safeSubset.js is the security
// boundary between an untrusted client edit and what reaches the generator.
//
//   node scripts/test-safe-subset.mjs          (or: npm run test:safe-subset)
//
// Covers the hiddenOperators key (2026-08-03): it must be accepted ONLY for a
// customer with the feature enabled, ONLY for a real operator name, and must
// disappear entirely (no key at all) when empty — same no-op-drops rule as
// routeColors/pois, so an untouched map still serialises to {}.

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { sanitizeOverrides } = await import('../src/maps/safeSubset.js');

const palette = { 9: '#66CCEE', 300: '#228833' };
const operatorNames = ['Dews Coaches', 'Villager Minibus'];

console.log('\nhiddenOperators — feature disabled for this customer (default)');
{
  const { overrides, rejected } = sanitizeOverrides(
    { hiddenOperators: ['Villager Minibus'] },
    { palette, operatorNames, operatorFilterEnabled: false },
  );
  eq('every entry dropped', overrides.hiddenOperators, undefined);
  check('rejected explains why', rejected.some((r) => r.includes('not enabled for this customer')), rejected.join('; '));
}

console.log('\nhiddenOperators — feature enabled, known operator');
{
  const { overrides, rejected } = sanitizeOverrides(
    { hiddenOperators: ['Villager Minibus'] },
    { palette, operatorNames, operatorFilterEnabled: true },
  );
  eq('kept', overrides.hiddenOperators, ['Villager Minibus']);
  eq('nothing rejected', rejected, []);
}

console.log('\nhiddenOperators — feature enabled, unknown operator name');
{
  const { overrides, rejected } = sanitizeOverrides(
    { hiddenOperators: ['Made-Up Buses Ltd'] },
    { palette, operatorNames, operatorFilterEnabled: true },
  );
  eq('dropped', overrides.hiddenOperators, undefined);
  check('rejected explains why', rejected.some((r) => r.includes('unknown operator')), rejected.join('; '));
}

console.log('\nhiddenOperators — empty array is a no-op, drops the key entirely');
{
  const { overrides } = sanitizeOverrides(
    { hiddenOperators: [] },
    { palette, operatorNames, operatorFilterEnabled: true },
  );
  check('no key at all', !('hiddenOperators' in overrides));
}

console.log('\nhiddenOperators — untouched map still serialises to {}');
{
  const { overrides, rejected } = sanitizeOverrides({}, { palette, operatorNames, operatorFilterEnabled: true });
  eq('empty overrides', overrides, {});
  eq('nothing rejected', rejected, []);
}

console.log('\nhiddenOperators — mixed valid + invalid, only valid survives');
{
  const { overrides, rejected } = sanitizeOverrides(
    { hiddenOperators: ['Dews Coaches', 'Not A Real Operator'] },
    { palette, operatorNames, operatorFilterEnabled: true },
  );
  eq('only the real one kept', overrides.hiddenOperators, ['Dews Coaches']);
  check('the fake one rejected', rejected.some((r) => r.includes('Not A Real Operator')), rejected.join('; '));
}

console.log('\nexisting routeColors/pois behaviour is unaffected by the new param');
{
  const { overrides } = sanitizeOverrides(
    { routeColors: { 9: '#ff0000' } },
    { palette, operatorNames, operatorFilterEnabled: true },
  );
  eq('routeColors still works', overrides.routeColors, { 9: '#ff0000' });
}

if (failures) {
  console.error(`\n✗ ${failures} safe-subset check(s) failed`);
  process.exit(1);
}
console.log('\n✓ all safe-subset checks passed');
