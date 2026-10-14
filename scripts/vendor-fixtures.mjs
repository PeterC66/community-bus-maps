#!/usr/bin/env node
// vendor-fixtures.mjs — copy the byte gates' fixtures INTO this repository from
// the two repositories that own them, and say when the copy has fallen behind.
//
// WHERE EACH HALF COMES FROM (buses-data OA-635, 2026-10-14).
//
//   Areas/   from claude-skills, `make-bus-leaflet/test/fixtures/estate/Areas/<Town>/
//            ci-reference/`. That is the engine's own miniature estate, which
//            `npm run fixture:estate -- --apply` re-stamps and redraws in the same
//            pull request as every engine edit, so the area fixture is current by
//            construction. Until OA-635 it came from buses-data's
//            `Areas/_portal-fixture/St Ives`, a copy of the real town's newest
//            render: the real St Ives could then be rebuilt only together with a
//            pin bump (claude-skills' `fixture_donor.js`, OA-532), and the copy
//            described whatever the town last rendered rather than the engine.
//   Places/  from buses-data, `Places/_portal-fixture/`, as before. That pack is not
//            a copy of any place's own render (it carries `base-overrides.json`),
//            so it has no engine-estate twin.
//
// WHICH AREA TOWNS is read from this repository's own `gate-fixtures/Areas/
// _portal-fixture/`, not typed here, because claude-skills' board (portal_fixtures.js)
// asks the same question the same way and two typed lists are two lists that must
// agree. `--town "<Town>"` vendors one more, once.
//
// WHY THIS EXISTS AT ALL (buses-data OA-398, R5 of the 2026-09-17 process review).
// Until 2026-09-18 `verify.yml` cloned PeterC66/buses-data with CROSS_REPO_PAT2.
// That token expires on 22 November 2026, and because this repository requires
// `verify` and forbids bypassing, its expiry would have blocked every pull request
// here outright. The fix was not a longer-lived token: a public repository gates
// fixtures IT HOLDS, so the gate needs no credential, no second checkout and no
// opinion about what somebody else pushed a minute ago.
//
// THE JPGs ARE DELIBERATELY LEFT BEHIND: rasterisation is platform-dependent by
// design, so a JPG comparison is expected to differ for ever. `verify-reproduce.mjs`
// guards its JPG arm with an existsSync and calls it informational;
// `render-parity.yml` is the gate that really asks that question. Markdown is left
// behind too: a README written about another repository has relative links that
// climb out of it. What a reader of `gate-fixtures/` needs is in its own README.
//
// WHERE `--check` RUNS FOR REAL. From the laptop; and the Places half, as a step in
// buses-data's own `gates.yml` (`--only Places`), because the subject of "has the
// Places copy fallen behind" is a fixture in buses-data. The Areas half's subject is
// claude-skills' estate, which claude-skills' board reports on as a chore.
//
// Run from this repository's root (C:\Buses\community-bus-maps). There are no
// placeholders; `--skills` and `--buses` are needed only when a checkout is
// somewhere this script cannot guess (a worktree of this repository is one):
//
//     npm run fixtures:vendor                 -- says what would change, writes nothing
//     npm run fixtures:vendor -- --apply      -- rewrites gate-fixtures/
//     npm run fixtures:vendor -- --only Places --buses "C:/Buses/buses-data"
//     npm run fixtures:vendor -- --skills "C:/Buses/claude-skills" --buses "C:/Buses/buses-data"
//
// EXIT CODES follow the house convention: 0 in step, 1 BEHIND (a --check finding),
// 2 used wrongly or no source to compare against. `--allow-skip` turns the third
// into a 0 with a sentence saying what was not proved, for a clone of the portal
// alone.

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { busesDirCandidates, skillsDirCandidates, VENDORED_FIXTURE_ROOT, ESTATE_REL } from './lib/fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ALLOW_SKIP = argv.includes('--allow-skip');
const flagValue = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
for (const name of ['buses', 'skills', 'only', 'town']) {
  if (argv.includes('--' + name) && !flagValue(name)) {
    console.error(`vendor-fixtures: --${name} needs a value.`);
    process.exit(2);
  }
}
const ONLY = flagValue('only');
if (ONLY && ONLY !== 'Areas' && ONLY !== 'Places') {
  console.error(`vendor-fixtures: --only takes Areas or Places, not ${ONLY}.`);
  process.exit(2);
}
const KINDS = ['Areas', 'Places'].filter((k) => !ONLY || ONLY === k);

const skip = (rel) => /\.jpe?g$/i.test(rel) || /\.md$/i.test(rel);

/* LINE ENDINGS ARE NORMALISED ON BOTH SIDES, AND THIS IS NOT TIDINESS (OA-398).
 * `core.autocrlf=true` is set on the laptop, so a source repository's WORKING TREE
 * holds CRLF in files git stores as LF, while this repository's `.gitattributes`
 * says `* text=auto eol=lf`. A byte comparison between the two working trees
 * reported 15 files as `differs` the moment they were first vendored — a check red
 * for ever, about a newline. So the copy is WRITTEN as LF and the comparison
 * normalises both sides before asking. */
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

const VENDORED = path.resolve(PORTAL_ROOT, VENDORED_FIXTURE_ROOT);
const notHere = (d) => path.resolve(d) !== VENDORED && path.resolve(d) !== PORTAL_ROOT;

