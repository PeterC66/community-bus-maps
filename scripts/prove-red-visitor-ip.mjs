// prove-red-visitor-ip.mjs — falsify the visitor-address mask (buses-data OA-086 phase 1).
//
// Run from the repository root (`C:\Claude\community-bus-maps`, no placeholders):
//     npm run test:prove-red-visitor-ip
//
// WHY. /legal.html now tells the public "your IP address is masked before it
// reaches a log". That is a promise about two files that never see each other —
// src/public/logRedaction.js for the app's own log, and ./Caddyfile for the
// access log Caddy writes in front of it — and it is kept by assertions in two
// suites. Every failure this guards against is SILENT: nothing 500s, no page
// breaks, no header changes, and a log line holding a full address looks exactly
// like one holding a masked address unless you read the last octet. So the only
// way to know the assertions bite is to break the code on purpose and watch.
//
// Nothing under scripts/ or src/ is touched. The whole repository is copied to a
// temp directory, one file is edited there, and the copy's suite is run.
//
//   0  control: the tree unmutated                  -> both suites exit 0
//   1  maskIp returns its argument                  -> the plain IPv4 case
//   2  maskIp masks IPv4 only, passing IPv6 through -> the IPv6 case
//   3  maskIp passes unparseable values through     -> the `unknown` case
//   4  the serialiser stops calling maskIp          -> the WIRE case
//   5  the Caddyfile masks remote_ip only           -> the second-field case
//   6  the Caddyfile uses the conventional /48      -> the JOIN case
//   7  IP_MASK_BITS moves and the Caddyfile does not -> the JOIN case, other way
//   8  roll_keep_for is dropped                     -> the retention case
//
// CASES 4, 5 AND 7 ARE THE ONES THIS FILE IS REALLY FOR, and none of them is
// hypothetical. Case 4 is the shape that existed until 2026-09-06: the serialiser
// was written inline in a Fastify config object, so every assertion in the
// repository stopped one call short of the object that reaches the log — a
// mutation there would have broken nothing that any test could see. Case 5 is the
// natural way to write this change wrong, because Caddy has logged the address
// under TWO names since v2.7 and one masked field reads almost exactly like two.
// Case 7 is the failure that actually happens to a rule kept in two places: the
// half somebody is editing moves and the half they are not stays.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-visitor-ip-'));
const TREE = path.join(scratch, 'repo');
cpSync(ROOT, TREE, {
  recursive: true,
  // By SEGMENT, not by prefix — the same filter prove-red-portal-lib.mjs arrived
  // at after a `git worktree` under `.claude/` carried a node_modules symlink
  // that cpSync threw EPERM on, making the harness pass or fail according to
  // whether another session happened to have a worktree open.
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    if (!rel) return true;
    const segs = rel.split(/[\\/]/);
    if (segs.some((seg) => seg === 'node_modules' || seg === '.git' || seg === '.claude')) return false;
    return !['data', 'backups'].includes(segs[0]);
  },
});

const SUITES = { indexing: 'test-indexing.mjs', caddyfile: 'test-caddyfile.mjs' };
const run = (suite) => spawnSync(process.execPath, [path.join(TREE, 'scripts', SUITES[suite])], { cwd: TREE, encoding: 'utf8' });

/** Apply one anchored edit in the scratch tree, run the named suite, restore. */
function mutate({ label, file, find, to, suite, expect }) {
  const p = path.join(TREE, file);
  const before = readFileSync(p, 'utf8');
  const n = before.split(find).length - 1;
  if (n !== 1) { fail(`${label}: anchor matched ${n} times in ${file}, not once — the mutation did not do what it says`); return; }
  writeFileSync(p, before.replace(find, to));
  const r = run(suite);
  writeFileSync(p, before);
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) { fail(`${label}: SURVIVED — ${SUITES[suite]} passed against broken code`); return; }
  if (!out.includes(expect)) {
    // "it went red" and "it went red for this reason" are different claims, and
    // only the second one says the assertion you think is guarding this is.
    fail(`${label}: went red, but not on the assertion that names it (wanted "${expect}")`);
    return;
  }
  ok(`${label} -> "${expect}"`);
}

