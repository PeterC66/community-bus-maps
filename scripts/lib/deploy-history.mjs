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
//      the after-the-fact route, for anything that merged without an entry of
//      its own;
//   4. it is a Dependabot bump that DESCRIBES ITSELF (added 2026-10-21): the
//      squash subject and body already say which package moved from what to
//      what, and every one of #261, #333, #483, #497 and #507 cost a pull
//      request whose only content was a fragment restating that. It counts
//      only when the diff — not Dependabot's own message — shows a patch or
//      minor bump touching nothing but package.json / package-lock.json or
//      .github/workflows/. sharp (and its @img/* libvips binaries), the
//      Dockerfile and any major bump still need a fragment, because §7 treats
//      a sharp or base-image bump as a rasteriser change, and a major is a
//      change somebody has to read. `bumpVerdict` is that rule.
//
// The functions are pure: commits, the document and the fragments in; the
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
    if (c.bump && bumpVerdict(c.bump).ok) return false;
    const pr = prNumber(c.subject);
    if (pr && new RegExp(`#${pr}(?!\\d)`).test(corpus)) return false;
    if (c.sha && corpus.includes(c.sha.slice(0, 7))) return false;
    return true;
  });
}

// --- route 4: the Dependabot bump that describes itself ---------------------

/** Dependabot's author line on a squash merge, name AND GitHub's noreply address. */
export function isDependabot(author, email) {
  return author === 'dependabot[bot]' && /^\d+\+dependabot\[bot\]@users\.noreply\.github\.com$/.test(email || '');
}

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
// sharp and the prebuilt libvips it loads are the rasteriser (DEPLOY.md §7).
const RASTERISER = (name) => name === 'sharp' || name.startsWith('@img/');

/** [major, minor, patch] from `^1.2.3`, `~1.2`, `v4`, `1.2.3-rc.1`; null for anything else. */
export function parseVersion(spec) {
  const m = /^[\^~=v\s]*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]*)?$/.exec(String(spec ?? '').trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/**
 * 'patch' | 'minor' | 'major' | 'none' | 'unknown'. Under 1.0.0 a minor move
 * is breaking, as npm's caret reads it, so it counts as major here; a
 * downgrade or an unreadable version is 'unknown'.
 */
export function bumpLevel(from, to) {
  const a = parseVersion(from), b = parseVersion(to);
  if (!a || !b) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if (a[i] === b[i]) continue;
    if (b[i] < a[i]) return 'unknown';
    if (i === 0 || (i === 1 && a[0] === 0)) return 'major';
    return i === 1 ? 'minor' : 'patch';
  }
  return 'none';
}