/* WHERE EACH SOURCE IS. An explicit flag wins, then the resolvers this repository
 * already uses — minus this repository itself, which `busesDirCandidates()` offers
 * first and which is the copy we are comparing AGAINST: a source that turned out
 * to be the destination would report "in step" for ever. */
function findSource(kind) {
  if (kind === 'Places') {
    const explicit = flagValue('buses');
    const tried = (explicit ? [explicit] : busesDirCandidates()).filter(notHere);
    const hit = tried.find((d) => existsSync(path.join(d, 'Places', '_portal-fixture')));
    return { tried, root: hit ? path.join(path.resolve(hit), 'Places', '_portal-fixture') : null, what: 'buses-data checkout holding Places/_portal-fixture' };
  }
  const explicit = flagValue('skills');
  const tried = explicit ? [explicit] : skillsDirCandidates();
  const hit = tried.find((d) => existsSync(path.join(d, ESTATE_REL, 'Areas')));
  return { tried, root: hit ? path.join(path.resolve(hit), ESTATE_REL, 'Areas') : null, what: `claude-skills checkout holding ${ESTATE_REL}/Areas` };
}

/* Each kind as { rel -> source file } under `<kind>/_portal-fixture/`. */
function wanted(kind, root) {
  const out = new Map();
  if (kind === 'Places') {
    for (const rel of walk(root).filter((r) => !skip(r))) out.set(rel, path.join(root, rel));
    return { files: out, orphans: [] };
  }
  const have = new Set(walk(path.join(VENDORED, 'Areas', '_portal-fixture')).map((r) => r.split('/')[0]));
  const extra = flagValue('town');
  if (extra) have.add(extra);
  const orphans = [];
  for (const town of [...have].filter(Boolean).sort()) {
    const pack = path.join(root, town, 'ci-reference');
    if (!existsSync(pack)) { orphans.push(town); continue; }
    for (const rel of walk(pack).filter((r) => !skip(r))) out.set(town + '/' + rel, path.join(pack, rel));
  }
  if (!have.size) orphans.push('(none — name the estate town to vendor with --town "<Town>")');
  return { files: out, orphans };
}

let behind = 0;
const changes = [];
const sourcesUsed = [];
let missingSource = false;

for (const kind of KINDS) {
  const src = findSource(kind);
  if (!src.root) {
    missingSource = true;
    const msg = `no ${src.what}`;
    if (ALLOW_SKIP) {
      console.log(`· SKIPPED ${kind} (--allow-skip): ${msg}.`);
      console.log(`  NOTHING WAS PROVED about whether gate-fixtures/${kind}/ is still in step with its source.`);
      continue;
    }
    console.error(`✗ vendor-fixtures: ${msg}.`);
    console.error('  Looked in, in order:');
    for (const d of src.tried) console.error('    ' + d);
    console.error(`  Point at it with --${kind === 'Places' ? 'buses' : 'skills'} "<dir>"${kind === 'Places' ? ', or set BUSES_DIR' : ', or set SKILLS_DIR'}, or ask one half with --only.`);
    console.error('  This repository cannot answer the question on its own, and that is deliberate: the');
    console.error('  whole of OA-398 is that its gates no longer need another repository to RUN.');
    continue;
  }
  sourcesUsed.push(`${kind} <- ${src.root}`);
  const dst = path.join(VENDORED, kind, '_portal-fixture');
  const { files, orphans } = wanted(kind, src.root);
  for (const town of orphans) {
    behind++;
    changes.push(`orphan   ${kind}/_portal-fixture/${town}  (no pack at ${ESTATE_REL}/Areas/${town}/ci-reference)`);
  }
  for (const [rel, from] of files) {
    const b = path.join(dst, rel);
    const bytes = lf(readFileSync(from));
    if (existsSync(b) && lf(readFileSync(b)).equals(bytes)) continue;
    behind++;
    changes.push(`${existsSync(b) ? 'differs' : 'missing'}  ${kind}/_portal-fixture/${rel}`);
    if (APPLY) {
      mkdirSync(path.dirname(b), { recursive: true });
      writeFileSync(b, bytes);
    }
  }
  for (const rel of walk(dst)) {
    if (files.has(rel)) continue;
    if (kind === 'Areas' && orphans.includes(rel.split('/')[0])) continue;
    behind++;
    changes.push(`stale    ${kind}/_portal-fixture/${rel}  (its source no longer has it)`);
    if (APPLY) rmSync(path.join(dst, rel), { force: true });
  }
}

if (missingSource && !ALLOW_SKIP) process.exit(2);

console.log(`vendored fixtures: ${VENDORED_FIXTURE_ROOT}/`);
for (const s of sourcesUsed) console.log('  ' + s);
for (const c of changes) console.log('  ' + c);

if (!sourcesUsed.length) process.exit(0);   // only reached under --allow-skip, which has said what it skipped
if (!behind) {
  console.log('  in step — every fixture file here is byte-identical to its source.');
  process.exit(0);
}
if (APPLY) {
  console.log(`\n${behind} item(s) rewritten. Commit gate-fixtures/ and say which commits they came from.`);
  process.exit(0);
}
console.error(`\n✗ ${behind} item(s) BEHIND. Re-vendor from this repository's root, with no placeholders:`);
console.error('    npm run fixtures:vendor -- --apply');
process.exit(1);