console.log('control — the tree as committed:');
for (const suite of Object.keys(SUITES)) {
  const r = run(suite);
  if (r.status === 0) ok(`${SUITES[suite]} passes unmutated`);
  else fail(`${SUITES[suite]} is ALREADY red — every case below would be meaningless: ${(r.stdout || '') + (r.stderr || '')}`);
}

console.log('\nthe masker itself:');
mutate({
  label: '1  maskIp returns its argument unchanged',
  file: 'src/public/logRedaction.js',
  find: '  if (typeof ip !== \'string\' || !ip) return \'unknown\';',
  to: '  return ip;\n  if (typeof ip !== \'string\' || !ip) return \'unknown\';',
  suite: 'indexing',
  expect: 'an IPv4 address loses its last octet',
});
mutate({
  label: '2  only IPv4 is masked; IPv6 passes through',
  file: 'src/public/logRedaction.js',
  find: '  if (plain.includes(\':\')) {',
  to: '  if (plain.includes(\':\')) {\n    return plain;',
  suite: 'indexing',
  expect: 'an IPv6 address keeps two groups',
});
mutate({
  label: '3  an unparseable value is passed through instead of dropped',
  file: 'src/public/logRedaction.js',
  find: '  return \'unknown\';\n}',
  to: '  return ip;\n}',
  suite: 'indexing',
  expect: 'a value it cannot parse becomes `unknown`, not itself',
});

console.log('\nthe wire between the masker and the log:');
mutate({
  label: '4  the serialiser stops masking and logs req.ip',
  file: 'src/public/logRedaction.js',
  find: '    remoteAddress: maskIp(req.ip),',
  to: '    remoteAddress: req.ip,',
  suite: 'indexing',
  expect: 'the serialiser masks the address',
});

console.log('\nthe other half of the promise, in the Caddyfile:');
mutate({
  label: '5  client_ip is left in full',
  file: 'Caddyfile',
  find: '\t\t\t\trequest>client_ip ip_mask {\n\t\t\t\t\tipv4 24\n\t\t\t\t\tipv6 32\n\t\t\t\t}\n',
  to: '',
  suite: 'caddyfile',
  expect: 'request>client_ip is masked',
});
mutate({
  label: '6  the Caddyfile adopts the conventional IPv6 /48',
  file: 'Caddyfile',
  find: '\t\t\t\trequest>remote_ip ip_mask {\n\t\t\t\t\tipv4 24\n\t\t\t\t\tipv6 32\n\t\t\t\t}',
  to: '\t\t\t\trequest>remote_ip ip_mask {\n\t\t\t\t\tipv4 24\n\t\t\t\t\tipv6 48\n\t\t\t\t}',
  suite: 'caddyfile',
  expect: 'the Caddy mask matches IP_MASK_BITS',
});
mutate({
  label: '7  IP_MASK_BITS moves and the Caddyfile is left behind',
  file: 'src/public/logRedaction.js',
  find: 'export const IP_MASK_BITS = { ipv4: 24, ipv6: 32 };',
  to: 'export const IP_MASK_BITS = { ipv4: 16, ipv6: 32 };',
  suite: 'caddyfile',
  expect: 'the Caddy mask matches IP_MASK_BITS',
});

console.log('\nthe retention the privacy page promises:');
mutate({
  label: '8  roll_keep_for is dropped, so Caddy\'s 90-day default comes back',
  file: 'Caddyfile',
  find: '\t\t\troll_keep_for 720h\n',
  to: '',
  suite: 'caddyfile',
  expect: 'roll_keep_for is 720h',
});

if (failures) { console.error(`\n${failures} case(s) did not falsify.`); process.exit(1); }
console.log('\nEvery mutation was caught by the assertion that names it.');
