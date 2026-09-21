// Create exactly one admin user on a clean database — nothing else.
//
// scripts/seed-demo.mjs is the only other code path that creates an admin, and
// it also invents three demo organisations and seeds maps to them. That is
// right for local development and wrong for a fresh live database (GO-LIVE.md
// §2.2, §3 "Content on the live site"). This script does the one thing a
// first deploy actually needs: one admin, so someone can sign in.
//
//   node scripts/create-admin.mjs --email you@example.com [--name "Your Name"]
//
// Safe to re-run: an existing user with that email is reported, not duplicated
// or promoted — use scripts/seed-demo.mjs's ensureUser pattern by hand (or the
// admin console) if you need to change an existing user's role.

import { getUserByEmail, insertUser } from '../src/db/index.js';
import { arg } from './lib/cli.mjs';


const email = arg('email');
if (!email) {
  console.error('✗ --email is required, e.g. node scripts/create-admin.mjs --email you@example.com');
  process.exit(1);
}
const name = arg('name') || null;

const existing = getUserByEmail(email);
if (existing) {
  console.log(`· user already exists: ${existing.email} (role: ${existing.role}) — no change made`);
  process.exit(0);
}

const id = insertUser({ email, role: 'admin', customer_id: null, name });
console.log(`· created admin: ${email} (#${id})`);
