// Deploy the Caddyfile to the VPS and prove what it says actually arrived.
//
// Two things are read back off the live site: the security header set, and — as
// of 2026-08-31 — that www answers 308 to the apex (buses-data OA-172). A THIRD
// thing in that file cannot be read back this way at all: the access log's query
// filter (OA-006) shows up only in the log, so this script prints the two
// commands that read it on the host rather than pretending to have checked it.
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
import { primaryHost, siteBlocks } from './lib/caddyfile.mjs';

const HOST = process.env.DEPLOY_HOST;
const KEY = process.env.DEPLOY_SSH_KEY;
const argv = process.argv.slice(2);
const printOnly = argv.includes('--print');
const checkOnly = argv.includes('--check');

// The site address, read out of the file itself so the verification below cannot
// drift from what was deployed. This was one regex here until 2026-08-31 — "the
// first non-comment line ending in `{`" — and the Caddyfile then gained a
// `(access_log)` snippet definition above the site block, which is exactly that
// shape. It would have called the public hostname `(access_log)`. The parse is
// now scripts/lib/caddyfile.mjs so a test can drive it; see that module's header.
const caddyfile = readFileSync('Caddyfile', 'utf8');
const siteHost = primaryHost(caddyfile);
if (!siteHost) { console.error('Could not find a site block in ./Caddyfile.'); process.exit(1); }

// The name that must REDIRECT to the site, if the file declares one (buses-data
// OA-172). Read from the file rather than hard-coded, for the same reason as
// siteHost: a hostname written twice is a hostname that can disagree with itself.
const redirectHost = siteBlocks(caddyfile)
  .filter((b) => b.body.some((l) => l.startsWith('redir ')))
  .flatMap((b) => b.addresses)[0] || null;

const WANT = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];

// This script runs on the LAPTOP, which is Windows, and the redirect check below
// needs somewhere to throw a response body away. `curl -o /dev/null` there does
// not fail loudly — it exits 23, CURLE_WRITE_ERROR, which reads exactly like the
// site being unreachable. Measured on 2026-08-31, when it did precisely that.
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

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
  }
  if (!verifyRedirect()) ok = false;
  if (ok) {
    console.log('\nOK - every header in the block is present on the live site.');
    console.log('Still worth opening /, /maps, a /m/<slug> page and a signed-in /app and');
    console.log('confirming the browser console shows no "Refused to ..." lines: headers');
    console.log('arriving and the CSP not breaking the pages are two different questions.');
    console.log('');
    console.log('ONE THING IN THIS FILE THIS SCRIPT CANNOT SEE: the access log filter');
    console.log('(OA-006). A header shows up in a response; a log filter shows up only in');
    console.log('the log. Visit https://' + siteHost + '/maps?q=ely in a browser, then:');
    console.log('    npm run ssh');
    console.log('    sudo tail -2 /var/log/caddy/busmaps.access.log');
    console.log('The line must read q=REDACTED. If it reads q=ely the filter is not live.');
  }
  return ok;
}

// The www -> apex redirect (OA-172). Its own request, because a 308 has no body
// and none of the headers above: asking for it inside the header read would have
// meant reading the apex twice and the redirect never.
function verifyRedirect() {
  if (!redirectHost) {
    console.log('\nNo redirecting site block in ./Caddyfile - nothing to check.');
    return true;
  }
  console.log(`\nReading https://${redirectHost}/ ...`);
  const r = spawnSync('curl', ['-s', '-o', NULL_DEVICE, '-w', '%{http_code} %{redirect_url}', `https://${redirectHost}/`], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('  curl failed:', r.stderr || r.status); return false; }
  const [code, target] = String(r.stdout).trim().split(/\s+/);
  const want = `https://${siteHost}/`;
  const good = code === '308' && target === want;
  console.log(`  ${good ? 'yes' : 'NO '}  ${code} ${target || '(no Location)'}`);
  if (!good) {
    console.error(`\nFAILED: https://${redirectHost}/ should answer 308 with ${want}.`);
    console.error('A 200 here means both names still serve the site and neither is');
    console.error('canonical - which is the state this block was added to end.');
  }
  return good;
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
  if (redirectHost) console.log(`curl -s -o ${NULL_DEVICE} -w "%{http_code} %{redirect_url}\\n" https://${redirectHost}/   (expect: 308 https://${siteHost}/)`);
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
