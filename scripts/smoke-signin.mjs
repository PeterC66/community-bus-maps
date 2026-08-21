#!/usr/bin/env node
// smoke-signin.mjs — prove, after a deploy, that a real sign-in email actually
// left the building (technical-audit_2026-08-19 O4).
//
// WHY THIS EXISTS. Sign-in is the only door into the portal. Until 2026-08-20
// `POST /api/auth/request` answered "If that address is registered, a sign-in
// link has been sent" whether or not one had been: the console fallback keyed on
// EMAIL_PROVIDER being UNSET, so a configured provider that threw — bad key,
// outage, suspended domain — was logged and swallowed, and the caller was told
// to check their inbox. `/health` said `ok` throughout. The failure was
// invisible from every angle except the server log, and nobody reads the server
// log at the moment a stranger fails to sign in.
//
// The route is honest now, and `/health?deep=1` checks the CONFIGURATION. What
// neither can tell you is whether the provider ACCEPTS a message today, because
// that needs a message to be sent. Hence this: it sends one, to the operator's
// own address, and reads the outcome back off the server's log rather than off
// the HTTP response — which is deliberately identical whether the address is
// registered or not, and so cannot be the evidence.
//
// RUN IT FROM THE LAPTOP, in the repo root (C:\\Claude\\community-bus-maps):
//
//     npm run smoke:signin
//
// `npm run deploy` runs it as its last step. Nothing about it is destructive:
// the only side effect is one email to ADMIN_EMAIL and one short-lived magic
// link, which expires unused.
//
// CONFIG (all from .env, same as deploy.mjs):
//   DEPLOY_HOST      user@host for ssh
//   DEPLOY_SSH_KEY   private key path (optional)
//   DEPLOY_APP_DIR   directory on the host holding compose.yaml
//   ADMIN_EMAIL      the address to send the test link to
//
// FLAGS:
//   --email <addr>   send to this address instead of ADMIN_EMAIL
//   --quiet          suppress the log excerpt on success

import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const HOST = process.env.DEPLOY_HOST;
const SSH_KEY = process.env.DEPLOY_SSH_KEY;
const APP_DIR = process.env.DEPLOY_APP_DIR;
const EMAIL = flag('email') || process.env.ADMIN_EMAIL;

if (!HOST || !APP_DIR) {
  console.error('✗ DEPLOY_HOST and DEPLOY_APP_DIR must be set (env, or in .env).');
  process.exit(1);
}
if (!EMAIL) {
  console.error('✗ No address to test. Set ADMIN_EMAIL in .env, or pass --email <addr>.');
  process.exit(1);
}

const SSH = ['ssh', ...(SSH_KEY ? ['-i', SSH_KEY] : []), '-o', 'BatchMode=yes', HOST];

function ssh(remoteCmd, { echo = true } = {}) {
  if (echo) console.log(`$ ssh ${HOST} ${remoteCmd}`);
  const r = spawnSync(SSH[0], [...SSH.slice(1), remoteCmd], { encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

console.log('== sign-in smoke test ==');
console.log(`  host  : ${HOST}`);
console.log(`  to    : ${EMAIL}`);
console.log('');

// 1. Ask the running service for a link. `-w %{http_code}` rather than `-f`
//    because a 503 is a RESULT here, not a transport failure: it is the route
//    saying it knows it cannot send, which is the honest failure this change
//    introduced and is worth reporting differently from a crash.
const body = JSON.stringify({ email: EMAIL });
const post = ssh(
  `curl -sS -o /tmp/smoke-signin.json -w '%{http_code}' -X POST localhost:5180/api/auth/request `
  + `-H 'content-type: application/json' -d '${body.replace(/'/g, "'\\''")}'`,
);
const code = Number(post.stdout);
const payload = ssh('cat /tmp/smoke-signin.json; rm -f /tmp/smoke-signin.json', { echo: false }).stdout;

if (code === 503) {
  console.error(`\n✗ the service refused to send: HTTP 503\n  ${payload}`);
  console.error('  This is the O4 guard firing. Either EMAIL_PROVIDER/RESEND_API_KEY are wrong on the host,');
  console.error('  or the provider has failed repeatedly. Check /health?deep=1 -> checks.email, and the logs.');
  process.exit(1);
}
if (code !== 200) {
  console.error(`\n✗ unexpected response: HTTP ${code}\n  ${payload}`);
  process.exit(1);
}
console.log(`   HTTP 200 — ${payload}`);

// 2. The response says the same thing for a registered and an unregistered
//    address, on purpose, so it is NOT the evidence. The server log is.
//
//    `--since 60s` keeps this from matching a send that happened earlier today.
console.log('\n-- reading the server log for what actually happened');
const logs = ssh(`cd ${APP_DIR} && docker compose logs --since 60s --no-log-prefix portal 2>/dev/null | tail -100`);
if (logs.status !== 0) {
  console.error('✗ could not read the container log — cannot confirm what happened. Treat this as a failure.');
  process.exit(1);
}

const lines = logs.stdout.split('\n');
const sent = lines.filter((l) => l.includes('magic link emailed'));
const failed = lines.filter((l) => l.includes('magic link email failed to send'));
const refused = lines.filter((l) => l.includes('sign-in refused'));
const console_ = lines.filter((l) => l.includes('magic link issued (see console)'));

if (failed.length) {
  console.error('\n✗ the provider threw. Sign-in is broken on this deployment.');
  for (const l of failed.slice(-3)) console.error(`   ${l}`);
  process.exit(1);
}
if (refused.length) {
  console.error('\n✗ the route refused to attempt a send (see the log lines below).');
  for (const l of refused.slice(-3)) console.error(`   ${l}`);
  process.exit(1);
}
if (console_.length) {
  console.error('\n✗ the link was printed to the SERVER CONSOLE, not emailed — EMAIL_PROVIDER is unset on the host.');
  console.error('  Nobody outside the box can sign in to this deployment.');
  process.exit(1);
}
if (!sent.length) {
  console.error('\n✗ no "magic link emailed" line in the last 60s of log.');
  console.error(`  Either ${EMAIL} is not a registered, active user (so no send was attempted — try --email with one that is),`);
  console.error('  or logging has changed shape and this check needs updating. Either way it is not proof of a send.');
  process.exit(1);
}

if (!has('quiet')) for (const l of sent.slice(-3)) console.log(`   ${l}`);
console.log(`\n✓ a sign-in link was accepted by the email provider for ${EMAIL}.`);
console.log('  Check that inbox: provider-accepted is not the same as inbox-delivered, and only you can close that gap.');
