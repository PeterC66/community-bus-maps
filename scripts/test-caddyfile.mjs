// What ./Caddyfile declares — asserted against the file itself, not the deploy.
//
//   node scripts/test-caddyfile.mjs      (part of `npm test`)
//
// WHY THIS EXISTS. The Caddyfile is the one file in this repository that CI can
// neither run nor validate: Caddy is not installed on the runner, and the only
// thing that parses it for real is `caddy validate` on the VPS, inside
// `npm run deploy:caddy`, after the file has already been copied up. So the
// checks that can be made here are about SHAPE and INTENT, and they are worth
// making precisely because the real parser is somewhere else.
//
// Three claims, and each one is a mistake that has a name:
//
//   1. The deploy script reads the public hostname out of this file. It did that
//      with "the first non-comment line ending in `{`" until 2026-08-31, when the
//      file gained a `(access_log)` snippet definition ABOVE the site block —
//      which is that shape exactly. The old parser would have reported the public
//      hostname as `(access_log)` and every verification downstream would have
//      been asked of a name that does not exist. The falsification arm below
//      drives the OLD parser at the CURRENT file and asserts it gets it wrong,
//      because a guard that has never been seen to fail proves nothing.
//
//   2. Every site block imports the access log. The redaction (OA-006) is a
//      property of a block, not of the file: a redirect preserves the query
//      string, so a www URL carrying `?q=` writes the search term on its way
//      past. Redacting in one block and not the other leaves the hole open on
//      the hostname nobody watches, and looks completely fixed from the apex.
//
//   3. Both parameters are named in the filter. `q` is a search term and `token`
//      is a live 15-minute sign-in credential; losing either from the list is a
//      silent regression that no response header would show.

import { readFileSync } from 'node:fs';
import { siteBlocks, primaryHost } from './lib/caddyfile.mjs';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const text = readFileSync('Caddyfile', 'utf8');
const blocks = siteBlocks(text);

console.log('site blocks:');
check('there are exactly two', blocks.length === 2, `found ${blocks.length}: ${blocks.map((b) => b.addresses.join('+')).join(', ')}`);
check('the FIRST is the apex, and it is the one the deploy script reads', primaryHost(text) === 'busmaps.uk',
  `primaryHost() said ${JSON.stringify(primaryHost(text))}`);
check('the apex block is a reverse proxy', (blocks[0] || { body: [] }).body.some((l) => l.startsWith('reverse_proxy ')));
check('the second block is www', (blocks[1] || { addresses: [] }).addresses.join(',') === 'www.busmaps.uk');

console.log('the www block redirects rather than serving:');
const www = blocks[1] || { body: [] };
check('it redirects to the apex, permanently', www.body.includes('redir https://busmaps.uk{uri} permanent'),
  'a 200 on www is the duplicate-content state this block exists to end');
check('it does NOT reverse-proxy as well', !www.body.some((l) => l.startsWith('reverse_proxy ')),
  'a name cannot both redirect and be an alias of what it redirects to');

console.log('the access log is redacted, on EVERY block:');
check('the snippet is defined', /^\(access_log\)\s*\{/m.test(text));
for (const b of blocks) {
  check(`${b.addresses.join(',')} imports access_log`, b.imports.includes('access_log'),
    'the query string survives a redirect, so an un-imported block leaks it');
}
check('no block writes the log file directly', !blocks.some((b) => b.body.some((l) => l.startsWith('output file '))),
  'a second, unfiltered `log { output file … }` would quietly re-open the hole');
check('the filter redacts q', /\breplace q REDACTED\b/.test(text), 'search terms are never logged (P9 B8)');
check('the filter redacts token', /\breplace token REDACTED\b/.test(text), '/auth/verify?token= is a live sign-in credential');
check('the filter names the encoder rather than inheriting it', /\bwrap json\b/.test(text));

console.log('the OLD one-line parser is genuinely wrong about THIS file:');
// Verbatim, as it stood in scripts/deploy-caddy.mjs before 2026-08-31.
const oldLine = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && l.trim().endsWith('{'));
const oldHost = oldLine ? oldLine.replace('{', '').split(',')[0].trim() : null;
check('it picks the snippet, not the site', oldHost === '(access_log)',
  `it said ${JSON.stringify(oldHost)} — if this now passes for the right reason, this arm has stopped testing anything`);
check('the new parser disagrees with it', primaryHost(text) !== oldHost);

console.log('the parser refuses to invent a site where there is none:');
check('a file of only snippets has no primary host', primaryHost('(a) {\n\tencode gzip\n}\n') === null);
check('a comment ending in { is not a site', primaryHost('# not a site {\nreal.example {\n\tencode gzip\n}\n') === 'real.example');
check('a nested block does not end the site block', siteBlocks('a.example {\n\theader {\n\t\tX 1\n\t}\n\timport access_log\n}\n')[0].imports.includes('access_log'),
  'if `}` on the header block closed the site, the import would be read as top-level');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll Caddyfile checks passed.');
