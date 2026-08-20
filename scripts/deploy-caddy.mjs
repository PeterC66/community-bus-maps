// Deploy the Caddyfile to the VPS and prove the headers actually arrived.
//
// Caddy runs on the HOST, outside Docker, so `npm run deploy` and
// `deliver-map.mjs` do not touch it -- the Caddyfile is deployed by this script
// and by nothing else. That separation is exactly how the security headers came
// to be merged, deployed and still absent from the live site on 2026-08-20.
//
// Run FROM THE REPO ROOT on the laptop (C:\Claude\community-bus-maps):
//
//   npm run deploy:caddy            copy up, validate, reload, then verify
//   npm run deploy:caddy -- --check verify the live headers only, change nothing
//   npm run deploy:caddy -- --print show what it would run, connect to nothing
//
// Reads DEPLOY_HOST and DEPLOY_SSH_KEY from .env, so there is no hostname or key
// path to look up. The public hostname is read out of the Caddyfile itself, so
// the verification cannot drift from what was deployed.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HOST = process.env.DEPLOY_HOST;
const KEY = process.env.DEPLOY_SSH_KEY;
const argv = process.argv.slice(2);
const printOnly = argv.includes('--print');
const checkOnly = argv.includes('--check');

// The site address is the first non-comment line ending in `{`.
const caddyfile = readFileSync('Caddyfile', 'utf8');
const siteLine = caddyfile.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && l.trim().endsWith('{'));
const siteHost = siteLine ? siteLine.replace('{', '').split(',')[0].trim() : null;
if (!siteHost) { console.error('Could not find the site address in ./Caddyfile.'); process.exit(1); }

const WANT = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];

function verify() {
  console.log(`\nReading the live headers from https://${siteHost}/ ...`);
  const r = spawnSync('curl', ['-sI', `https://${siteHost}/`], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('curl failed:', r.stderr || r.status); return false; }
  const got = r.stdout.toLowerCase();
  let ok = true;
  for (const h of WANT) {
    const present = got.includes(h + ':');
    console.log(`  ${present ? 'yes' : 'NO '}  ${h}`);
    if (!present) ok = false;
  }
  if (!ok) {
    console.error('\nFAILED: the live site is NOT sending the full header set.');
    console.error('A reload that silently kept the old config looks exactly like success,');
    console.error('so this check is the only thing that tells them apart. Re-run without');
    console.error('--check to deploy, and read any `caddy validate` error before retrying.');
  } else {
    console.log('\nOK - every header in the block is present on the live site.');
    console.log('Still worth opening /, /maps, a /m/<slug> page and a signed-in /app and');
    console.log('confirming the browser console shows no "Refused to ..." lines: headers');
    console.log('arriving and the CSP not breaking the pages are two different questions.');
  }
  return ok;
}

if (checkOnly) process.exit(verify() ? 0 : 1);

if (!HOST) {
  console.error('DEPLOY_HOST must be set in .env (see .env.example), of the form user@host.');
  process.exit(1);
}

// validate BEFORE reload: a reload on a malformed file leaves the old config
// running on some Caddy versions and fails the site on others, and finding out
// which by experiment is not a thing to do to a live site.
const remote = 'sudo cp ~/Caddyfile /etc/caddy/Caddyfile'
  + ' && sudo caddy validate --config /etc/caddy/Caddyfile'
  + ' && sudo systemctl reload caddy';
const scpArgs = [...(KEY ? ['-i', KEY] : []), 'Caddyfile', `${HOST}:`];
const sshArgs = [...(KEY ? ['-i', KEY] : []), '-t', HOST, remote];

if (printOnly) {
  console.log('scp ' + scpArgs.join(' '));
  console.log('ssh ' + sshArgs.slice(0, -1).join(' ') + ` "${remote}"`);
  console.log(`curl -sI https://${siteHost}/   (then check for: ${WANT.join(', ')})`);
  process.exit(0);
}

console.log(`1. scp Caddyfile -> ${HOST}:~/Caddyfile`);
let r = spawnSync('scp', scpArgs, { stdio: 'inherit' });
if (r.status !== 0) { console.error('scp failed - nothing on the host has changed.'); process.exit(1); }

console.log('\n2. install, validate, reload (sudo on the host)');
r = spawnSync('ssh', sshArgs, { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\nFAILED on the host. If `caddy validate` rejected the file, the reload did');
  console.error('NOT run and the live config is untouched - fix the Caddyfile and re-run.');
  process.exit(1);
}

console.log('\n3. verify');
process.exit(verify() ? 0 : 1);
