#!/usr/bin/env node
// vendor-fixtures.mjs — copy the two byte gates' fixtures OUT of buses-data and
// INTO this repository, and say when the copy has fallen behind.
//
// WHY THIS EXISTS (buses-data OA-398, R5 of the 2026-09-17 process review). Until
// 2026-09-18 `verify.yml` cloned PeterC66/buses-data with CROSS_REPO_PAT2 to read
// `Areas/_portal-fixture` and `Places/_portal-fixture`. That token expires on
// 22 November 2026, and because this repository requires `verify` and forbids
// bypassing, its expiry would have blocked every pull request here outright. The
// fix is not a longer-lived token: it is that a public repository gates fixtures
// IT HOLDS, so the gate needs no credential, no second checkout and no opinion
// about what somebody else pushed a minute ago.
//
// WHAT MOVED AND WHAT DID NOT. The SOURCE of a fixture is still a real render in
// buses-data — `refresh_area_fixture.js` in the engine writes `Areas/_portal-fixture`,
// `refresh-place-fixture.mjs` in this repository writes `Places/_portal-fixture`,
// both into buses-data, both from an S5 run that only the laptop has. This script
// is the third step, and it is the only one that writes here. So the chain is:
// render -> refresh the fixture in buses-data -> vendor it here.
//
// THE JPGs ARE DELIBERATELY LEFT BEHIND, and the argument is not ours: the area
// fixture's own README in buses-data has excluded them since the day it was
// created, because rasterisation is platform-dependent by design and committing
// 4.4 MB of JPG buys a comparison that is expected to differ for ever.
// `verify-reproduce.mjs` guards its JPG arm with an existsSync and calls it
// informational; `render-parity.yml` is the gate that really asks that question.
// Vendoring them would have quadrupled this folder to buy nothing. Measured: the
// 78 tracked fixture files are 8.5 MB with the four JPGs and 3.8 MB without.
//
// WHERE `--check` RUNS FOR REAL. Not here — this repository has no buses-data to
// compare against, which is the whole point. It runs from the laptop, and as a
// step in buses-data's own `gates.yml`, which checks this public repository out
// with no token at all. That is OA-218's rule applied straight: a check belongs
// in the suite that fires when its SUBJECT changes, and the subject of "has the
// vendored copy fallen behind" is the fixture in buses-data.
//
// Run from this repository's root (C:\Claude\community-bus-maps). There are no
// placeholders; `--buses` is only needed when buses-data is somewhere this script
// cannot guess:
//
//     npm run fixtures:vendor                 -- says what would change, writes nothing
//     npm run fixtures:vendor -- --apply      -- rewrites gate-fixtures/
//     npm run fixtures:vendor -- --buses "C:/u3a St Ives/Using AI/Buses"
//
// EXIT CODES follow the house convention: 0 in step, 1 BEHIND (a --check finding),
// 2 used wrongly or no source to compare against. `--allow-skip` turns the third
// into a 0 with a sentence saying what was not proved, for a clone of the portal
// alone.

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { busesDirCandidates, VENDORED_FIXTURE_ROOT } from './lib/fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ALLOW_SKIP = argv.includes('--allow-skip');
const flagValue = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

/* The two folders, named once. A fixture kind is a folder in buses-data and the
 * same folder under gate-fixtures/ here, so `busesDirCandidates()` can be handed
 * this repository's own root and find them with no special case. */
const KINDS = ['Areas', 'Places'];

/* A file we do not vendor. The JPGs, for the reason in the header. And MARKDOWN,
 * which is the trap this repository's own house style names: buses-data's
 * `Areas/_portal-fixture/README.md` is written about buses-data, and its relative
 * links climb out of it — vendored here they would resolve on a laptop that has
 * both trees side by side and 404 for everybody else, with `check-doc-links.mjs`
 * reporting findings against prose nobody here owns. What a reader of this folder
 * needs is written once, in `gate-fixtures/README.md`, which is ours. */
const skip = (rel) => /\.jpe?g$/i.test(rel) || /\.md$/i.test(rel);

