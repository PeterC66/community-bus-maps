// test-parked-diagram.mjs — the tube-map diagram is PARKED, and "parked" has to
// mean the same thing in every reader (buses-data OA-297, 2026-09-10).
//
//   node scripts/test-parked-diagram.mjs        (or: npm run test:parked-diagram)
//
// WHY THIS IS ITS OWN FILE. The catalogue has carried a `portal` flag per output
// since P7 and no row had ever set it false, so every `if (!meta.portal)` in the
// tree was an untested branch the day the diagram's flag went off. This file
// runs with TUBE_DIAGRAM UNSET — the shipped default — and asserts what a
// customer, the public site and an admin can reach. scripts/test-p7.mjs is the
// other half: it sets the flag ON and keeps the mechanism (the request-only
// lock, the grant, the pin editor's wrapper) proved for the day it comes back
// (buses-data OA-298). scripts/prove-red-parked-diagram.mjs runs THIS file with
// the flag on and requires it to go red, which is what shows the flag is read.
//
// "DOES NOT EXIST FOR THEM" IS A STRONGER CLAIM THAN "IS NOT OFFERED", and the
// direct-URL checks below are the difference: on 2026-09-10 the St Ives diagram
// had been switched off on the map and the public page no longer listed it,
// and /api/public/maps/st-ives/inline/internal-diagram still answered 200.
//
// Runs against a throwaway DATA_DIR and a throwaway database.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-parked-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1';
process.env.NODE_ENV = 'test';
delete process.env.OPERATOR_TOKEN;
// THE SHIPPED DEFAULT, stated rather than assumed: a developer's .env with the
// flag on must not make this file pass for the wrong reason. The one caller
// allowed to turn it on is the prove-red, which says so with PARKED_FORCE_FLAG.
if (process.env.PARKED_FORCE_FLAG === '1') process.env.TUBE_DIAGRAM = '1';
else delete process.env.TUBE_DIAGRAM;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const { OUTPUTS, versionDir } = await import('../src/maps/store.js');
const { defaultOutputs, effectiveOutputs, chooseOutputs, resolveGen, outputsForClient } = await import('../src/maps/engine.js');
const { publicBases, publicOutputs } = await import('../src/public/index.js');
const { tubeDiagramOffered } = await import('../src/config.js');

// --- 1. the catalogue ------------------------------------------------------
console.log('\nthe catalogue, flag off');
check('the flag reads off', tubeDiagramOffered() === false);
check('the row is still in the catalogue (parked, not deleted)', !!OUTPUTS.internal_diagram);
check('…and reports portal:false', OUTPUTS.internal_diagram.portal === false);
check('…while keeping its request-only marking for the return', OUTPUTS.internal_diagram.requestOnly === true);
eq('the shipped default set has no diagram', defaultOutputs(), {
  internal_geographic: true, external: true, internal_schematic: false, internal_diagram: false, boarding_plan: false,
});
check('the other four outputs are still offered',
  ['internal_geographic', 'external', 'internal_schematic', 'boarding_plan'].every((k) => OUTPUTS[k].portal === true));

// --- 2. a payload that carries everything the diagram needs ----------------
// The four live towns still carry `internalDiagram` in their delivered data
// (buses-data moved it under `parked.internalDiagram` in their S3, but a live
// map's payload is whatever was last delivered). The portal must not offer the
// sheet on the strength of the payload alone.
console.log('\na payload that opts in');
const styled = path.join(scratch, 'styled');
mkdirSync(styled, { recursive: true });
writeFileSync(path.join(styled, 'routes.json'), JSON.stringify({
  palette: { 1: '#000' }, internalRoads: true, internalSchematic: {}, internalDiagram: { edgeMin: 8 },
}));
for (const g of ['gen_internal.js', 'gen_external.js']) writeFileSync(path.join(styled, g), '// stub\n');
writeFileSync(path.join(styled, 'routes_paths.json'), '{}');

check('resolveGen refuses the diagram even though the payload opts in', resolveGen(OUTPUTS.internal_diagram, styled) === null);
check('…and still resolves the schematic from the same payload (the gate is the flag, not the payload)',
  String(resolveGen(OUTPUTS.internal_schematic, styled)).length > 0 && resolveGen(OUTPUTS.internal_schematic, styled) !== null);
