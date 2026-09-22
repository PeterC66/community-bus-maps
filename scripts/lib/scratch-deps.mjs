// scratch-deps.mjs — where a scratch copy borrows `node_modules` from
// (buses-data OA-440).
//
// Every `prove-red-*` harness builds a throwaway copy of part of this
// repository and runs the real test inside it. The copy needs dependencies, and
// copying `node_modules` would cost minutes per arm, so each harness junctions
// the checkout's own `node_modules` in beside the copied source.
//
// THE ASSUMPTION THAT BROKE. Until 2026-09-22 each one wrote
// `path.join(ROOT, 'node_modules')`, where ROOT is the checkout the harness
// lives in. `npm ci` installs into the MAIN checkout only, so a git worktree has
// no `node_modules` of its own — Node finds the dependencies by walking up, or
// does not find them at all. The junction target was therefore missing, the
// `catch` arm's `cpSync` of a missing directory failed too, and the copy ran
// with no dependencies: `test-sitemap.mjs` died on ERR_MODULE_NOT_FOUND before
// asking a single question, and the harness reported *0 caught, control RED*.
// Seventeen harnesses did that at once, which reads exactly like a weak suite
// and is in fact a suite that never ran. It is a green check's inverse and just
// as quiet, and CI cannot see it: CI has one checkout with `node_modules` at its
// root and no worktree anywhere. Since OA-395's R2 the worktree is where an
// interactive session starts, so this is the DEFAULT arrangement, not an
// exotic one.
//
// WHAT THIS DOES INSTEAD. It asks git where the main checkout is rather than
// guessing, because the guess has two shapes to get right and only one of them
// is a parent: `.claude/worktrees/<name>` sits INSIDE the checkout, and the
// `C:\Claude\cbm-*` worktrees sit beside it, where walking up finds nothing.
// `git rev-parse --git-common-dir` answers both, because a worktree's common
// dir is the main checkout's `.git` whatever the directory layout.
//
// AND IT REFUSES RATHER THAN SKIPPING. Where no `node_modules` can be found at
// all, `depsRoot` throws and names both places it looked. That is the half worth
// having: three of the harnesses guarded the junction with
// `if (!existsSync(from)) continue`, so a missing `node_modules` was not even an
// error — it was a silent skip, and the run that followed it looked like a test.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** The checkout whose `node_modules` this one should borrow.
 *
 *  `root` first, because a normal checkout answers without asking git. Then the
 *  main checkout git names, which is `root` itself outside a worktree and so
 *  costs one redundant question at most. Throws if neither has one — an
 *  ERR_MODULE_NOT_FOUND twenty lines later says nothing about the cause.
 */
export function depsRoot(root) {
  if (existsSync(path.join(root, 'node_modules'))) return root;

  let main = null;
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // `--git-common-dir` answers relative to `root` in an ordinary checkout and
    // absolutely in a worktree, so resolve it against `root` either way.
    if (common) main = path.dirname(path.resolve(root, common));
  } catch { /* not a repository, or no git on the path — the throw below says so */ }

  if (main && existsSync(path.join(main, 'node_modules'))) return main;

  throw new Error(
    `no node_modules to borrow for the scratch copy.\n` +
    `  looked in this checkout: ${root}\n` +
    `  looked in the main checkout git names: ${main ?? '(git could not say)'}\n` +
    `  Run \`npm ci\` in the main checkout — a git worktree never gets its own.`,
  );
}

/** The source path a scratch copy should link `dir` from.
 *
 *  Everything but `node_modules` comes from `root`, because the harness is
 *  testing THIS checkout's content and must not reach into another one for it.
 *  `node_modules` is the single exception: it is not content, it is the
 *  dependencies, and `npm ci` put them in one place.
 */
export function depsFrom(root, dir) {
  return dir === 'node_modules'
    ? path.join(depsRoot(root), 'node_modules')
    : path.join(root, dir);
}