/* LINE ENDINGS ARE NORMALISED ON BOTH SIDES, AND THIS IS NOT TIDINESS (OA-398).
 * Every file vendored here is text. `core.autocrlf=true` is set on the laptop, so
 * buses-data's WORKING TREE holds CRLF in files git stores as LF, while this
 * repository's `.gitattributes` says `* text=auto eol=lf` and checks them out as
 * LF. A byte comparison between the two working trees therefore reported 15 files
 * as `differs` the moment they were vendored — a check that is red for ever,
 * about a newline, on the one script whose whole job is to be believed about a
 * copy. It is the same fault buses-data's `assemble.mjs` shipped: an index built
 * with LF compared against a file git stores with CRLF, green on Windows and red
 * on its first CI run.
 *
 * So the copy is WRITTEN as LF — which is what git would have stored anyway, so
 * the committed bytes and the working-tree bytes agree here — and the comparison
 * normalises both sides before asking. A file that differs only in its line
 * endings is not drift, and calling it drift would train the reader to re-vendor
 * on no evidence. */
const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

/** Every file under `dir`, relative to it, sorted, recursing. */
function walk(dir, base = dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    const p = path.join(dir, n);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/* WHERE buses-data IS. `--buses` wins, then the resolver this repository already
 * uses for everything else — minus this repository itself, which that resolver
 * now offers first and which is the copy we are trying to compare AGAINST. A
 * source that turned out to be the destination would report "in step" for ever,
 * which is the shape of every check in this estate that has ever lied. */
const explicit = flagValue('buses');
if (argv.includes('--buses') && !explicit) {
  console.error('vendor-fixtures: --buses needs a path.');
  process.exit(2);
}
const VENDORED = path.resolve(PORTAL_ROOT, VENDORED_FIXTURE_ROOT);
const sources = (explicit ? [explicit] : busesDirCandidates())
  .filter((d) => path.resolve(d) !== VENDORED && path.resolve(d) !== PORTAL_ROOT)
  .filter((d) => KINDS.some((k) => existsSync(path.join(d, k, '_portal-fixture'))));

if (!sources.length) {
  const msg = 'no buses-data checkout holding Areas/_portal-fixture or Places/_portal-fixture';
  if (ALLOW_SKIP) {
    console.log(`· SKIPPED (--allow-skip): ${msg}.`);
    console.log('  NOTHING WAS PROVED about whether gate-fixtures/ is still in step with buses-data.');
    process.exit(0);
  }
  console.error(`✗ vendor-fixtures: ${msg}.`);
  console.error('  Looked in, in order:');
  for (const d of explicit ? [explicit] : busesDirCandidates()) console.error('    ' + d);
  console.error('  Point at it with --buses "<dir>", or set BUSES_DIR.');
  console.error('  This repository cannot answer the question on its own, and that is deliberate: the');
  console.error('  whole of OA-398 is that its gates no longer need buses-data to RUN.');
  process.exit(2);
}
const BUSES = path.resolve(sources[0]);

let behind = 0;
const changes = [];

for (const kind of KINDS) {
  const src = path.join(BUSES, kind, '_portal-fixture');
  const dst = path.join(VENDORED, kind, '_portal-fixture');
  const want = walk(src).filter((r) => !skip(r));
  const have = walk(dst);

  for (const rel of want) {
    const a = path.join(src, rel);
    const b = path.join(dst, rel);
    const from = lf(readFileSync(a));
    const same = existsSync(b) && lf(readFileSync(b)).equals(from);
    if (same) continue;
    behind++;
    changes.push(`${existsSync(b) ? 'differs' : 'missing'}  ${kind}/_portal-fixture/${rel}`);
    if (APPLY) {
      mkdirSync(path.dirname(b), { recursive: true });
      writeFileSync(b, from);
    }
  }

  for (const rel of have) {
    if (want.includes(rel)) continue;
    behind++;
    changes.push(`stale    ${kind}/_portal-fixture/${rel}  (buses-data no longer writes it)`);
    if (APPLY) rmSync(path.join(dst, rel), { force: true });
  }
}

console.log(`vendored fixtures: ${VENDORED_FIXTURE_ROOT}/  <-  ${BUSES}`);
for (const c of changes) console.log('  ' + c);

if (!behind) {
  console.log('  in step — every fixture file here is byte-identical to buses-data.');
  process.exit(0);
}
if (APPLY) {
  console.log(`\n${behind} file(s) rewritten. Commit gate-fixtures/ and say which buses-data commit they came from.`);
  process.exit(0);
}
console.error(`\n✗ ${behind} file(s) BEHIND buses-data. Re-vendor from this repository's root, with no placeholders:`);
console.error('    npm run fixtures:vendor -- --apply');
process.exit(1);
