// test-vendored.mjs — proves scripts/lib/vendored.mjs can go RED, one failure
// mode at a time, and then audits the REAL engine/ tree.
//
//   node scripts/test-vendored.mjs        (or: npm run test:vendored)
//
// Every case below builds a throwaway engine tree and a throwaway skill tree in
// a temp folder, breaks exactly one thing, and asserts the status that break is
// supposed to produce. A gate nobody has watched fail is not a gate — and this
// one exists because its predecessor, the eleven-row list inside the skills'
// status.js, was green for four days while engine/area/gen_external_radial.js
// was stale, simply because the list did not name the file.
//
// The last section is the gate itself: the real manifest against the real tree,
// with the source half switched off, which is exactly how CI runs it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditVendored, hashOf, listEngineFiles } from './lib/vendored.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-vendored-'));

/** Build a miniature portal engine + skill tree, and return the audit inputs. */
function makeTree(name) {
  const base = path.join(scratch, name);
  const engineDir = path.join(base, 'engine');
  const skillRoot = path.join(base, 'skills');
  const srcDir = path.join(skillRoot, 'make-bus-leaflet', 'assets');
  mkdirSync(path.join(engineDir, 'place'), { recursive: true });
  mkdirSync(srcDir, { recursive: true });

  const body = '// icons\nmodule.exports = { icon: () => "x" };\n';
  const genBody = '// gen\nmodule.exports = {};\n';
  writeFileSync(path.join(engineDir, 'icons.js'), body);
  writeFileSync(path.join(srcDir, 'icons.js'), body);
  writeFileSync(path.join(engineDir, 'place', 'gen_internal.js'), genBody);
  writeFileSync(path.join(srcDir, 'gen_internal.js'), genBody);
  writeFileSync(path.join(engineDir, 'wrapper.js'), '// portal-owned\n');

  const manifestPath = path.join(engineDir, 'vendored.json');
  const manifest = {
    skillRootDefault: skillRoot,
    files: [
      { path: 'icons.js', kind: 'vendored', source: 'make-bus-leaflet/assets/icons.js', sha256: hashOf(path.join(engineDir, 'icons.js')), vendoredOn: '2026-08-25' },
      { path: 'place/gen_internal.js', kind: 'vendored', source: 'make-bus-leaflet/assets/gen_internal.js', sha256: hashOf(path.join(engineDir, 'place', 'gen_internal.js')), vendoredOn: '2026-08-25' },
      { path: 'wrapper.js', kind: 'portal-owned', why: 'a portal wrapper with no counterpart in the skill' },
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { engineDir, manifestPath, skillRoot, srcDir };
}

const statusOf = (result, file) => (result.rows.find((r) => r.file === file) || {}).status;

console.log('\nthe clean case:');
{
  const t = makeTree('clean');
  const r = auditVendored(t);
  check('a tree that matches its manifest passes', r.ok === true, JSON.stringify(r.rows.filter((x) => x.status !== 'OK')));
  check('every file is reported, not just the broken ones', r.rows.length === 3);
  check('the source half actually ran', r.sourceChecked === true);
}

console.log('\nthe portal copy was edited (nobody re-vendored):');
{
  const t = makeTree('edited');
  writeFileSync(path.join(t.engineDir, 'icons.js'), '// icons\nmodule.exports = { icon: () => "TAMPERED" };\n');
  const r = auditVendored(t);
  check('icons.js reports EDITED', statusOf(r, 'icons.js') === 'EDITED', statusOf(r, 'icons.js'));
  check('the audit fails', r.ok === false);
  check('the other files are still OK', statusOf(r, 'place/gen_internal.js') === 'OK');
}

console.log('\nthe skill source moved on (the portal is stale):');
{
  const t = makeTree('drifted');
  writeFileSync(path.join(t.srcDir, 'gen_internal.js'), '// gen\n// a fix landed in the skill\nmodule.exports = {};\n');
  const r = auditVendored(t);
  check('gen_internal.js reports DRIFTED', statusOf(r, 'place/gen_internal.js') === 'DRIFTED', statusOf(r, 'place/gen_internal.js'));
  check('the audit fails', r.ok === false);
  check('the hash-only half still says OK for the untouched file', statusOf(r, 'icons.js') === 'OK');
}

console.log('\na file appears in engine/ that the manifest does not name:');
{
  const t = makeTree('unlisted');
  writeFileSync(path.join(t.engineDir, 'place', 'gen_new_thing.js'), '// vendored by somebody in a hurry\n');
  const r = auditVendored(t);
  check('it reports UNLISTED', statusOf(r, 'place/gen_new_thing.js') === 'UNLISTED', statusOf(r, 'place/gen_new_thing.js'));
  check('the audit fails', r.ok === false);
}

console.log('\na vendored file is deleted:');
{
  const t = makeTree('missing');
  unlinkSync(path.join(t.engineDir, 'icons.js'));
  const r = auditVendored(t);
  check('it reports MISSING, not silence', statusOf(r, 'icons.js') === 'MISSING', statusOf(r, 'icons.js'));
  check('the audit fails', r.ok === false);
}

console.log('\na portal-owned entry with no reason:');
{
  const t = makeTree('noreason');
  const m = JSON.parse(readFileSync(t.manifestPath, 'utf8'));
  delete m.files.find((f) => f.path === 'wrapper.js').why;
  writeFileSync(t.manifestPath, JSON.stringify(m, null, 2));
  const r = auditVendored(t);
  check('it reports NO-REASON', statusOf(r, 'wrapper.js') === 'NO-REASON', statusOf(r, 'wrapper.js'));
  check('the audit fails', r.ok === false);
}

console.log('\nthe named source does not exist:');
{
  const t = makeTree('nosource');
  unlinkSync(path.join(t.srcDir, 'icons.js'));
  const r = auditVendored(t);
  check('it reports NO-SOURCE rather than passing', statusOf(r, 'icons.js') === 'NO-SOURCE', statusOf(r, 'icons.js'));
  check('the audit fails', r.ok === false);
}

console.log('\nthe skill tree is not on this machine (CI):');
{
  const t = makeTree('noskills');
  // The drift that WOULD have been caught, if the source could be read at all.
  writeFileSync(path.join(t.srcDir, 'icons.js'), '// icons\n// moved on\n');
  const r = auditVendored({ ...t, skillRoot: null });
  check('the audit still passes on hashes alone', r.ok === true);
  check('but it does NOT claim to have checked the source', r.sourceChecked === false);
  check('and it says why', typeof r.skipReason === 'string' && r.skipReason.length > 0, r.skipReason);
  const gone = auditVendored({ ...t, skillRoot: path.join(scratch, 'nowhere') });
  check('a skillRoot that does not exist skips too, and names it', gone.sourceChecked === false && /nowhere/.test(gone.skipReason || ''), gone.skipReason);
}

console.log('\nline endings are not drift:');
{
  const t = makeTree('crlf');
  const body = readFileSync(path.join(t.engineDir, 'icons.js'), 'utf8');
  writeFileSync(path.join(t.engineDir, 'icons.js'), body.replace(/\n/g, '\r\n'));
  const r = auditVendored(t);
  check('a CRLF checkout of the same file is still OK', statusOf(r, 'icons.js') === 'OK', statusOf(r, 'icons.js'));
  check('the audit passes', r.ok === true);
}

console.log('\nthe tree walk:');
{
  const t = makeTree('walk');
  const files = listEngineFiles(t.engineDir);
  check('it descends into subfolders', files.includes('place/gen_internal.js'), JSON.stringify(files));
  check('it uses POSIX separators, so a manifest is portable', files.every((f) => !f.includes('\\')));
  check('it ignores the manifest itself and anything that is not .js', !files.some((f) => f.endsWith('.json')));
}

console.log('\nhow the vendored code ASKS for a module — all four idioms:');
{
  // The scan's population is "what the vendored code requires", so it has to
  // recognise every way the engine writes a resolver. It has not always: on
  // 2026-08-27 gen_internal.js was re-vendored carrying four new requires
  // written through its _dep() helper, and this check reported "every module
  // they require is here". gen_boarding.js had been invisible the same way for
  // as long as it has used _dep, and gen_external_places.js writes a third form
  // that pattern 1 never matched either.
  const t = makeTree('idioms');
  const forms = {
    'ternary.js': "const p = process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'wanted_a.js') : 'x';",
    'ifreturn.js': "function d(){ if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS,'wanted_b.js'); }",
    'factored.js': "const _dep = (n) => path.join(process.env.SKILL_ASSETS, n);\nrequire(_dep('wanted_c.js'));",
    // The ANCHORED form, added 2026-09-02. Neither of these mentions
    // SKILL_ASSETS at all: they pin a module to the folder another was already
    // found in. `external_primitives.js` is required by all three external
    // generators through this idiom ALONE, and the scan called the engine
    // complete without it — the failure this file's header had predicted in
    // writing and then not been widened for.
    'anchored.js': "const FONT = require(path.join(path.dirname(_LABELLER), 'wanted_d.js'));",
    'anchored_factored.js': "const _from = siblingOf(_LABELLER);\nrequire(_from('wanted_e.js'));",
  };
  for (const [file, body] of Object.entries(forms)) {
    writeFileSync(path.join(t.engineDir, file), body + '\n');
    writeFileSync(path.join(t.srcDir, file), body + '\n');
  }
  const m = JSON.parse(readFileSync(t.manifestPath, 'utf8'));
  for (const file of Object.keys(forms)) {
    m.files.push({ path: file, kind: 'vendored', source: 'make-bus-leaflet/assets/' + file,
      sha256: hashOf(path.join(t.engineDir, file)), vendoredOn: '2026-08-27' });
  }
  writeFileSync(t.manifestPath, JSON.stringify(m, null, 2));

  const r = auditVendored(t);
  check('the ternary form is seen', statusOf(r, 'wanted_a.js') === 'UNRESOLVED', statusOf(r, 'wanted_a.js'));
  check('the if-return form is seen', statusOf(r, 'wanted_b.js') === 'UNRESOLVED', statusOf(r, 'wanted_b.js'));
  check('the factored _dep form is seen — the one that went blind', statusOf(r, 'wanted_c.js') === 'UNRESOLVED', statusOf(r, 'wanted_c.js'));
  check('the anchored path.dirname form is seen — the one that went blind next', statusOf(r, 'wanted_d.js') === 'UNRESOLVED', statusOf(r, 'wanted_d.js'));
  check('and its factored _from spelling', statusOf(r, 'wanted_e.js') === 'UNRESOLVED', statusOf(r, 'wanted_e.js'));
  check('and the audit fails rather than reporting all clear', r.ok === false);

  // The && candidate-list form is EXCLUDED on purpose: it is one of three
  // candidates existsSync() chooses between, and the file reports its own miss.
  // Flagging it would open this check red on diagram_internal.js and
  // schematize_internal.js, which is how a check gets muted rather than fixed.
  const t2 = makeTree('candidates');
  const cand = "const c = [process.env.SKILL_ASSETS && path.join(process.env.SKILL_ASSETS, 'not_here.js'), path.join(__dirname, 'not_here.js')].filter(Boolean);";
  writeFileSync(path.join(t2.engineDir, 'candidates.js'), cand + '\n');
  writeFileSync(path.join(t2.srcDir, 'candidates.js'), cand + '\n');
  const m2 = JSON.parse(readFileSync(t2.manifestPath, 'utf8'));
  m2.files.push({ path: 'candidates.js', kind: 'vendored', source: 'make-bus-leaflet/assets/candidates.js',
    sha256: hashOf(path.join(t2.engineDir, 'candidates.js')), vendoredOn: '2026-08-27' });
  writeFileSync(t2.manifestPath, JSON.stringify(m2, null, 2));
  const r2 = auditVendored(t2);
  check('a && candidate list is NOT flagged, and the tree still passes', r2.ok === true,
    JSON.stringify(r2.rows.filter((x) => x.status !== 'OK')));
}

console.log('\nthe REAL engine tree (this is the gate CI runs):');
{
  const r = auditVendored({
    engineDir: path.join(ROOT, 'engine'),
    manifestPath: path.join(ROOT, 'engine', 'vendored.json'),
    skillRoot: null,
  });
  const bad = r.rows.filter((x) => x.status !== 'OK');
  check('every engine/ file is accounted for and unedited', r.ok === true, bad.map((x) => `${x.file}=${x.status}`).join(', '));
  check('the manifest covers the whole tree', r.rows.length === listEngineFiles(path.join(ROOT, 'engine')).length);
}

rmSync(scratch, { recursive: true, force: true });

if (failures) {
  console.error(`\n✗ ${failures} vendored-engine check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\n✓ all vendored-engine checks passed');
}
