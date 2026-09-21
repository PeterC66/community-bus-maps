// prove-red-trust-proxy.mjs — falsify the forwarded-address rules (buses-data OA-256).
//
// Run from the repository root (`C:\Claude\community-bus-maps`, no placeholders):
//     npm run test:prove-red-trust-proxy
//
// WHY. Every failure this guards against is SILENT. Nothing 500s, no page
// breaks, no header changes; the only visible difference between a correct value
// and one that trusts nothing is which address a rate-limit bucket is keyed on,
// and that is readable only on the host. The original fault lived for a month
// behind a comment that confidently described behaviour Fastify does not have.
// So the only way to know these assertions bite is to break the value on purpose
// and watch each one go red for its own reason.
//
//   0  control: the tree unmutated                     -> the suite exits 0
//   1  TRUST_PROXY = 1                                 -> THE BUG VERBATIM
//   2  TRUST_PROXY = true                              -> the S3 spoofing hole
//   3  server.js stops using the constant              -> the WIRE case
//   4  TRUST_PROXY = 'uniquelocal' (loopback dropped)  -> the half-value case
//
// CASE 3 IS THE ONE THIS FILE IS REALLY FOR. Cases 1, 2 and 4 damage a constant
// the suite imports directly, so of course the suite notices. Case 3 leaves that
// constant perfect and severs it from the server — which is the state the
// repository was actually in, the value having been a literal inside a config
// object — and only the assertions that drive the real app can see it. If case 3
// ever survives, the second half of the suite has stopped being a join and the
// first half is asserting about a value nothing uses.
//
// Nothing in the working tree is touched: the repository is copied to a temp
// directory, one file is edited there, and the copy's suite is run.
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

/* The suite reaches for its subjects relative to its own location, so a copy of
 * it runs the copied, damaged code. `node_modules/` and `engine/` are linked
 * rather than copied — they are large, and nothing here damages them. */
const TREE = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-trust-proxy-'));
for (const dir of ['scripts', 'src', 'views', 'public']) {
  cpSync(path.join(ROOT, dir), path.join(TREE, dir), { recursive: true });
}
for (const dir of ['node_modules', 'engine']) {
  const from = path.join(ROOT, dir), to = path.join(TREE, dir);
  try { symlinkSync(from, to, 'junction'); }
  catch { cpSync(from, to, { recursive: true }); }
}
writeFileSync(path.join(TREE, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));

function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [path.join(TREE, 'scripts', 'test-trust-proxy.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** Apply one anchored edit in the scratch tree, run the suite, restore. */
function mutate({ label, file, find, to, expect }) {
  const p = path.join(TREE, file);
  const before = readFileSync(p, 'utf8');
  const n = before.split(find).length - 1;
  // A mutation whose anchor no longer matches is a STALE harness, not a pass.
  if (n !== 1) { fail(`${label}: anchor matched ${n} times in ${file}, not once — the mutation did not do what it says`); return; }
  writeFileSync(p, before.replace(find, to));
  const r = run();
  writeFileSync(p, before);
  if (r.status === 0) { fail(`${label}: SURVIVED — the suite passed against broken code`); return; }
  // "it went red" and "it went red for this reason" are different claims, and
  // only the second one says the assertion you think is guarding this is.
  if (!r.out.includes(expect)) { fail(`${label}: went red, but not on the assertion that names it (wanted "${expect}")`); return; }
  ok(`${label} -> "${expect}"`);
}

console.log('control — the tree as committed:');
{
  const r = run();
  if (r.status === 0) ok('test-trust-proxy.mjs passes unmutated');
  else fail(`the suite is ALREADY red — every case below would be meaningless:\n${r.out}`);
}

console.log('\nthe value:');
mutate({
  label: "1  TRUST_PROXY = 1 (the bug verbatim: Fastify trusts nothing)",
  file: 'src/http/trustProxy.js',
  find: "export const TRUST_PROXY = 'loopback, uniquelocal';",
  to: 'export const TRUST_PROXY = 1;',
  expect: 'trustProxy is not a number',
});
mutate({
  label: '2  TRUST_PROXY = true (the S3 spoofing hole reopened)',
  file: 'src/http/trustProxy.js',
  find: "export const TRUST_PROXY = 'loopback, uniquelocal';",
  to: 'export const TRUST_PROXY = true;',
  expect: 'trustProxy is not `true`',
});
mutate({
  label: "4  TRUST_PROXY = 'uniquelocal' (one half of the value dropped)",
  file: 'src/http/trustProxy.js',
  find: "export const TRUST_PROXY = 'loopback, uniquelocal';",
  to: "export const TRUST_PROXY = 'uniquelocal';",
  expect: 'a loopback peer is trusted too',
});

console.log('\nthe wire between the value and the server:');
mutate({
  label: '3  server.js goes back to a literal and the constant is orphaned',
  file: 'src/server.js',
  find: '  trustProxy: TRUST_PROXY,',
  to: '  trustProxy: 1,',
  expect: 'a DIFFERENT visitor still gets through',
});

console.log(failures ? `\n${failures} case(s) failed` : '\nevery case went red for its own reason');
process.exit(failures ? 1 : 0);
