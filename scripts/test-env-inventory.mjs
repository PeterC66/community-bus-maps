// Where this deployment reads its environment, asked as a CLOSED question
// (OA-224 Tier 5, portal-src F7).
//
// `process.env` was read in eight files under `src/`: 20 reads outside
// `src/config.js`, including every secret the system has, while `config.js` held
// three flags. The cost was not tidiness. It was that nothing could answer *what
// does this deployment read, and what happens when it is unset?* — and the
// fail-direction of each variable, which this codebase argues about carefully
// for PILOT and INDEXING, was invisible for the rest of them.
//
// THE ASSERTION IS THE CENSUS, not a list of the variables. A test naming the
// variables would be right on the day it was written and silent about the
// twenty-first; this one asks of EVERY file under `src/` whether it reads
// `process.env` at all, and allows exactly three, each for a reason recorded
// here and in `config.js`. It is the same shape as `test-operator-token.mjs`'s
// "operatorRead is defined once and called exactly three times", which is what
// caught the editor plugin's new call site the day it appeared.
//
// The second half matters as much: an accessor `config.js` exports that NOTHING
// imports is an env var somebody stopped reading, and leaving it exported is how
// a deployment ends up documenting a variable it ignores.
//
// Usage, from the repository root:  node scripts/test-env-inventory.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

/* The three files allowed their own reads, and why. A fourth is a finding, not a
 * judgement call for whoever adds it. */
const ALLOWED = new Map([
  ['config.js', 'the inventory itself'],
  ['db/paths.js', 'it exists so a script can learn a path without importing anything that opens a database; importing config.js to get one would undo that'],
  ['version.js', 'build stamps injected into the image, read by code that must not depend on config'],
]);

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

const files = jsFiles(SRC);
check('there is a src/ to read', files.length > 20, `${files.length} .js files`);

console.log('\nevery process.env read under src/ is in a file declared to have one');
const offenders = [];
for (const f of files) {
  const rel = path.relative(SRC, f).replace(/\\/g, '/');
  const src = readFileSync(f, 'utf8');
  const n = src.split('process.env.').length - 1;
  if (!n) continue;
  if (ALLOWED.has(rel)) { console.log(`  ✓ ${rel} — ${n} read(s), allowed: ${ALLOWED.get(rel)}`); continue; }
  offenders.push(`${rel} (${n})`);
}
check('no other file reads process.env', offenders.length === 0, offenders.join(', '));

console.log('\nthe three allowed files really do still read it');
// A file listed here that has STOPPED reading env is an exception nobody removed,
// and an exception with nothing behind it is how the list stops meaning anything.
for (const [rel, why] of ALLOWED) {
  const src = readFileSync(path.join(SRC, rel), 'utf8');
  check(`${rel} still reads process.env`, src.includes('process.env.'), `it does not — remove it from ALLOWED (${why})`);
}

console.log('\nevery accessor config.js exports is imported by something');
const config = await import('../src/config.js');
const ACCESSORS = Object.keys(config).filter((k) => typeof config[k] === 'function');
check('config.js exports accessors at all', ACCESSORS.length >= 8, ACCESSORS.join(', '));
const others = files.filter((f) => path.relative(SRC, f).replace(/\\/g, '/') !== 'config.js').map((f) => readFileSync(f, 'utf8')).join('\n');
for (const name of ACCESSORS) {
  check(`  ${name}() is used`, new RegExp(`\\b${name}\\b`).test(others),
    'nothing under src/ imports it — either wire it up or drop the variable from the inventory');
}

console.log('\nPUBLIC_BASE_URL is read ONE way');
/* It used to be read three ways: http/helpers.js stripped every trailing slash,
 * email/notify.js stripped one, worklist/index.js stripped none — so a value
 * ending in `/` gave the operator's worklist a double slash the app never showed.
 * Three spellings of one value is the shape sessionTokenHash/tokenHash had. */
const before = process.env.PUBLIC_BASE_URL;
process.env.PUBLIC_BASE_URL = 'https://example.test///';
check('every trailing slash is removed', config.publicBaseUrl() === 'https://example.test', config.publicBaseUrl());
process.env.PUBLIC_BASE_URL = '';
check('an unset value reads as empty, not as "undefined"', config.publicBaseUrl() === '');
if (before === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = before;

console.log('\nthe secrets fail CLOSED when unset');
// An unconfigured portal must admit nobody rather than everybody. The accessors
// return '' and tokenMatches() refuses an empty expectation.
const { tokenMatches } = await import('../src/http/helpers.js');
for (const name of ['metricsToken', 'operatorToken', 'statusToken']) {
  const kept = process.env[name.replace(/([A-Z])/g, '_$1').toUpperCase()];
  const envName = name === 'metricsToken' ? 'METRICS_TOKEN' : name === 'operatorToken' ? 'OPERATOR_TOKEN' : 'STATUS_TOKEN';
  const prev = process.env[envName];
  delete process.env[envName];
  check(`  ${envName} unset reads as '' and matches nothing`,
    config[name]() === '' && tokenMatches('anything', config[name]()) === false);
  if (prev !== undefined) process.env[envName] = prev;
  void kept;
}

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all env-inventory checks passed');
process.exit(failures ? 1 : 0);
