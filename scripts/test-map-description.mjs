#!/usr/bin/env node
// A MAP CAN CARRY A DESCRIPTION OF ITS OWN (buses-data OA-545).
//
//   node scripts/test-map-description.mjs        (or: npm run test:map-description)
//
// WHY IT EXISTS. High Wycombe has two maps of one town, the whole-town map and
// the town-centre close-up, and each needs a sentence saying what the other is
// for. The portal had nowhere to keep one: `map` held a name, a subject and a
// status, the page's meta description was generated, and the only free text was
// an organisation's blurb, which every one of its maps shares. `map.description`
// is that place.
//
// WHAT IT ASKS, and the order matters because each section is only worth
// reading if the one before held:
//   1. cleanDescription() strips what must never reach a public page (angle
//      brackets, control characters, runs of space) and bounds the length.
//   2. A database that predates the column gains it on open, because every
//      deployed database does — the migration is the part a fresh test database
//      can never exercise on its own.
//   3. The value stores, reads back, and clears to NULL.
//   4. The wiring joins: the PATCH route is registered and recorded in the route
//      table, and the public page prefers the stored sentence to the generated one.

import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDescription, DESCRIPTION_MAX } from '../src/maps/description.js';
import { linkifyDescription } from '../public/js/shared/linkify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('1  cleanDescription');
check('plain text passes through', cleanDescription('Buses across High Wycombe.') === 'Buses across High Wycombe.');
check('angle brackets are dropped', cleanDescription('a <b>bold</b> claim') === 'a bbold/b claim');
check('control characters and runs of space become one space', cleanDescription('a\u0000 b\n\n  c\t d') === 'a b c d');
check('longer than the limit is cut to it', cleanDescription('x'.repeat(DESCRIPTION_MAX + 50)).length === DESCRIPTION_MAX);
check('not a string, or only space, is empty', cleanDescription(null) === '' && cleanDescription(42) === '' && cleanDescription('  \n ') === '');
check('both agreed High Wycombe sentences fit the limit',
  'Buses across High Wycombe and the places they reach. The town centre is drawn as one box on this map; for every bus and street inside it, see the town-centre map at busmaps.uk/m/high-wycombe-town-centre.'.length <= DESCRIPTION_MAX
  && 'A close-up of High Wycombe town centre: every bus through the bus station, Oxford Street and Frogmoor, and where each one goes. For the rest of the town, see busmaps.uk/m/high-wycombe.'.length <= DESCRIPTION_MAX);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-desc-'));
const env = { ...process.env, DATA_DIR: scratch, DB_PATH: path.join(scratch, 'portal.sqlite'), NODE_ENV: 'test' };
const DB = JSON.stringify(new URL('../src/db/index.js', import.meta.url).href);
const child = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env, encoding: 'utf8' });
const last = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

console.log('');
console.log('2  a database that predates the column gains it');
const seed = child(`
  const db = await import(${DB});
  const cust = db.insertCustomer({ name: 'Test Council', type: 'council' });
  const id = db.insertMap({ customer_id: cust, slug: 'testville', name: 'Testville', kind: 'area', data_dir: '', status: 'draft' });
  console.log(JSON.stringify({ id }));
`);
if (seed.status !== 0) check('the fixture seeds', false, (seed.stderr || '').split('\n').slice(0, 4).join(' | '));
else {
  const { id } = last(seed);
  // Drop the column by hand, as if this database had been written before OA-545, then open it again.
  const drop = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(${JSON.stringify(env.DB_PATH)});
    d.exec('ALTER TABLE map DROP COLUMN description');
    console.log(JSON.stringify(d.prepare('PRAGMA table_info(map)').all().map((c) => c.name).includes('description')));
  `], { cwd: ROOT, env, encoding: 'utf8' });
  check('the column can be removed to simulate an older database', drop.status === 0 && drop.stdout.trim() === 'false', (drop.stderr || '').slice(0, 200));
  const reopen = child(`
    const db = await import(${DB});
    const m = db.getMap(${id});
    console.log(JSON.stringify({ has: !!m && 'description' in m }));
  `);
  check('opening it again adds the column', reopen.status === 0 && last(reopen).has === true, (reopen.stderr || '').slice(0, 200));

  console.log('');
  console.log('3  it stores, reads back and clears');
  const rt = child(`
    const db = await import(${DB});
    const out = { before: db.getMap(${id}).description };
    db.setMapDescription(${id}, 'A close-up of the town centre.');
    out.set = db.getMap(${id}).description;
    db.setMapDescription(${id}, '');
    out.cleared = db.getMap(${id}).description;
    console.log(JSON.stringify(out));
  `);
  const r = rt.status === 0 ? last(rt) : {};
  check('a new map has none', r.before === null, JSON.stringify(r) + (rt.stderr || '').slice(0, 200));
  check('a set description reads back', r.set === 'A close-up of the town centre.');
  check('an empty one clears it to NULL', r.cleared === null);
}

console.log('');
console.log('4  the wiring');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
check('the PATCH route is registered', /app\.patch\('\/:id\/description'/.test(read('src', 'routes', 'editor.js')));
check('and recorded in the route table', JSON.parse(read('scripts', 'route-table.json')).includes('PATCH /api/maps/:id/description'));
check('the public meta description prefers the stored sentence', /m\.description\s*\?\s*m\.description/.test(read('src', 'routes', 'public.js')));
check('the public listing carries it', /description: row\.description/.test(read('src', 'public', 'index.js')));
check('the public page shows it, through the linkifier', /\$\('lead'\)\.innerHTML = linkifyDescription\(map\.description\)/.test(read('public', 'js', 'public-map.js')));

console.log('');
console.log('5  a URL in the sentence becomes a link, and nothing else becomes markup');
const L = linkifyDescription;
check('plain text is only escaped', L('Tom & Jerry "x"') === 'Tom &amp; Jerry &quot;x&quot;');
check('a bare busmaps.uk path is a link to this site, with no rel', L('see busmaps.uk/m/high-wycombe-town-centre.') === 'see <a href="https://busmaps.uk/m/high-wycombe-town-centre">busmaps.uk/m/high-wycombe-town-centre</a>.');
check('a full https URL on this site is the same', L('https://busmaps.uk/m/x') === '<a href="https://busmaps.uk/m/x">https://busmaps.uk/m/x</a>');
check('another host gets nofollow noopener', L('at https://example.org/a?b=1&c=2, ok') === 'at <a href="https://example.org/a?b=1&amp;c=2" rel="nofollow noopener">https://example.org/a?b=1&amp;c=2</a>, ok');
check('a lookalike host is not this site', /rel="nofollow noopener"/.test(L('https://busmaps.uk.evil.example/x')));
check('markup is escaped, not passed', L('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;');
check('a quote cannot open an attribute', !/<a [^>]*onmouseover/.test(L('https://example.org/"onmouseover="x')));
check('empty and non-strings are empty', L('') === '' && L(null) === '');

console.log('');
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all checks passed');