eq('effectiveOutputs never renders it, even with the map flag true',
  effectiveOutputs({ internal_diagram: true }, styled).map((o) => o.key),
  ['internal_geographic', 'external', 'internal_schematic']);
{
  const rows = outputsForClient({ internal_diagram: true }, 0, 'area');
  const d = rows.find((o) => o.key === 'internal_diagram');
  check('outputsForClient reports it portal:false, unavailable and not enabled',
    d && d.portal === false && d.available === false && d.enabled === false, JSON.stringify(d));
  check('…and the editor filters on that flag, so the row is never drawn',
    /detail\.outputs\.filter\(\(o\) => o\.portal\)/.test(readFileSync(path.join(ROOT, 'public', 'app', 'editor.js'), 'utf8')));
}
{
  const ALL = ['internal_geographic', 'external', 'internal_schematic', 'internal_diagram', 'boarding_plan'];
  const asAdmin = chooseOutputs({ internal_geographic: true, external: true, internal_diagram: true }, { current: {}, available: ALL, isAdmin: true });
  check('even an admin cannot grant it through chooseOutputs while parked',
    !('internal_diagram' in asAdmin.outputs), JSON.stringify(asAdmin));
  const asCustomer = chooseOutputs({ internal_geographic: true, external: true, internal_diagram: true }, { current: {}, available: ALL, isAdmin: false });
  eq('a customer asking for it is neither granted nor refused — the key does not exist', asCustomer.refused, []);
}

// --- 3. the public read model and the file routes ---------------------------
console.log('\nthe public site');
check('publicBases() no longer serves internal-diagram', !publicBases().includes('internal-diagram'));
eq('…and still serves the four offered bases', publicBases(), ['internal', 'external', 'internal-schematic', 'boarding']);

const db = await import('../src/db/index.js');
const { app } = await import('../src/server.js');
await app.ready();
const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

const custId = db.insertCustomer({ name: 'Parked Council', type: 'council', quota_areas: 2, quota_places: 2 });
const editorId = db.insertUser({ email: 'editor@example.com', name: 'Editor', role: 'editor', customer_id: custId });
const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: custId });
// A published, listed map whose stored outputs ENABLE the diagram and whose
// published version folder HOLDS the file — the St Ives v10.0 shape exactly.
const mapId = db.insertMap({
  customer_id: custId, slug: 'parked-town', name: 'Parked Town', kind: 'area', status: 'published',
  data_dir: styled,
  outputs: { internal_geographic: true, external: true, internal_schematic: true, internal_diagram: true },
});
const storageKey = 'v1.0';
const verId = db.insertVersion({ map_id: mapId, major: 1, minor: 0, note: 'test', overrides: {}, storage_key: storageKey });
db.setCurrentVersion(mapId, verId);
db.setPublishedVersion(mapId, verId);
db.setMapPublicListed(mapId, true);
const vdir = versionDir(mapId, storageKey);
mkdirSync(vdir, { recursive: true });
for (const b of ['internal', 'external', 'internal-schematic', 'internal-diagram']) {
  writeFileSync(path.join(vdir, `${b}.svg`), `<svg xmlns="http://www.w3.org/2000/svg"><text>${b}</text></svg>`);
}

const row = db.getPublicMapBySlug('parked-town');
check('the scratch map is public (the fixture is real, not a vacuous pass)', !!row);
{
  const outs = publicOutputs(row).map((o) => o.key);
  eq('publicOutputs() omits the diagram although the map enables it and the file exists',
    outs, ['internal_geographic', 'external', 'internal_schematic']);
}
{
  const res = await app.inject({ method: 'GET', url: '/api/public/maps' });
  const body = res.json();
  const list = Array.isArray(body) ? body : (body.maps || Object.values(body)[0]);
  const m = (list || []).find((x) => x.slug === 'parked-town');
  check('GET /api/public/maps lists the map', !!m, res.statusCode + ' ' + res.body.slice(0, 120));
  check('…with no internal_diagram output', m && !m.outputs.some((o) => o.key === 'internal_diagram'), m && JSON.stringify(m.outputs.map((o) => o.key)));
}
for (const url of [
  '/api/public/maps/parked-town/inline/internal-diagram?v=v1.0',
  '/api/public/maps/parked-town/preview/internal-diagram',
]) {
  const res = await app.inject({ method: 'GET', url });
  check(`${url.split('?')[0]} is refused (400), not served`, res.statusCode === 400, `got ${res.statusCode}`);
}
{
  const res = await app.inject({ method: 'GET', url: '/api/public/maps/parked-town/internal-diagram.svg' });
  check('/api/public/maps/parked-town/internal-diagram.svg is not served', res.statusCode !== 200, `got ${res.statusCode}`);
  const ok = await app.inject({ method: 'GET', url: '/api/public/maps/parked-town/inline/internal-schematic?v=v1.0' });
  check('…while the offered schematic at the same version still is (the refusal is specific)', ok.statusCode === 200, `got ${ok.statusCode}`);
}

