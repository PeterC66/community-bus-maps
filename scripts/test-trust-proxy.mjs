// Who may speak for somebody else — buses-data OA-256, as assertions.
//
//   node scripts/test-trust-proxy.mjs        (or: npm run test:trust-proxy)
//
// WHY THIS FILE EXISTS. `trustProxy: 1` sat in src/server.js for a month under a
// comment explaining that `1` trusts one hop — the local Caddy. In Fastify a
// numeric trustProxy trusts NOTHING (lib/request.js fails closed, because a hop
// count cannot validate the immediate peer), so `req.ip` on the live host was
// the Docker bridge gateway for every visitor and the four public POSTs were
// rate-limited in total rather than per person. Nothing could see it: the app's
// log is readable only on the host, CI has no proxy in front of it, and the
// laptop reaches the app with no X-Forwarded-For at all, so the broken value and
// a correct one look identical here unless the peer is controlled.
//
// SO THE PEER IS CONTROLLED. `app.inject({ remoteAddress })` sets the socket
// address, which is the one thing a real local request cannot vary, and that is
// what makes the difference between the values observable off the host.
//
// TWO LEVELS, DELIBERATELY. The first half probes TRUST_PROXY itself — the
// mechanism, including the spoofing property S3 closed and must keep closed. The
// second half drives the REAL app and asserts the CONSEQUENCE: two visitors
// arriving through the proxy get two rate-limit buckets. The first half alone
// would stay green if server.js stopped importing the constant; the second alone
// would not say which spoofing attacks are defeated. Neither covers the other.
//
// Runs against a throwaway DATA_DIR; no network, no email, no real portal data.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-trust-proxy-'));
process.env.DATA_DIR = scratch;
process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
process.env.CBM_NO_LISTEN = '1'; // build the app, bind no socket
process.env.NODE_ENV = 'test';

const { default: Fastify } = await import('fastify');
const { TRUST_PROXY } = await import('../src/http/trustProxy.js');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// The addresses this file argues with. GATEWAY is what the container sees Caddy
// as: compose publishes 127.0.0.1:5180 and Caddy runs on the host, so every
// request arrives from the bridge gateway (measured on the host, 2026-09-06).
const GATEWAY = '172.18.0.1';
const VISITOR = '203.0.113.9';
const OTHER = '198.51.100.4';
const SPOOF = '1.2.3.4';

console.log('\nthe value itself:');

// A number is the bug verbatim, and it is worth its own assertion rather than
// being implied by the behavioural cases below, because the failure it names is
// a READING failure: `1` looks like a careful, minimal choice and is in fact the
// same as `false`. Anyone reaching for a hop count gets told here.
check(
  'trustProxy is not a number — Fastify answers a numeric option with a trust function that returns false',
  typeof TRUST_PROXY !== 'number',
  `TRUST_PROXY is ${JSON.stringify(TRUST_PROXY)}`,
);
check(
  'trustProxy is not `true` — that trusts the whole forwarded chain and takes the value the client sent (technical-audit_2026-08-19 S3)',
  TRUST_PROXY !== true,
);

console.log('\nwhat the configured value does with a controlled peer:');

const probe = Fastify({ logger: false, trustProxy: TRUST_PROXY });
probe.get('/ip', async (req) => ({ ip: req.ip, protocol: req.protocol }));
await probe.ready();

const ask = async (peer, xff, proto) => {
  const headers = {};
  if (xff) headers['x-forwarded-for'] = xff;
  if (proto) headers['x-forwarded-proto'] = proto;
  const res = await probe.inject({ method: 'GET', url: '/ip', remoteAddress: peer, headers });
  return JSON.parse(res.body);
};

eq('through the proxy, req.ip is the address the proxy saw',
  (await ask(GATEWAY, VISITOR)).ip, VISITOR);

// THE SPOOFING CASE, AND IT IS THE REASON THIS IS AN ADDRESS LIST AND NOT `true`.
// Caddy APPENDS the real peer rather than replacing the header, so a client that
// sends its own X-Forwarded-For produces "<spoof>, <real>". proxy-addr walks
// outwards from the socket and stops at the first untrusted address, which is
// the real client — the spoof sits beyond it and is never reached.
eq('a visitor cannot choose its own req.ip by sending X-Forwarded-For',
  (await ask(GATEWAY, `${SPOOF}, ${VISITOR}`)).ip, VISITOR);

// The same attack dressed as a private address. Worth asserting separately
// because `uniquelocal` DOES trust private addresses, so the obvious reading of
// this value says the attack should work. It does not: trust is evaluated by
// position in the chain, not by whether the string looks local.
eq('nor by sending a PRIVATE address, though private addresses are trusted peers',
  (await ask(GATEWAY, `10.0.0.5, ${VISITOR}`)).ip, VISITOR);

// Fail closed. If the published port is ever exposed — docs/DEPLOY.md's probe
// reaches it over loopback today, and an exposed port is one compose edit away —
// a direct client's forwarded header must not be believed.
eq('a direct client that is not a trusted peer cannot forward at all',
  (await ask('198.51.100.7', SPOOF)).ip, '198.51.100.7');

// The `loopback` half of the value earns an assertion of its own, because a
// half of a config value that nothing exercises is precisely the shape this
// whole round is about: on the live host a loopback-published port still
// arrives from the bridge gateway, so without this case `uniquelocal` alone
// would pass every other assertion here and the difference would be invisible
// until something reached the app over loopback and got a different answer.
eq('a loopback peer is trusted too — dev, this suite, and DEPLOY.md\'s own probe',
  (await ask('127.0.0.1', VISITOR)).ip, VISITOR);

eq('X-Forwarded-Proto is honoured through the proxy',
  (await ask(GATEWAY, VISITOR, 'https')).protocol, 'https');
eq('and ignored from a direct client',
  (await ask('198.51.100.7', null, 'https')).protocol, 'http');

await probe.close();

console.log('\nthe consequence, through the real app:');

// THE JOIN. Everything above is true of TRUST_PROXY and says nothing about
// whether src/server.js uses it — which is exactly the gap that let the original
// fault live, the value being a literal in a config object no test could reach.
// These cases drive the real Fastify instance the server exports, so the only
// thing being asserted is what a visitor would actually get.
const { app } = await import('../src/server.js');
await app.ready();

// The honeypot arm of /api/public/feedback: it costs a rate-limit hit and writes
// nothing at all, which is what makes it safe to spend twenty of them here.
const knock = (xff) => app.inject({
  method: 'POST',
  url: '/api/public/feedback',
  remoteAddress: GATEWAY,
  headers: { 'x-forwarded-for': xff, 'content-type': 'application/json' },
  payload: { website_hp: 'a-bot-filled-this-in' },
});

const LIMIT = 20; // rateLimited()'s default max, per address, per minute
let firstRefusal = null;
for (let i = 1; i <= LIMIT + 1; i++) {
  const res = await knock(VISITOR);
  if (res.statusCode === 429 && firstRefusal === null) firstRefusal = i;
}
eq(`one visitor is refused on request ${LIMIT + 1}, not before`, firstRefusal, LIMIT + 1);

const second = await knock(OTHER);
check(
  'a DIFFERENT visitor still gets through — the limit is per person, not per proxy',
  second.statusCode !== 429,
  `the second visitor got ${second.statusCode}; under a shared bucket every visitor is refused once any one of them is`,
);

await app.close();

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
