// prove-red-parked-diagram.mjs — falsify test-parked-diagram.mjs in both of the
// ways it could be green for the wrong reason (buses-data OA-297, 2026-09-10).
//
//   node scripts/prove-red-parked-diagram.mjs   (or: npm run test:prove-red-parked-diagram)
//
// A parked feature's test is the easiest kind to leave green for ever: the flag
// has never been on in CI, so nothing has shown the flag is READ rather than
// the row simply being hard-coded off, and a copy gate over a corpus nobody has
// re-inserted the phrase into has never been seen to fire. Two arms, each red on
// purpose, plus the control:
//
//   0  control — the test as shipped, flag unset       -> exit 0
//   1  the flag forced on (PARKED_FORCE_FLAG=1 — the test
//        unsets TUBE_DIAGRAM itself so a developer's .env cannot make it pass
//        for the wrong reason, and this is the one override it honours)
//                                                      -> exit 1, and the failures
//        must be the offered-state ones (portal:true, the row resolves, the
//        public routes serve it) — which is what proves the flag is consulted
//        at each read rather than snapshotted at load
//   2  a scratch copy of public/ + views/ with the pricing line put BACK
//                                                      -> exit 1, and the copy
//        gate must name public/pricing.html and the phrase it found
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY (arm 2 copies public/ and views/
// to a scratch tree and points the test at it with PARKED_COPY_ROOT).

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'scripts', 'test-parked-diagram.mjs');
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

function run(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.TUBE_DIAGRAM;
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [TEST], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (res.stdout || '') + (res.stderr || ''), code: res.status };
}
const reds = (out) => out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());

console.log('\n0  the control — flag unset');
{
  const { out, code } = run();
  if (code !== 0) fail(`the shipped test exits ${code}; nothing below can be trusted:\n${reds(out).join('\n')}`);
  else ok('exit 0');
}

console.log('\n1  TUBE_DIAGRAM=1 — the parked-state assertions must go red');
{
  const { out, code } = run({ PARKED_FORCE_FLAG: '1' });
  if (code === 0) fail('exit 0 with the flag ON — the row is hard-coded off, or the flag is not read; either way the parked state is not what the test proves');
  else ok(`exit ${code}`);
  const r = reds(out);
  const want = [
    ['the flag reads off', 'the accessor'],
    ['reports portal:false', 'the catalogue getter'],
    ['resolveGen refuses the diagram', 'the generator resolution'],
    ['publicBases() no longer serves', 'the public bases'],
    ['inline/internal-diagram is refused', 'the inline route'],
  ];
  for (const [phrase, what] of want) {
    if (r.some((l) => l.includes(phrase))) ok(`${what} went red`);
    else fail(`${what} stayed green with the flag on ("${phrase}") — that reader does not consult the flag`);
  }
  if (r.some((l) => l.includes('no customer-facing page or view names'))) fail('the COPY gate went red under the flag — it must not depend on the flag, only on the files');
  else ok('the copy gate is unaffected by the flag (it reads files, not config)');
}

console.log('\n2  the pricing line put back — the copy gate must name the file');
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'prove-parked-'));
  cpSync(path.join(ROOT, 'public'), path.join(tmp, 'public'), { recursive: true });
  cpSync(path.join(ROOT, 'views'), path.join(tmp, 'views'), { recursive: true });
  const pricing = path.join(tmp, 'public', 'pricing.html');
  const s = readFileSync(pricing, 'utf8');
  const anchor = '<h3 class="mt-0">Costs Extra</h3>';
  if (!s.includes(anchor)) fail('pricing.html no longer has the "Costs Extra" card this arm inserts under — re-aim the arm');
  else {
    writeFileSync(pricing, s.replace(anchor, `${anchor}\n          <ul><li><span class="badge extra">hand-finished · extra</span> The tube-map-style diagram — asked for from inside the editor</li></ul>`));
    const { out, code } = run({ PARKED_COPY_ROOT: tmp });
    if (code === 0) fail('exit 0 with the phrase re-inserted — the copy gate reads nothing, or reads the wrong tree');
    else ok(`exit ${code}`);
    const r = reds(out);
    if (r.some((l) => l.includes('no customer-facing page or view names'))) ok('the copy gate went red');
    else fail('the copy gate stayed green');
    if (/public[\\/]pricing\.html:\d+ — tube-map/.test(out)) ok('…and it names public/pricing.html, the line, and the phrase');
    else fail('…but it does not name the file and phrase, so a reader could not act on it');
    const others = r.filter((l) => !l.includes('no customer-facing page') && !/check\(s\) failed/.test(l));
    if (others.length) fail(`other checks went red on a copy that differs only in one line: ${others.join(' | ')}`);
    else ok('nothing else went red (the mutation is specific)');
  }
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n✗ ${failures} prove-red check(s) failed` : '\n✓ the parked-diagram test can go red, both ways');
process.exit(failures ? 1 : 0);
