#!/usr/bin/env node
// check-deploy-history.mjs — would this deploy put anything live that no
// deploy-history entry describes? (buses-data OA-377, DEPLOY.md §3b)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`):
//     node scripts/check-deploy-history.mjs
//     node scripts/check-deploy-history.mjs --to <ref>
//
// `<ref>` is the commit that would go live; it defaults to `origin/main`,
// because the host's `git pull` takes `main` from GitHub and not from this
// laptop. `npm run deploy` runs this first, after a `git fetch`, and refuses
// on exit 1. Every first-parent commit after `BASELINE` (scripts/lib/
// deploy-history.mjs) up to `<ref>` must add a CHANGELOG.d/ fragment, edit
// docs/DEPLOY.md, or be named in one of them by `#NNN` or short sha.
//
// Exit codes (docs/CONVENTIONS.md): 0 every commit is described, 1 at least
// one is not, 2 used wrongly or git could not answer.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { arg, has } from './lib/cli.mjs';
import { BASELINE, prNumber, readCommits, readDescriptions, undescribed } from './lib/deploy-history.mjs';

if (has('help')) {
  console.log('usage: node scripts/check-deploy-history.mjs [--to <ref>] [--repo <path>]');
  process.exit(2);
}

const repo = arg('repo', join(dirname(fileURLToPath(import.meta.url)), '..'));
const to = arg('to', 'origin/main');
const from = arg('from', BASELINE);

let commits, missing;
try {
  commits = readCommits(repo, from, to);
  missing = undescribed({ commits, ...readDescriptions(repo, to) });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(2);
}

if (missing.length === 0) {
  console.log(`deploy history: all ${commits.length} commit(s) in ${from}..${to} are described.`);
  process.exit(0);
}

console.error(`✗ deploy history: ${missing.length} of ${commits.length} commit(s) in ${from}..${to} would go live described by nothing:`);
for (const c of missing) console.error(`    ${c.sha}  ${c.subject}`);
console.error('');
console.error('  Each one needs a line saying what it changes, before it is deployed (docs/DEPLOY.md §3b).');
const prs = missing.map((c) => prNumber(c.subject)).filter(Boolean);
console.error(`  Add a CHANGELOG.d/ fragment that names ${prs.length ? prs.map((n) => '#' + n).join(', ') : 'each sha above'},`);
console.error('  in its own pull request, merge it, and deploy that merge.');
process.exit(1);
