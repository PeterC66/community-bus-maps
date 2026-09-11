#!/usr/bin/env node
// Keep public/data/bus-map-directory.json in step with buses-data (OA-308 tier 2).
//
//   node scripts/sync-directory.mjs            re-project the source into the vendored copy
//   node scripts/sync-directory.mjs --check    say whether it is out of step, write nothing
//   node scripts/sync-directory.mjs --check --allow-skip
//                                              …and pass, loudly, when the source
//                                              repository is not on this machine
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). There are no
// placeholders in those commands.
//
// WHY THE PORTAL CARRIES A COPY AT ALL. The directory lives in buses-data, which
// is PRIVATE and must stay private — it holds `Correspondence/`, which is real
// people's words. This repository is public and its deployment pulls nothing
// from there at runtime. So the file is vendored, exactly the way generators are
// vendored per map: one copy, byte-identical, with a script that renews it and a
// gate that notices when somebody forgets.
//
// WHY A PROJECTION RATHER THAN THE WHOLE FILE. The first version of this script
// copied the source byte for byte, which is the strongest check there is. It was
// wrong for a reason that has nothing to do with checking: two thirds of that
// file is `note` and `sources`, our own candid assessment of each council's
// website — "the page has been withdrawn", "the site is abandoned", "a map
// nobody can reach" — written for us, in a PRIVATE repository. This repository
// is public. Publishing a judgement about a named organisation's website is a
// different act from publishing a link to its map, and only the second one is
// what the panel needs. So the sync PROJECTS: the fields the page renders, and
// nothing else. It is still exact — the vendored file must equal the projection
// byte for byte — and the projection is a field whitelist below, short enough to
// read in one go, with a test that asserts no note or source survived it.
//
// WHERE THE CHECK RUNS. `npm test` cannot run it — a CI runner for a public repo
// has no buses-data checkout, and inventing one would be a check that is green
// for ever. verify.yml already checks buses-data out for the fixtures, so the
// `--check` form runs THERE, next to the gates that have the same dependency.
// What `npm test` does instead is assert the vendored file's SHAPE
// (scripts/test-directory.mjs), which needs no second repository.
//
// Exit codes follow docs/CONVENTIONS.md: 0 in step (or copied), 1 the vendored
// copy is stale, 2 used wrongly / nothing to compare against.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { busesDirCandidates } from './lib/fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(HERE, '..');
const VENDORED = path.join(PORTAL_ROOT, 'public', 'data', 'bus-map-directory.json');
const SOURCE_REL = path.join('BusMapsUK', 'bus-map-directory', 'directory.json');

const KNOWN = ['--check', '--allow-skip'];
const args = process.argv.slice(2);
for (const a of args) {
  if (!KNOWN.includes(a)) {
    console.error(`sync-directory: unknown flag ${a}. Known flags: ${KNOWN.join(' ')}`);
    process.exit(2);
  }
}
const CHECK = args.includes('--check');
const ALLOW_SKIP = args.includes('--allow-skip');

/** The source file in whichever buses-data checkout this machine has, or null. */
function findSource() {
  for (const base of busesDirCandidates()) {
    const p = path.join(base, SOURCE_REL);
    if (existsSync(p)) return p;
  }
  return null;
}

const source = findSource();
if (!source) {
  const tried = busesDirCandidates().map((b) => `  ${path.join(b, SOURCE_REL)}`).join('\n');
  if (ALLOW_SKIP) {
    console.log('sync-directory: SKIPPED — no buses-data checkout on this machine.');
    console.log('  THIS PROVED NOTHING. The vendored directory may be stale and this run cannot tell.');
    console.log(`  Looked for:\n${tried}`);
    process.exit(0);
  }
  console.error('sync-directory: cannot find the source directory.json. Looked for:');
  console.error(tried);
  console.error('  Set BUSES_DIR to the buses-data checkout, or pass --allow-skip to say out loud that nothing was checked.');
  process.exit(2);
}

/**
 * The whitelist. Everything the panel can render, and nothing a council would
 * be surprised to find published about itself. `note` and `sources` are the
 * deliberate omissions; `_comment` and the survey's own provenance block go too.
 */
function project(doc) {
  const pick = (o, keys) => {
    const out = {};
    for (const k of keys) if (o && o[k] !== undefined && o[k] !== '') out[k] = o[k];
    return out;
  };
  return {
    _comment: [
      'A PROJECTION of BusMapsUK/bus-map-directory/directory.json in the private',
      'buses-data repository, written by scripts/sync-directory.mjs and checked by',
      '`npm run sync:directory -- --check`. It carries the fields the /maps search',
      'panel renders and deliberately NOT the survey notes or the pages each row',
      'was read from — those are our own assessment of somebody else\'s website and',
      'they stay in the private repository. Do not hand-edit this file.',
    ],
    source: { surveyed: (doc.source || {}).surveyed || '', rows: (doc.rows || []).length },
    rows: (doc.rows || []).map((r) => {
      const out = { lta: r.lta };
      if (r.covers && r.covers.length) out.covers = r.covers;
      out.networkMap = pick(r.networkMap, ['status', 'url', 'format', 'publisher', 'dated']);
      out.townMaps = pick(r.townMaps, ['status', 'examples', 'url']);
      if (r.alsoPublished && r.alsoPublished.length) {
        out.alsoPublished = r.alsoPublished.map((a) => pick(a, ['publisher', 'covers', 'what', 'url', 'checked']));
      }
      if (r.landingPage) out.landingPage = r.landingPage;
      out.checked = r.checked;
      return out;
    }),
  };
}

const src = Buffer.from(JSON.stringify(project(JSON.parse(readFileSync(source, 'utf8'))), null, 2) + '\n');
const cur = existsSync(VENDORED) ? readFileSync(VENDORED) : null;
const same = cur !== null && src.equals(cur);

if (CHECK) {
  if (same) {
    console.log(`sync-directory: the vendored copy matches ${source} (${src.length.toLocaleString('en-GB')} bytes).`);
    process.exit(0);
  }
  console.error('sync-directory: public/data/bus-map-directory.json is OUT OF STEP with buses-data.');
  console.error(`  source   ${source} (${src.length.toLocaleString('en-GB')} bytes)`);
  console.error(`  vendored ${VENDORED} (${cur === null ? 'missing' : cur.length.toLocaleString('en-GB') + ' bytes'})`);
  console.error('  Run `npm run sync:directory` from the repository root and commit the result.');
  process.exit(1);
}

if (same) {
  console.log('sync-directory: already in step, nothing written.');
  process.exit(0);
}
writeFileSync(VENDORED, src);
console.log(`sync-directory: projected ${source}`);
console.log(`                       -> ${VENDORED} (${src.length.toLocaleString('en-GB')} bytes, notes and sources left behind)`);
