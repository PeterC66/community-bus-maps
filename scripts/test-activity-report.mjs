#!/usr/bin/env node
// scripts/activity-report.mjs — who used the portal and what they did.
//
//   node scripts/test-activity-report.mjs     (or: npm run test:activity-report)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). No flags and
// no placeholders. It builds a throwaway DATA_DIR in the system temp directory
// and never touches the real portal data.
//
// What is asserted, and why each one could go wrong silently:
//   * a USED magic link is a sign-in and an unused one is "never signed in" —
//     the report reads `magic_link`, not `session`, because sessions are purged
//     on expiry, and a regression to the session table would still print;
//   * the window cuts: an action older than --days is left out;
//   * `cli:*` actors are listed apart from people, not as a person;
//   * someone with no account who applied is listed under their address;
//   * a wrong flag exits 2 and a missing database exits 3 (docs/CONVENTIONS.md).

import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-activity-'));
process.env.DATA_DIR = scratch;
const { db } = await import('../src/db/index.js');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const run = (...args) => spawnSync(process.execPath, ['--no-warnings', 'scripts/activity-report.mjs', ...args],
  { encoding: 'utf8', env: { ...process.env, DATA_DIR: scratch } });

const cust = db.prepare("INSERT INTO customer (name, type) VALUES ('Test Association', 'other')").run().lastInsertRowid;
db.prepare("INSERT INTO user (email, name, role, customer_id) VALUES ('ed@example.org', 'Edna Editor', 'editor', ?)").run(cust);
db.prepare("INSERT INTO user (email, name, role, customer_id) VALUES ('quiet@example.org', 'Quentin Quiet', 'editor', ?)").run(cust);
db.prepare("INSERT INTO user (email, name, role) VALUES ('adv@example.org', 'Ada Adviser', 'adviser')").run();
const link = db.prepare(`INSERT INTO magic_link (token, email, created_at, expires_at, used_at)
  VALUES (?, ?, datetime('now', ?), datetime('now'), ?)`);
link.run('t1', 'ed@example.org', '-2 days', '2026-09-20 10:00:00');
link.run('t2', 'adv@example.org', '-3 days', null);
const audit = db.prepare(`INSERT INTO audit_log (created_at, actor_email, action, detail_json)
  VALUES (datetime('now', ?), ?, ?, '{}')`);
audit.run('-1 days', 'ed@example.org', 'version.submit');
audit.run('-1 days', 'ed@example.org', 'version.submit');
audit.run('-60 days', 'ed@example.org', 'version.publish');
audit.run('-1 days', 'cli:delete-map', 'map.delete');
db.prepare(`INSERT INTO application (org_name, org_type, contact_name, email)
  VALUES ('Nobody Yet', 'other', 'Nora New', 'nora@example.org')`).run();

console.log('\nthe report');
const r = run();
check('exits 0', r.status === 0, r.stderr);
const out = r.stdout;
const block = (email) => out.split('\n\n').find((b) => b.includes(`<${email}>`)) || '';
check('a used link is a sign-in', /1 sent, 1 used, last sign-in 2026-09-20/.test(block('ed@example.org')), block('ed@example.org'));
check('an unused link is "never signed in"', /never signed in/.test(block('adv@example.org')), block('adv@example.org'));
check('actions in the window are counted', /version\.submit ×2/.test(block('ed@example.org')));
check('an action older than --days is left out', !/version\.publish/.test(block('ed@example.org')));
check('--days widens the window', /version\.publish ×1/.test(run('--days', '90').stdout));
check('cli actors are not people', !out.includes('<cli:') && /Command line and system:\n {2}cli:delete-map map\.delete ×1/.test(out));
check('an applicant with no account is listed', /<nora@example\.org> — no account\n {2}applied .*Nobody Yet/.test(out));
check('an account with no activity is named as quiet', /No activity in this window: quiet@example\.org/.test(out));

console.log('\n--json');
const j = JSON.parse(run('--json').stdout);
check('carries the same people', j.people.map((p) => p.email).sort().join() === 'adv@example.org,ed@example.org,nora@example.org');

console.log('\nexit codes');
check('an unknown flag exits 2', run('--bogus').status === 2);
check('a bad --days exits 2', run('--days', '0').status === 2);
const missing = spawnSync(process.execPath, ['--no-warnings', 'scripts/activity-report.mjs'],
  { encoding: 'utf8', env: { ...process.env, DATA_DIR: path.join(scratch, 'absent') } });
check('no database exits 3', missing.status === 3, missing.stderr);

console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
