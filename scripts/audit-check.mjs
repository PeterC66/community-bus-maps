// Fails on any high/critical advisory in the PRODUCTION dependency tree that is
// not explicitly deferred in scripts/audit-allowlist.json, and fails just as
// loudly when a deferral's `until` date has passed.
//
// Why not plain `npm audit --audit-level=high`: on the day this was written the
// tree already carried two known-and-judged advisories (sharp, @fastify/static),
// so a bare audit job would have been red from its first run. A gate that is red
// on day one gets muted within a week, and technical-audit_2026-08-19 V4 already
// names gate fatigue as a live problem in this project. This version starts
// GREEN, goes red the moment something NEW appears, and goes red again the day a
// deferral expires - so "we know about it" has a shelf life.
//
// Run from the repo root:
//   node scripts/audit-check.mjs
// Exit 0 = nothing new and nothing expired. Exit 1 = read the output.
// --json prints the raw npm audit report instead of the summary (debugging).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST = path.join(HERE, 'audit-allowlist.json');
const FAIL_ON = new Set(['high', 'critical']);
const today = new Date().toISOString().slice(0, 10);

// npm audit exits non-zero when it finds anything, so its status is not an
// error signal here - only unparseable output is.
// Windows needs a shell: since the CVE-2024-27980 mitigation Node refuses to
// spawn a .cmd shim directly (EINVAL), and npm on Windows is npm.cmd. Passed as
// ONE command string rather than a command plus an args array, because DEP0190
// warns about the latter - there is no interpolation here, every character is a
// literal in this file. CI is Linux and takes the plain argv path.
const CMD = ['audit', '--omit=dev', '--json'];
const r = process.platform === 'win32'
  ? spawnSync(`npm ${CMD.join(' ')}`, { encoding: 'utf8', shell: true })
  : spawnSync('npm', CMD, { encoding: 'utf8' });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error('Could not parse `npm audit --json`. Raw output follows:');
  console.error(r.stdout || '(empty)');
  console.error(r.stderr || '');
  process.exit(1);
}
if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8')).allow || [];
const allowByModule = new Map(allow.map((a) => [a.module, a]));

const problems = [];
const deferred = [];

for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
  if (!FAIL_ON.has(v.severity)) continue;
  const ids = (v.via || [])
    .filter((x) => typeof x === 'object' && x.url)
    .map((x) => x.url.split('/').pop());
  const entry = allowByModule.get(name);
  if (!entry) { problems.push({ name, severity: v.severity, ids, why: 'not in the allowlist' }); continue; }
  const unlisted = ids.filter((id) => !(entry.advisories || []).includes(id));
  if (unlisted.length) {
    problems.push({ name, severity: v.severity, ids: unlisted, why: `new advisory for an already-deferred module (allowlisted: ${(entry.advisories || []).join(', ')})` });
    continue;
  }
  if (entry.until && entry.until < today) {
    problems.push({ name, severity: v.severity, ids, why: `deferral EXPIRED on ${entry.until} - renew it deliberately or do the work: ${entry.removeBy || '(no removeBy recorded)'}` });
    continue;
  }
  deferred.push({ name, until: entry.until, ids });
}

const counts = (report.metadata && report.metadata.vulnerabilities) || {};
console.log(`npm audit --omit=dev: ${counts.critical || 0} critical, ${counts.high || 0} high, ${counts.moderate || 0} moderate, ${counts.low || 0} low`);

if (deferred.length) {
  console.log('\nKnown and deferred (see scripts/audit-allowlist.json):');
  for (const d of deferred) console.log(`  - ${d.name}  until ${d.until}  [${d.ids.join(', ')}]`);
}

if (problems.length) {
  console.error('\nFAILED - high/critical advisories that are not covered by a live deferral:\n');
  for (const p of problems) {
    console.error(`  ${p.name}  (${p.severity})`);
    console.error(`    advisories: ${p.ids.join(', ') || '(none reported)'}`);
    console.error(`    ${p.why}\n`);
  }
  console.error('Fix it, or add a dated entry to scripts/audit-allowlist.json saying why not and by when.');
  process.exit(1);
}

console.log('\nOK - nothing new, and no deferral has expired.');
