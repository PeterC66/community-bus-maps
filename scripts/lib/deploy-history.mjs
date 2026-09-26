// deploy-history.mjs — which merges would go live described by nothing
// (buses-data OA-377).
//
// DEPLOY.md §3b orders a deploy-history entry against ITS OWN change: write
// it, merge it, deploy the merge. It says nothing about every other commit
// that merges between the writing and the deploy, and those ride up to the
// live site described by nothing. That happened twice in a row in September
// 2026 (#295–#297, then #301–#303, the owner picker among them) and both times
// it was found by the next person to write an entry, reading back. Nothing
// asked the question.
//
// This module asks it. A first-parent commit on `main` counts as DESCRIBED
// when any one of these holds:
//
//   1. it ADDS a fragment to CHANGELOG.d/ — the entry travels in the pull
//      request, which is how every change has carried it since 2026-09-19;
//   2. it EDITS docs/DEPLOY.md — an entry commit describes itself as "the merge
//      carrying this entry", and a §3b history edit is exactly that;
//   3. its pull-request number (`#NNN`, read off the squash subject) or its
//      short sha is NAMED in docs/DEPLOY.md or in any CHANGELOG.d/ fragment —
//      the after-the-fact route, for a dependabot bump or anything else that
//      merged without an entry of its own.
//
// The function is pure: commits, the document and the fragments in; the
// undescribed commits out. No clock and no network is an input, so the same
// tree always gives the same answer. Reading git is `readCommits`'s job.

import { spawnSync } from 'node:child_process';

/**
 * Where the rule starts. Every first-parent commit AFTER this one is asked;
 * nothing at or before it is. It is the sha the live site reported when the
 * check was written (`X-App-Version: 0.10.0-pilot+9db6dd3`, 2026-09-26).
 * Measured over the 85 merges from `7c7c710` to here, before the check
 * existed: 55 added a fragment, 18 more edited DEPLOY.md, 11 of the other 12
 * were named by number in one or the other, and ONE — `2df2d63` (#331, a
 * fixture re-vendor) — was described by nothing.
 * That one is history, and the baseline leaves it there rather than making the
 * first deploy under this check fail for it.
 */
export const BASELINE = '9db6dd3';

/** The pull-request number a squash-merge subject ends with, or null. */
export function prNumber(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject || '');
  return m ? m[1] : null;
}

/**
 * @param {object} p
 * @param {{sha:string, subject:string, addsFragment:boolean, editsDeploy:boolean}[]} p.commits
 * @param {string} p.deployText   docs/DEPLOY.md
 * @param {string[]} p.fragmentTexts  every CHANGELOG.d/*.md except README.md
 * @returns the commits described by nothing, in the order given
 */
export function undescribed({ commits, deployText, fragmentTexts }) {
  const corpus = [deployText, ...fragmentTexts].join('\n');
  return commits.filter((c) => {
    if (c.addsFragment || c.editsDeploy) return false;
    const pr = prNumber(c.subject);
    if (pr && new RegExp(`#${pr}(?!\\d)`).test(corpus)) return false;
    if (c.sha && corpus.includes(c.sha.slice(0, 7))) return false;
    return true;
  });
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    const err = new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
    err.gitFailed = true;
    throw err;
  }
  return r.stdout;
}

/** First-parent commits in `from..to`, oldest first, with what each touched. */
export function readCommits(repo, from, to) {
  const out = git(repo, ['log', '--first-parent', '--reverse', '--format=%h%x09%s', `${from}..${to}`]).trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const tab = line.indexOf('\t');
    const sha = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    // --first-parent here too: the diff of a squash commit against its parent.
    const touched = git(repo, ['show', '--first-parent', '--format=', '--name-status', sha])
      .split('\n').filter(Boolean).map((l) => l.split('\t'));
    const addsFragment = touched.some(([st, p]) => st === 'A' && /^CHANGELOG\.d\/.+\.md$/.test(p) && p !== 'CHANGELOG.d/README.md');
    const editsDeploy = touched.some(([, p]) => p === 'docs/DEPLOY.md');
    return { sha, subject, addsFragment, editsDeploy };
  });
}

/** docs/DEPLOY.md and every fragment, as they stand at `ref`. */
export function readDescriptions(repo, ref) {
  const deployText = git(repo, ['show', `${ref}:docs/DEPLOY.md`]);
  const names = git(repo, ['ls-tree', '--name-only', `${ref}`, 'CHANGELOG.d/'])
    .split('\n').filter((p) => /\.md$/.test(p) && p !== 'CHANGELOG.d/README.md');
  const fragmentTexts = names.map((p) => git(repo, ['show', `${ref}:${p}`]));
  return { deployText, fragmentTexts };
}
