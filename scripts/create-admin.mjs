// Create exactly one admin user on a clean database — nothing else.
//
// scripts/seed-demo.mjs is the only other code path that creates an admin, and
// it also invents three demo organisations and seeds maps to them. That is
// right for local development and wrong for a fresh live database (GO-LIVE.md
// §2.2, §3 "Content on the live site"). This script does the one thing a
// first deploy actually needs: one admin, so someone can sign in.
//
//   node scripts/create-admin.mjs --email you@example.com [--name "Your Name"] [--dry-run]
//
// Safe to re-run: an existing user with that email is reported, not duplicated
// or promoted — use scripts/seed-demo.mjs's ensureUser pattern by hand (or the
// admin console) if you need to change an existing user's role.
//
// It writes to the live store, so it takes the REMOTE vocabulary of
// docs/CONVENTIONS.md through cli.mjs's confirm(): the default is to do it, and
// `--dry-run` says what it would do and writes no row (buses-data OA-228).
// Importing src/db/index.js still opens and migrates the database, as every
// script that reads it does; what --dry-run promises is that no USER row is
// written, and test-create-admin.mjs proves that by reading the table back.

import { getUserByEmail, insertUser } from '../src/db/index.js';
import { arg, confirm, die } from './lib/cli.mjs';


const email = arg('email');
if (!email) die('✗ --email is required, e.g. node scripts/create-admin.mjs --email you@example.com');
const name = arg('name') || null;
const { dryRun } = confirm('remote');

const existing = getUserByEmail(email);
if (existing) {
  console.log(`· user already exists: ${existing.email} (role: ${existing.role}) — no change made`);
  process.exit(0);
}

if (dryRun) {
  console.log(`· would create admin: ${email}${name ? ` (${name})` : ''} — --dry-run, nothing written`);
  process.exit(0);
}

const id = insertUser({ email, role: 'admin', customer_id: null, name });
console.log(`· created admin: ${email} (#${id})`);