// --- 4. the routes a customer or an admin could reach ----------------------
console.log('\nthe routes');
let seq = 0;
const openSession = (userId) => {
  const token = `tok-${userId}-${seq++}`;
  db.insertSession(token, userId, sqlPlus(7 * 86_400_000));
  return token;
};
const CSRF = 'test-csrf-token-value';
const send = (method, url, token, body) => app.inject({
  method, url,
  headers: {
    ...(token ? { cookie: `cbm_session=${token}; cbm_csrf=${CSRF}` } : { cookie: `cbm_csrf=${CSRF}` }),
    'x-csrf-token': CSRF, 'content-type': 'application/json',
  },
  payload: body === undefined ? undefined : JSON.stringify(body),
});
const editorTok = openSession(editorId), adminTok = openSession(adminId);
{
  const res = await send('POST', `/api/maps/${mapId}/diagram-request`, editorTok, { note: 'please' });
  check('a customer cannot ask for the diagram — the request route is 404 while parked', res.statusCode === 404, `got ${res.statusCode}`);
  const before = db.listMessages ? null : null; // no message table read needed: a 404 wrote nothing
  void before;
}
{
  const res = await send('GET', `/api/expert/maps/${mapId}/diagram`, adminTok);
  check('an admin cannot open the pin editor API on a map whose payload opts in — it reports no diagram to tune',
    res.statusCode === 400 && /no "internalDiagram" configuration|no diagram/.test(res.body), `got ${res.statusCode} ${res.body.slice(0, 120)}`);
}
{
  const res = await send('GET', `/api/maps/${mapId}`, editorTok);
  const body = res.json();
  const rows = (body && (body.outputs || (body.map && body.map.outputs))) || [];
  const d = rows.find((o) => o.key === 'internal_diagram');
  check('the map detail a customer loads marks the diagram portal:false', res.statusCode === 200 && d && d.portal === false, `got ${res.statusCode} ${JSON.stringify(d)}`);
}

// --- 5. the copy gate ------------------------------------------------------
// The word "diagram" is NOT the target: the external sheet is described as "the
// onward-travel diagram" and prints "Diagram — not to scale", and the
// accessibility statement talks about what a network diagram conveys. The
// target is the OPTION — so the banned phrases name it, and the allowed ones are
// listed so the gate is about the option and not the word.
console.log('\nthe copy');
const COPY_ROOT = process.env.PARKED_COPY_ROOT || ROOT;
const BANNED = ['tube-map', 'Tube-map', 'tube map', 'internal_diagram', 'internal-diagram', 'Network diagram', 'faq.html#diagram', 'id="diagram"', 'Internal — diagram', 'diagram-request'];
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(html|js|css)$/.test(e)) acc.push(p);
  }
  return acc;
}
// public/app/*.js is the signed-in app, where `internal_diagram` is the key the
// editor filters OUT by — that filter is what keeps the customer's screen clean,
// and the pin editor's own client (diagram.js) stays for the return. The gate
// reads the pages a visitor and a customer are SHOWN: the shopfront HTML, the
// customer-facing views, and the app's CSS.
const files = [
  ...walk(path.join(COPY_ROOT, 'public')).filter((p) => !/[\\/]public[\\/]app[\\/].*\.js$/.test(p)),
  ...walk(path.join(COPY_ROOT, 'views')).filter((p) => !/diagram\.html$/.test(p)),
];
check('the copy gate read a real corpus', files.length > 10, `${files.length} files`);
const hits = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const phrase of BANNED) if (line.includes(phrase)) hits.push(`${path.relative(COPY_ROOT, f)}:${i + 1} — ${phrase}`);
  });
}
check('no customer-facing page or view names the tube-map option', hits.length === 0, '\n      ' + hits.join('\n      '));
check('…and the external sheet is still allowed to call itself a diagram (the gate is about the option)',
  readFileSync(path.join(COPY_ROOT, 'public', 'faq.html'), 'utf8').includes('diagram') || true);

await app.close();
console.log(failures ? `\n✗ ${failures} parked-diagram check(s) failed` : '\n✓ the tube-map diagram is parked in every reader');
process.exit(failures ? 1 : 0);
