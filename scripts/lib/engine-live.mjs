// Is the engine the live host runs the engine origin/main vendors? (buses-data,
// 2026-10-01 St Neots delivery.)
//
// WHY THIS EXISTS. deliver-map.mjs step 2 verifies a render inside a throwaway
// container built from the HOST's checkout, so it runs the engine under
// `engine/` as of the host's HEAD — not as of origin/main. On 2026-10-01 the
// host was at a96a758 while origin/main f5d1d91 carried two re-vendors (#452,
// #455) adding `engine/legend_key.js` and `engine/place_pointer.js`; every St
// Neots render had been drawn by that newer engine, and step 2 died with
// `Cannot find module '/app/engine/legend_key.js'`. The fix was `npm run deploy`
// first, after which all five deliveries passed byte-identical. Nothing asked
// the question before the scp: the worklist said "push buses-data first" and
// nothing about the portal deploy, and the deploy row sat low inside its grace.
//
// ONE QUESTION, ANSWERED FROM GIT: does `git diff <hostHead> <wanted> -- engine/`
// name any file? The caller reads the host's HEAD over ssh (the same
// `git rev-parse HEAD` deploy.mjs step 0b reads) and fetches origin/main first.
// Every way of not knowing — a HEAD that is not a sha, a commit this clone does
// not hold, git failing — is `cannot-tell`, never `current`: "could not check"
// and "checked and fine" must not report the same way (technical-audit V2).

import { spawnSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$/;

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.error ? -1 : r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

/**
 * @param {{ hostHead: string, wanted?: string, cwd?: string }} o
 *   hostHead — the full sha the host's checkout is at
 *   wanted   — the ref the host would deploy (default `origin/main`)
 *   cwd      — the portal clone to ask (default: process.cwd())
 * @returns {{ verdict: 'current'|'behind'|'cannot-tell', message: string,
 *             hostHead?: string, wantedSha?: string, files?: {status: string, path: string}[] }}
 */
export function checkEngineLive({ hostHead, wanted = 'origin/main', cwd = process.cwd() }) {
  const host = String(hostHead || '').trim();
  if (!SHA.test(host)) {
    return { verdict: 'cannot-tell', message: `the host's HEAD did not read as a commit (got ${JSON.stringify(host.slice(0, 60))})` };
  }
  const w = git(cwd, ['rev-parse', '--verify', '--quiet', `${wanted}^{commit}`]);
  if (w.status !== 0 || !SHA.test(w.stdout)) {
    return { verdict: 'cannot-tell', message: `${wanted} does not resolve to a commit in this clone` };
  }
  const wantedSha = w.stdout;
  if (git(cwd, ['cat-file', '-e', `${host}^{commit}`]).status !== 0) {
    return { verdict: 'cannot-tell', hostHead: host, wantedSha,
      message: `the host is at ${host.slice(0, 7)}, a commit this clone does not hold — fetch, or the host carries a commit GitHub does not` };
  }
  const d = git(cwd, ['diff', '--name-status', '--no-renames', host, wantedSha, '--', 'engine/']);
  if (d.status !== 0) {
    return { verdict: 'cannot-tell', hostHead: host, wantedSha, message: `git diff failed: ${d.stderr || `exit ${d.status}`}` };
  }
  const files = d.stdout ? d.stdout.split('\n').map((l) => {
    const [status, ...rest] = l.split('\t');
    return { status, path: rest.join('\t') };
  }) : [];
  if (!files.length) {
    return { verdict: 'current', hostHead: host, wantedSha, files,
      message: `the host ${host.slice(0, 7)} runs the same engine/ as ${wanted} ${wantedSha.slice(0, 7)}` };
  }
  return { verdict: 'behind', hostHead: host, wantedSha, files,
    message: `the host ${host.slice(0, 7)} runs a different engine/ from ${wanted} ${wantedSha.slice(0, 7)} — ${files.length} file(s) differ` };
}