const pkgName = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
const USES = /^(\s*-?\s*uses:\s*)([^@\s]+)@(\S+?)(?:\s*#\s*(\S+))?\s*$/;

/**
 * Is this Dependabot commit self-describing? Pure.
 *
 * @param {object} b
 * @param {[string, string][]} b.touched  [status, path] off `--name-status`
 * @param {{path:string, before:string|null, after:string|null}[]} b.texts
 *        package.json, package-lock.json and each workflow, at the parent and
 *        at the commit, for every one of them the commit touched
 * @returns {{ok:boolean, why:string, changes:{name:string, from:string, to:string, level:string}[]}}
 */
export function bumpVerdict({ touched, texts }) {
  const changes = [];
  const no = (why) => ({ ok: false, why, changes });
  const text = (p) => texts.find((t) => t.path === p) || { before: null, after: null };

  for (const [st, p] of touched) {
    if (p === 'Dockerfile') return no('it changes the Dockerfile, and a base-image bump is a rasteriser change (DEPLOY.md §7)');
    const allowed = p === 'package.json' || p === 'package-lock.json' || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
    if (!allowed) return no(`it touches ${p}, which is not a manifest, a lockfile or a workflow`);
    if (st !== 'M') return no(`it ${st === 'A' ? 'adds' : st === 'D' ? 'deletes' : 'renames'} ${p} rather than editing it`);
  }

  for (const [, p] of touched) {
    const { before, after } = text(p);
    if (before == null || after == null) return no(`${p} could not be read on both sides`);

    if (p === 'package.json') {
      let a, b;
      try { a = JSON.parse(before); b = JSON.parse(after); } catch { return no('package.json does not parse'); }
      for (const s of DEP_SECTIONS) {
        const was = a[s] || {}, now = b[s] || {};
        for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
          if (was[name] === now[name]) continue;
          if (!(name in was) || !(name in now)) return no(`it ${name in now ? 'adds' : 'removes'} the dependency ${name}`);
          changes.push({ name, from: was[name], to: now[name], level: bumpLevel(was[name], now[name]) });
        }
      }
      const rest = (o) => JSON.stringify({ ...o, ...Object.fromEntries(DEP_SECTIONS.map((s) => [s, undefined])) });
      if (rest(a) !== rest(b)) return no('package.json changes more than dependency versions');
    } else if (p === 'package-lock.json') {
      let a, b;
      try { a = JSON.parse(before).packages || {}; b = JSON.parse(after).packages || {}; } catch { return no('package-lock.json does not parse'); }
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!key) continue;
        const was = a[key]?.version, now = b[key]?.version;
        if (was === now) continue;
        const name = pkgName(key);
        if (RASTERISER(name)) return no(`it moves ${name} (${was ?? 'absent'} → ${now ?? 'absent'}), which is the rasteriser (DEPLOY.md §7)`);
        // Top-level installs only: a nested copy is somebody else's pin. An
        // install appearing or leaving is the lockfile's own churn.
        if (key.indexOf('node_modules/') !== key.lastIndexOf('node_modules/') || !was || !now) continue;
        changes.push({ name, from: was, to: now, level: bumpLevel(was, now) });
      }
    } else {
      const x = before.split(/\r?\n/), y = after.split(/\r?\n/);
      if (x.length !== y.length) return no(`${p} changes more than action versions`);
      for (let i = 0; i < x.length; i++) {
        if (x[i] === y[i]) continue;
        const m = USES.exec(x[i]), n = USES.exec(y[i]);
        if (!m || !n || m[1] !== n[1] || m[2] !== n[2]) return no(`${p} changes more than action versions`);
        // A sha pin is read by the version Dependabot writes beside it.
        const ver = (mm) => (/^[0-9a-f]{40}$/.test(mm[3]) ? mm[4] : mm[3]);
        changes.push({ name: m[2], from: ver(m), to: ver(n), level: bumpLevel(ver(m), ver(n)) });
      }
    }
  }

  const moved = changes.filter((c) => c.level !== 'none');
  if (moved.length === 0) return no('no version change could be read off the diff');
  const bad = moved.find((c) => c.level !== 'patch' && c.level !== 'minor');
  if (bad) return no(`${bad.name} ${bad.from} → ${bad.to} is ${bad.level === 'major' ? 'a major bump' : 'not readable as a patch or minor bump'}`);
  // The lockfile sorts before package.json, so the installed version is the one named.
  const named = moved.filter((c, i) => moved.findIndex((d) => d.name === c.name) === i);
  return { ok: true, why: named.map((c) => `${c.name} ${c.from} → ${c.to} (${c.level})`).join(', '), changes };
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
  const out = git(repo, ['log', '--first-parent', '--reverse', '--format=%h%x09%an%x09%ae%x09%s', `${from}..${to}`]).trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [sha, author, email, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    // --first-parent here too: the diff of a squash commit against its parent.
    const touched = git(repo, ['show', '--first-parent', '--format=', '--name-status', sha])
      .split('\n').filter(Boolean).map((l) => l.split('\t'));
    const addsFragment = touched.some(([st, p]) => st === 'A' && /^CHANGELOG\.d\/.+\.md$/.test(p) && p !== 'CHANGELOG.d/README.md');
    const editsDeploy = touched.some(([, p]) => p === 'docs/DEPLOY.md');
    const c = { sha, subject, author, email, addsFragment, editsDeploy };
    if (isDependabot(author, email)) {
      // Only the files bumpVerdict reads; a path it refuses needs no text.
      const show = (ref) => { try { return git(repo, ['show', ref]); } catch { return null; } };
      const texts = touched.map(([, p]) => p)
        .filter((p) => p === 'package.json' || p === 'package-lock.json' || p.startsWith('.github/workflows/'))
        .map((p) => ({ path: p, before: show(`${sha}^:${p}`), after: show(`${sha}:${p}`) }));
      c.bump = { touched, texts };
    }
    return c;
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
