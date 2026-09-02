// Answer a data subject's request — what do you hold about me, and delete it.
//
//   node scripts/personal-data.mjs --show <email>
//   node scripts/personal-data.mjs --erase <email>            # dry run
//   node scripts/personal-data.mjs --erase <email> --yes      # actually delete
//   node scripts/personal-data.mjs --retention                # what the purge would take
//   node scripts/personal-data.mjs --retention --yes          # run the purge now
//
// RUN IT FROM the repo root on whichever box holds the database — on the laptop
// that is C:\Claude\community-bus-maps against a local DATA_DIR, and on the VPS
// it is `docker compose exec portal node scripts/personal-data.mjs …`. The
// runbook around it, including the backups and the laptop mirror, is
// docs/DEPLOY.md §5b; this script is only the database half.
//
// WHY A SCRIPT AND NOT AN ADMIN BUTTON (technical-audit_2026-08-25 N8). An
// erasure is irreversible, rare, and has to be recorded outside the system it
// deletes from — the ops folder's incident log, not an audit row in the database
// the person just asked you to erase them from. A screen button invites it to be
// done quickly; a command with a dry run that is the DEFAULT invites reading the
// list first. Nothing here deletes without --yes.
//
// WHAT IT DOES NOT REACH, and the runbook says so too: backups. An erasure that
// stops at the live database is not one, because a restore would bring the
// person back. The window is the backup retention — 14 days on the VPS, 90 on
// the laptop mirror since 2026-08-25 — after which the last copy holding them
// has rotated out. Record the date that falls due; do not try to rewrite an
// encrypted backup in place.

import { retentionDue, purgeExpiredPersonalData, personalDataFor, erasePersonalDataFor } from '../src/db/index.js';
import { arg, has } from './lib/cli.mjs';
// `valueOf` was this file's name for it, defaulting to the empty string.
const valueOf = (f) => arg(f, '');

const argv = process.argv.slice(2);
const yes = has('yes');

const usage = () => {
  console.log(`Usage:
  node scripts/personal-data.mjs --show <email>
  node scripts/personal-data.mjs --erase <email> [--yes]
  node scripts/personal-data.mjs --retention [--yes]`);
  process.exit(1);
};

if (has('retention')) {
  const due = retentionDue();
  console.log(`Retention window: ${due.months} months.`);
  console.log(`  applications past it (excluding those belonging to a live customer): ${due.applications}`);
  console.log(`  messages past it:                                                    ${due.messages}`);
  if (!yes) {
    console.log('\nDry run — nothing deleted. Add --yes to purge.');
    process.exit(0);
  }
  const gone = purgeExpiredPersonalData();
  console.log(`\n✓ purged ${gone.applications} application(s) and ${gone.messages} message(s).`);
  console.log('  The daily job in the running server does this too; this is for running it on demand.');
  process.exit(0);
}

if (has('show') || has('erase')) {
  const email = valueOf('show') || valueOf('erase');
  if (!email) usage();
  const held = personalDataFor(email);

  console.log(`\nHeld for ${held.email}:`);
  console.log(`  applications: ${held.applications.length}`);
  for (const a of held.applications) {
    console.log(`    #${a.id}  ${a.created_at}  ${a.org_name} (${a.status})${a.customer_id ? `  → customer ${a.customer_id}` : ''}`);
  }
  console.log(`  messages:     ${held.messages.length}`);
  for (const m of held.messages) console.log(`    #${m.id}  ${m.created_at}  ${m.kind} (${m.status})`);
  console.log(`  user accounts: ${held.users.length}`);
  for (const u of held.users) console.log(`    #${u.id}  ${u.email}  ${u.role}/${u.status}${u.customer_id ? `  customer ${u.customer_id}` : ''}`);

  if (has('show')) {
    console.log('\n(Read-only. Use --erase to delete the applications and messages.)');
    process.exit(0);
  }

  if (!held.applications.length && !held.messages.length) {
    console.log('\nNothing to erase in application/message.');
    if (held.users.length) console.log('There IS a user account — see docs/DEPLOY.md §5b for how to handle it.');
    process.exit(0);
  }

  if (!yes) {
    console.log(`\nDry run — nothing deleted. Add --yes to erase the ${held.applications.length} application(s) and ${held.messages.length} message(s) above.`);
    process.exit(0);
  }

  const gone = erasePersonalDataFor(email);
  console.log(`\n✓ erased ${gone.applications} application(s) and ${gone.messages} message(s) for ${gone.email}.`);
  if (held.users.length) {
    console.log(`! ${held.users.length} user account(s) were NOT touched — deleting one orphans the audit trail.`);
    console.log('  Disable the account and revoke its sessions instead: docs/DEPLOY.md §5b.');
  }
  console.log('\nStill to do, and neither is automatic:');
  console.log('  1. Note the date the last backup holding them rotates out (14 days VPS / 90 days laptop).');
  console.log('  2. Record the request and what you did in community-bus-maps-ops/P3-incident-log.md.');
  process.exit(0);
}

usage();
