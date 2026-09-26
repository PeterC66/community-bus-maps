#!/usr/bin/env node
/*
 * test-deploy-history.mjs — the deploy refuses a merge that no deploy-history
 * entry describes (buses-data OA-377, DEPLOY.md §3b).
 *
 *     npm run test:deploy-history
 *
 * Run from the repository root (`C:\Claude\community-bus-maps`), no
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
import { prNumber, undescribed } from './lib/deploy-history.mjs';

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
